import { ArrowUpRight, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import type { CrmDealDetail, HubspotWriteBack, ReminderInfo, Tone } from "../../types/api";
import { cn } from "../../utils/cn";
import { DASH, formatDate, formatDateTime, formatNumber, orDash } from "../../utils/format";
import { DetailList, DetailSection } from "../DetailList";
import { ProgressBar } from "../ProgressBar";
import { StatusBadge } from "../StatusBadge";
import { IconButton } from "../ui/Button";
import { cardClass, linkClass } from "../ui/styles";

const REMINDER_TONES: Record<ReminderInfo["status"], Tone> = { SENT: "green", SKIPPED: "gray", FAILED: "red" };
const REMINDER_LABELS: Record<ReminderInfo["status"], string> = { SENT: "Sent", SKIPPED: "Skipped", FAILED: "Failed" };
const WRITE_BACK: Record<HubspotWriteBack, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "gray" },
  DONE: { label: "Job ID saved", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  SKIPPED: { label: "Off", tone: "gray" },
};

const environmentLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(cardClass, "min-w-0 p-5", className)}>{children}</div>;
}

export function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function CopyValue({ value, label }: { value: string | null; label: string }) {
  const copy = useCopyToClipboard();
  if (!value) return <>{DASH}</>;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs break-all text-slate-700">{value}</span>
      <IconButton
        label={`Copy ${label}`}
        className="size-7 shrink-0 border-transparent shadow-none"
        onClick={() => void copy(value, `${label} copied`)}
      >
        <Copy className="size-3.5" aria-hidden />
      </IconButton>
    </span>
  );
}

function Chips({ values, tone = "gray" }: { values: string[]; tone?: "gray" | "primary" }) {
  if (values.length === 0) return <>{DASH}</>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className={
            tone === "primary"
              ? "rounded-md bg-primary-soft px-2 py-0.5 text-xs text-primary"
              : "rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
          }
        >
          {value}
        </span>
      ))}
    </span>
  );
}

function deadlineText(value: string | null) {
  const formatted = formatDateTime(value);
  return formatted === DASH ? orDash(value) : formatted;
}

export function DealStatusCard({ deal }: { deal: CrmDealDetail }) {
  return (
    <Card className="bg-slate-50/70">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-wider text-muted uppercase">Current step</p>
          <p className="mt-0.5 truncate text-base font-semibold text-ink">{deal.currentStep}</p>
        </div>
        <ProgressBar value={deal.progressPercent} label="Workflow progress" />
      </div>
      {deal.lastError && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs break-words text-red-700">
          {deal.lastError}
        </p>
      )}
    </Card>
  );
}

export function JobMetaSection({ deal }: { deal: CrmDealDetail }) {
  return (
    <DetailSection title="Job Meta">
      <DetailList
        items={[
          { label: "Order ID", value: formatNumber(deal.learningPortal.order) },
          { label: "Ingestion Date", value: formatDate(deal.ingestedAt) },
          { label: "Job Deal ID", value: <span className="tabular-nums">{deal.hubspotDealId}</span> },
          { label: "Experience Type", value: orDash(deal.experienceType) },
          { label: "Job ID", value: <CopyValue value={deal.learningPortal.jobId} label="Job ID" />, wide: true },
          { label: "Job Type", value: orDash(deal.jobType) },
          { label: "Job Source", value: orDash(deal.jobSource) },
          {
            label: "HubSpot Record",
            wide: true,
            value: deal.hubspotRecordUrl ? <ExternalLink href={deal.hubspotRecordUrl}>Open HubSpot Record</ExternalLink> : DASH,
          },
        ]}
      />
    </DetailSection>
  );
}

