import { config } from "../config/env.js";
import { Job } from "../models/index.js";
import { now } from "../utils/clock.js";
import { logger } from "../utils/logger.js";
import { AUDIT, audit } from "./auditService.js";
import { integrations } from "./integrations.js";

export const RATING_COLUMNS = ["Interested", "Will Apply", "Reason Not Applied", "Questions Asked", "Call Back Requested"];

const RATING_PROMPT = `Rate this phone call, where a placement coordinator reminded an eligible student to apply for a job they had not applied to yet.
Fill each column only from what was said on the call:
- Interested: Yes or No. Did the student show interest in the job?
- Will Apply: Yes, No or Maybe. Did the student say they will apply before the deadline?
- Reason Not Applied: the main reason the student gave for not applying yet or not being interested, in a few words. Leave blank if none was given.
- Questions Asked: the questions the student asked about the job, in a few words. Leave blank if none.
- Call Back Requested: Yes or No. Did the student ask to be called back at another time?`;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function fallbackSpokenJd(job) {
  const skills = (job.skills ?? []).slice(0, 5);
  return [
    `${job.companyName} is hiring for the role of ${job.jobRole}${job.location ? ` in ${job.location}` : ""}.`,
    job.employmentType ? `It is a ${job.employmentType.toLowerCase()} opportunity.` : "",
    job.ctc ? `The package is ${job.ctc}.` : "",
    job.internshipDuration ? `The duration is ${job.internshipDuration}.` : "",
    skills.length ? `Key skills are ${skills.join(", ")}.` : "",
    job.openings ? `There are ${job.openings} openings.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function spokenJobSummary(job) {
  const facts = [
    ["Company", job.companyName],
    ["Role", job.jobRole],
    ["Job type", job.employmentType],
    ["Location", job.location],
    ["Package", job.ctc],
    ["Duration", job.internshipDuration],
    ["Openings", job.openings],
    ["Skills", (job.skills ?? []).join(", ")],
    ["Eligibility", job.eligibility],
    ["Notes", job.importantInstructions],
    ["Description", job.jobDescription],
  ]
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([label, value]) => `${label}: ${clean(value).slice(0, 600)}`)
    .join("\n");
  const prompt = `Write a short spoken summary of this job for a phone call to a college student, in at most 70 words.
Use plain spoken sentences only: no bullet points, markdown, emojis or symbols other than the rupee sign.
Mention the company, role, job type, location, package and the most important skills. Use ONLY the facts below and never add anything.

${facts}`;
  try {
    const text = clean(await integrations.gemini.generateText(prompt));
    if (text.length >= 40) return text.slice(0, 700);
  } catch (error) {
    logger.warn({ err: error, jobId: String(job._id) }, "Spoken job summary fell back to the rule-based text");
  }
  return fallbackSpokenJd(job);
}

export function buildAgentDefinition(job, ratingTemplate) {
  const { callerName, callingFrom, language, callMaxSeconds } = config.nxtdial;
  const minutes = Math.max(1, Math.round(callMaxSeconds / 60));
  const welcomeMessage = `Hi {name}, this is ${callerName} calling from ${callingFrom}, about a ${job.jobRole} opportunity at ${job.companyName}. Do you have a minute?`;
  const prompt = `You are ${callerName}, a friendly placement coordinator calling from ${callingFrom}. You are speaking with {name}, a student who is eligible for the job below but has NOT applied yet.

JOB DETAILS (your only source of facts):
{jd}

Application deadline: {deadline}

GOAL: within ${minutes} minute${minutes === 1 ? "" : "s"}, encourage {name} to apply before the deadline.

CALL FLOW:
1. Confirm you are speaking with {name}. If it is the wrong person, apologise and end the call.
2. In one or two short sentences, share the role, the company and the main highlights from the job details.
3. Ask whether they are interested in applying.
4. If yes: tell them the apply link is on their learning portal and in their email, ask them to apply before the deadline, and confirm they will.
5. If no or unsure: ask ONE short question about the main reason, for example location, package, skills or timing. Do not argue or push.
6. Answer simple questions ONLY from the job details. If the answer is not there, say the placement team will share it by email.
7. Thank them and end the call.

RULES:
- Keep every reply to one or two short sentences and ask one question at a time.
- Finish the whole call within ${minutes} minute${minutes === 1 ? "" : "s"}.
- Never invent salary, location, dates or any detail that is not in the job details.
- Never ask for OTPs, passwords, payments or documents.
- If they are busy, ask for a better time to call back, then end politely.
- Speak in ${language}. Switch language only if the student clearly prefers another one.`;

  return {
    name: `Apply reminder · ${job.companyName} · ${job.jobRole}`.slice(0, 90),
    welcomeMessage,
    prompt,
    finalCallMessage: "We are out of time for this call. Please apply on your learning portal before the deadline. Thank you, bye!",
    conversationEngine: "pipeline",
    language,
    callTimeoutSeconds: callMaxSeconds,
    hangupOnSilence: true,
    hangupOnSilenceSeconds: 15,
    recordingEnabled: true,
    summarizationEnabled: true,
    ratingTemplate,
    variables: ["name", "jd", "deadline"],
  };
}

export async function ensureRatingTemplate() {
  const slug = config.nxtdial.ratingTemplate;
  const existing = (await integrations.nxtdial.listRatingTemplates()).find((template) => template.slug === slug);
  if (existing) return existing.slug;
  const created = await integrations.nxtdial.createRatingTemplate({
    name: "Job application reminder",
    slug,
    description: "Created by Job Flow Automation for apply-reminder calls.",
    prompt: RATING_PROMPT,
    columnHeaders: RATING_COLUMNS,
  });
  return created?.slug ?? slug;
}

export async function ensureCallAgent(job, actor) {
  if (config.nxtdial.agentId) return { agentId: config.nxtdial.agentId, spokenJd: job.boost?.spokenJd ?? (await spokenJobSummary(job)) };
  if (job.boost?.callAgentId) return { agentId: job.boost.callAgentId, spokenJd: job.boost.spokenJd ?? (await spokenJobSummary(job)) };

  const spokenJd = await spokenJobSummary(job);
  const ratingTemplate = await ensureRatingTemplate();
  const agent = await integrations.nxtdial.createAgent(buildAgentDefinition(job, ratingTemplate));
  await Job.updateOne(
    { _id: job._id },
    { $set: { "boost.callAgentId": agent.id, "boost.callAgentCreatedAt": now(), "boost.spokenJd": spokenJd } },
  );
  await audit({
    actor,
    action: AUDIT.CALL_AGENT_CREATED,
    entityId: job._id,
    metadata: { agentId: agent.id, agentName: agent.name, ratingTemplate },
  });
  return { agentId: agent.id, spokenJd };
}
