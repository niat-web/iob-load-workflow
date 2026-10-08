import { escapeHtml, formatDateTime } from "../../utils/helpers.js";
import { displayValue } from "../../services/dealMapper.js";

const COLORS = { primary: "#5B4CF0", text: "#17213C", muted: "#64748B", border: "#E6EAF2", bg: "#F8FAFD" };

function layout({ preheader, bodyHtml }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:Inter,Segoe UI,Arial,sans-serif;color:${COLORS.text};">
<span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${COLORS.border};border-radius:12px;">
<tr><td style="padding:28px 28px 24px;font-size:14px;line-height:1.6;">${bodyHtml}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function detailsTable(rows) {
  const body = rows
    .filter(([, value]) => value !== null && value !== undefined && value !== "" && value !== "—")
    .map(
      ([label, value]) => `<tr>
<td style="padding:6px 12px 6px 0;color:${COLORS.muted};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
<td style="padding:6px 0;vertical-align:top;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:12px 0 20px;border-top:1px solid ${COLORS.border};padding-top:8px;">${body}</table>`;
}

function button(label, url) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:${COLORS.primary};color:#ffffff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:8px;">${escapeHtml(label)}</a>`;
}

function textDetails(rows) {
  return rows
    .filter(([, value]) => value !== null && value !== undefined && value !== "" && value !== "—")
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

function jobRows(job) {
  return [
    ["Company", job.companyName],
    ["Role", job.jobRole],
    ["CTC", job.ctc],
    ["Location", job.location],
    ["Required Skills", displayValue(job.skills)],
    ["Eligibility", job.eligibility],
    ["Deadline", job.applicationEndAt ? `${formatDateTime(job.applicationEndAt)} IST` : null],
  ];
}

const greeting = (name) => (name ? `Hi ${name.split(" ")[0]},` : "Hi,");

export function initialJobEmail(job, student) {
  const rows = jobRows(job);
  const url = job.learningPortalJobUrl;
  return {
    subject: `New Job Opportunity – ${job.companyName} | ${job.jobRole}`,
    html: layout({
      preheader: `${job.companyName} is hiring for ${job.jobRole}. Apply before the deadline.`,
      bodyHtml: `<p style="margin:0 0 12px;">${escapeHtml(greeting(student?.studentName))}</p>
<p style="margin:0 0 4px;">A new opportunity is open for you. Review the details and apply before the deadline.</p>
${detailsTable(rows)}
${button("View & Apply", url)}`,
    }),
    text: `${greeting(student?.studentName)}\n\nA new opportunity is open for you.\n\n${textDetails(rows)}\n\nView & Apply: ${url}`,
  };
}

export function reminderEmail(job, student, reminderType) {
  const rows = [
    ["Company", job.companyName],
    ["Role", job.jobRole],
    ["Deadline", job.applicationEndAt ? `${formatDateTime(job.applicationEndAt)} IST` : null],
  ];
  const final = reminderType === "REMINDER_20H";
  const closing = job.applicationEndAt ? ` Applications close on ${formatDateTime(job.applicationEndAt)} IST.` : "";
  return {
    subject: `${final ? "Final reminder" : "Reminder"} – ${job.companyName} | ${job.jobRole}`,
    html: layout({
      preheader: `You have not applied for ${job.jobRole} at ${job.companyName} yet.`,
      bodyHtml: `<p style="margin:0 0 12px;">${escapeHtml(greeting(student?.studentName))}</p>
<p style="margin:0 0 4px;">This is a ${final ? "final " : ""}reminder about the <strong>${escapeHtml(job.jobRole)}</strong> opportunity at
<strong>${escapeHtml(job.companyName)}</strong>. You have not applied yet.${escapeHtml(closing)}</p>
${detailsTable(rows)}
<p style="margin:0;">You can apply from your learning portal.</p>`,
    }),
    text: `${greeting(student?.studentName)}\n\nThis is a ${final ? "final " : ""}reminder about the ${job.jobRole} opportunity at ${job.companyName}. You have not applied yet.${closing}\n\n${textDetails(rows)}\n\nYou can apply from your learning portal.`,
  };
}

export function jobUpdatedEmail(job, student, changes, formUrl) {
  const link = formUrl && student?.studentId ? `${formUrl}?user_id=${encodeURIComponent(student.studentId)}` : null;
  const changeRows = changes
    .map(
      (change) => `<tr>
<td style="padding:8px 12px 8px 0;color:${COLORS.muted};vertical-align:top;white-space:nowrap;">${escapeHtml(change.label)}</td>
<td style="padding:8px 0;vertical-align:top;"><span style="color:${COLORS.muted};text-decoration:line-through;">${escapeHtml(displayValue(change.oldValue))}</span>
&nbsp;→&nbsp;<strong>${escapeHtml(displayValue(change.newValue))}</strong></td></tr>`,
    )
    .join("");
  const changeText = changes
    .map((change) => `${change.label}\n  ${displayValue(change.oldValue)} → ${displayValue(change.newValue)}`)
    .join("\n");
  const ask = "Please tell us whether you are still interested in this opportunity.";
  return {
    subject: `Job updated – ${job.companyName} | ${job.jobRole}`,
    html: layout({
      preheader: `Some details of ${job.jobRole} at ${job.companyName} have changed.`,
      bodyHtml: `<p style="margin:0 0 12px;">${escapeHtml(greeting(student?.studentName))}</p>
<p style="margin:0 0 4px;">You applied for <strong>${escapeHtml(job.jobRole)}</strong> at <strong>${escapeHtml(job.companyName)}</strong>. These details have changed:</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:12px 0 20px;border-top:1px solid ${COLORS.border};padding-top:8px;">${changeRows}</table>
${link ? `<p style="margin:0 0 12px;">${escapeHtml(ask)}</p>
${button("Tell us if you are still interested", link)}` : ""}`,
    }),
    text: `${greeting(student?.studentName)}\n\nYou applied for ${job.jobRole} at ${job.companyName}. These details have changed:\n\n${changeText}${link ? `\n\n${ask}\n${link}` : ""}`,
  };
}

export function poolTargetReachedEmail(job, recipient) {
  const rows = [
    ["Company", job.companyName],
    ["Role", job.jobRole],
    ["Deal ID", job.hubspotDealId],
    ["Applications", String(job.appliedCount ?? 0)],
    ["Expected Pool", job.expectedPoolCount === null ? null : String(job.expectedPoolCount)],
    ["Applications close", job.applicationEndAt ? `${formatDateTime(job.applicationEndAt)} IST` : null],
  ];
  return {
    subject: `Expected pool reached – ${job.companyName} | ${job.jobRole}`,
    html: layout({
      preheader: `${job.appliedCount ?? 0} students applied for ${job.jobRole} at ${job.companyName}.`,
      bodyHtml: `<p style="margin:0 0 12px;">${escapeHtml(greeting(recipient?.studentName))}</p>
<p style="margin:0 0 4px;">The deal you added has reached its expected pool. The remaining reminders are skipped; the application window stays open until it closes.</p>
${detailsTable(rows)}
<p style="margin:20px 0 0;color:${COLORS.muted};">Regards</p>`,
    }),
    text: `${greeting(recipient?.studentName)}\n\nThe deal you added has reached its expected pool. The remaining reminders are skipped; the application window stays open until it closes.\n\n${textDetails(rows)}\n\nRegards`,
  };
}

export function crmPoolReadyEmail(job, { publicLink, psmEmail }, recipient) {
  const name = recipient?.studentName ?? job.crmOwnerName ?? "";
  const rows = [
    ["Company", job.companyName],
    ["Role", job.jobRole],
    ["Total Applications", String(job.appliedCount ?? 0)],
    ["Expected Pool", job.expectedPoolCount === null ? null : String(job.expectedPoolCount)],
    ["Reviewed By", psmEmail],
  ];
  return {
    subject: `Candidate Pool Ready – ${job.companyName} | ${job.jobRole}`,
    html: layout({
      preheader: `The profiles for ${job.companyName} are ready to share.`,
      bodyHtml: `<p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 4px;">The candidate profiles for the following opportunity have been reviewed and finalized. Share the link with the company. Anyone with the link can edit the sheet, add profiles and add columns.</p>
${detailsTable(rows)}
${button("Open the profiles", publicLink)}
<p style="margin:20px 0 0;color:${COLORS.muted};">Regards</p>`,
    }),
    text: `Hi ${name},\n\nThe candidate profiles for the following opportunity have been reviewed and finalized. Share the link with the company. Anyone with the link can edit the sheet, add profiles and add columns.\n\n${textDetails(rows)}\n\nOpen the profiles: ${publicLink}\n\nRegards`,
  };
}
