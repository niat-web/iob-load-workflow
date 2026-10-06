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
  const rows = jobRows(job);
  const url = job.learningPortalJobUrl;
  const final = reminderType === "REMINDER_20H";
  return {
    subject: `${final ? "Last chance" : "Reminder"} – ${job.companyName} | ${job.jobRole}`,
    html: layout({
      preheader: `Applications for ${job.companyName} close soon.`,
      bodyHtml: `<p style="margin:0 0 12px;">${escapeHtml(greeting(student?.studentName))}</p>
<p style="margin:0 0 4px;">You have not applied for this opportunity yet. Applications close on
<strong>${escapeHtml(formatDateTime(job.applicationEndAt))} IST</strong>.</p>
${detailsTable(rows)}
${button("View & Apply", url)}`,
    }),
    text: `${greeting(student?.studentName)}\n\nYou have not applied yet. Applications close on ${formatDateTime(job.applicationEndAt)} IST.\n\n${textDetails(rows)}\n\nView & Apply: ${url}`,
  };
}

export function jobUpdatedEmail(job, student, changes) {
  const url = job.learningPortalJobUrl;
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
  return {
    subject: `Important Update – ${job.companyName} | ${job.jobRole}`,
    html: layout({
      preheader: `The requirements for ${job.jobRole} at ${job.companyName} have changed.`,
      bodyHtml: `<p style="margin:0 0 12px;">${escapeHtml(greeting(student?.studentName))}</p>
<p style="margin:0 0 4px;">The requirements for this opportunity have been updated. Please review the changes below.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:12px 0 20px;border-top:1px solid ${COLORS.border};padding-top:8px;">${changeRows}</table>
${button("View Updated Job", url)}`,
    }),
    text: `${greeting(student?.studentName)}\n\nThe requirements for ${job.jobRole} at ${job.companyName} have been updated:\n\n${changeText}\n\nView Updated Job: ${url}`,
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

export function crmPoolReadyEmail(job, { publicLink, psmEmail }) {
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
      preheader: `The candidate pool for ${job.companyName} is ready to share.`,
      bodyHtml: `<p style="margin:0 0 12px;">Hi ${escapeHtml(job.crmOwnerName ?? "")},</p>
<p style="margin:0 0 4px;">The candidate pool for the following opportunity has been reviewed and finalized.</p>
${detailsTable(rows)}
${button("View Candidate Pool", publicLink)}
<p style="margin:20px 0 0;color:${COLORS.muted};">Regards</p>`,
    }),
    text: `Hi ${job.crmOwnerName ?? ""},\n\nThe candidate pool for the following opportunity has been reviewed and finalized.\n\n${textDetails(rows)}\n\nView Candidate Pool: ${publicLink}\n\nRegards`,
  };
}