export function CompanyProfileSection({ deal }: { deal: CrmDealDetail }) {
  return (
    <DetailSection title="Company Profile">
      <DetailList
        items={[
          { label: "Company Name", value: orDash(deal.companyName) },
          {
            label: "Website",
            value: deal.companyWebsite ? <ExternalLink href={deal.companyWebsite}>{deal.companyWebsite}</ExternalLink> : DASH,
          },
          {
            label: "Organization ID",
            value: <CopyValue value={deal.learningPortal.organisationId} label="Organization ID" />,
            wide: true,
          },
          {
            label: "LinkedIn",
            value: deal.companyLinkedin ? <ExternalLink href={deal.companyLinkedin}>LinkedIn Company Page</ExternalLink> : DASH,
          },
          {
            label: "Company Logo",
            value: deal.companyLogoUrl ? (
              <span className="inline-flex items-center gap-2.5">
                <img
                  src={deal.companyLogoUrl}
                  alt={`${deal.companyName ?? "Company"} logo`}
                  className="size-10 rounded-md border bg-surface object-contain p-1"
                  loading="lazy"
                />
                <ExternalLink href={deal.companyLogoUrl}>View URL</ExternalLink>
              </span>
            ) : (
              DASH
            ),
          },
        ]}
      />
    </DetailSection>
  );
}

export function RequirementsSection({ deal }: { deal: CrmDealDetail }) {
  const owner = [deal.crmOwnerName, deal.crmOwnerEmail].filter(Boolean).join(" · ");
  return (
    <DetailSection title="Requirements & Setup">
      <DetailList
        className="lg:grid-cols-3"
        items={[
          { label: "Job Title", value: orDash(deal.jobRole) },
          { label: "JD Count", value: formatNumber(deal.jdCount) },
          { label: "Location", value: orDash(deal.location) },
          { label: "CTC / Stipend Package", value: orDash(deal.ctc) },
          { label: "Positions Available", value: formatNumber(deal.openings) },
          { label: "Application Mode", value: orDash(deal.applicationMode) },
          { label: "Internship Duration", value: orDash(deal.internshipDuration) },
          { label: "Employment Type", value: orDash(deal.employmentType) },
          { label: "Eligibility", value: orDash(deal.eligibility) },
          { label: "Batch", value: orDash(deal.batch) },
          { label: "Campus", value: orDash(deal.campus) },
          { label: "Program", value: orDash(deal.program) },
          { label: "Deadline", value: deadlineText(deal.deadline) },
          { label: "CRM Owner", value: owner || DASH },
          { label: "Profiling Done By", value: deal.profilingPoc?.name ?? DASH },
          { label: "ISE", value: deal.ise?.name ?? DASH },
          {
            label: "Compensation Description",
            wide: true,
            value: deal.compensationDescription ? (
              <span className="block font-normal whitespace-pre-wrap">{deal.compensationDescription}</span>
            ) : (
              DASH
            ),
          },
          { label: "Skills Target", wide: true, value: <Chips values={deal.skills} /> },
          { label: "Target Enroll Plans", wide: true, value: <Chips values={deal.enrollPlans} tone="primary" /> },
        ]}
      />
    </DetailSection>
  );
}

export function ApplicationsSection({ deal }: { deal: CrmDealDetail }) {
  return (
    <DetailSection title="Applications">
      <DetailList
        items={[
          { label: "Expected Pool", value: formatNumber(deal.expectedPoolCount) },
          { label: "Eligible Students", value: formatNumber(deal.eligibleCount) },
          { label: "Applied", value: formatNumber(deal.appliedCount) },
          { label: "Pool Target Reached", value: deal.poolTargetReached ? "Yes" : "No" },
          { label: "Application Opens", value: formatDateTime(deal.applicationStartAt) },
          { label: "Application Closes", value: formatDateTime(deal.applicationEndAt) },
        ]}
      />
      {deal.applicationStartAt && (
        <Link
          to={`/crm/deals/${encodeURIComponent(deal.id)}/boost`}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-primary-soft px-3.5 text-sm font-semibold text-primary hover:bg-primary/10"
        >
          Boost applications: reminder email or AI calls
        </Link>
      )}
    </DetailSection>
  );
}

export function LinksSection({ deal }: { deal: CrmDealDetail }) {
  const copy = useCopyToClipboard();
  return (
    <DetailSection title="Links">
      <DetailList
        items={[
          {
            label: "Student Apply Link",
            value: deal.learningPortalJobUrl ? <ExternalLink href={deal.learningPortalJobUrl}>Open link</ExternalLink> : DASH,
          },
          {
            label: "Public Link",
            value: deal.publicLinkUrl ? (
              <span className="inline-flex items-center gap-2">
                <ExternalLink href={deal.publicLinkUrl}>View Link</ExternalLink>
                <IconButton
                  label="Copy public link"
                  className="size-7 border-transparent shadow-none"
                  onClick={() => void copy(deal.publicLinkUrl ?? "", "Public link copied")}
                >
                  <Copy className="size-3.5" aria-hidden />
                </IconButton>
              </span>
            ) : (
              DASH
            ),
          },
        ]}
      />
    </DetailSection>
  );
}

export function FlowSection({ deal }: { deal: CrmDealDetail }) {
  const stepByStep = deal.flowMode === "STEP_BY_STEP";
  const items = [
    { label: "Flow when submitted", value: stepByStep ? "Step by step" : "Automatic" },
    { label: "Waiting for", value: deal.awaitingApproval ? deal.awaitingApproval.label : DASH },
  ];
  if (deal.cancelledBy) {
    items.push({ label: "Stopped", value: `${deal.cancelledBy} · ${formatDateTime(deal.cancelledAt)}` });
  }
  return (
    <DetailSection title="Flow">
      <DetailList
        items={[
          ...items,
          ...(stepByStep
            ? [
                {
                  label: "Approved steps",
                  wide: true,
                  value: deal.approvals.length ? (
                    <ul className="space-y-1">
                      {deal.approvals.map((approval) => (
                        <li key={approval.gate}>
                          <span className="font-semibold">{approval.label}</span>
                          <span className="text-muted">
                            {" "}
                            · {approval.by ?? DASH} · {formatDateTime(approval.at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "None yet"
                  ),
                },
              ]
            : []),
        ]}
      />
    </DetailSection>
  );
}

export function LearningPortalSection({ deal }: { deal: CrmDealDetail }) {
  const portal = deal.learningPortal;
  const writeBack = WRITE_BACK[portal.hubspotWriteBack];
  return (
    <DetailSection title="Learning Portal">
      <DetailList
        items={[
          ...portal.environments.map((env) => ({
            label: environmentLabel(env.name),
            value: env.loadedAt ? (
              <span className="inline-flex items-center gap-2">
                <StatusBadge label="Loaded" tone="green" />
                <span className="text-xs text-muted tabular-nums">{formatDateTime(env.loadedAt)}</span>
              </span>
            ) : (
              <StatusBadge label="Not loaded" tone="gray" />
            ),
          })),
          { label: "HubSpot Job ID", value: <StatusBadge label={writeBack.label} tone={writeBack.tone} /> },
        ]}
      />
    </DetailSection>
  );
}

function Reminder({ label, info }: { label: string; info: ReminderInfo | null }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{label}</p>
        {info ? (
          <p className="mt-0.5 text-xs text-muted">
            {formatDateTime(info.at)} · {formatNumber(info.emailCount)} emails · {formatNumber(info.callCount)} calls
            {info.reason ? ` · ${info.reason}` : ""}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted">Not sent yet</p>
        )}
      </div>
      {info && <StatusBadge label={REMINDER_LABELS[info.status]} tone={REMINDER_TONES[info.status]} />}
    </div>
  );
}

export function RemindersSection({ deal }: { deal: CrmDealDetail }) {
  return (
    <DetailSection title="Reminders">
      <div className="space-y-2">
        <Reminder label="10-hour reminder" info={deal.reminders.r10h} />
        <Reminder label="20-hour reminder" info={deal.reminders.r20h} />
      </div>
    </DetailSection>
  );
}

export function TimelineSection({ deal }: { deal: CrmDealDetail }) {
  return (
    <DetailSection title="Timeline">
      {deal.timeline.length === 0 ? (
        <p className="text-sm text-muted">No activity yet.</p>
      ) : (
        <ol className="relative space-y-3 border-l border-line pl-4">
          {deal.timeline.map((entry, i) => (
            <li key={`${entry.status}-${entry.at}-${i}`} className="relative">
              <span aria-hidden className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-primary ring-4 ring-surface" />
              <p className="text-sm text-ink">{entry.label}</p>
              <p className="text-xs text-muted tabular-nums">{formatDateTime(entry.at)}</p>
            </li>
          ))}
        </ol>
      )}
    </DetailSection>
  );
}

export function RecordSection({ deal }: { deal: CrmDealDetail }) {
  return (
    <DetailSection title="Record">
      <DetailList
        items={[
          { label: "Created", value: formatDateTime(deal.createdAt) },
          { label: "Last Updated", value: formatDateTime(deal.updatedAt) },
        ]}
      />
    </DetailSection>
  );
}
