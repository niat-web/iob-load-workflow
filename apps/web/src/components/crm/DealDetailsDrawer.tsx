import { ArrowUpRight, Copy } from "lucide-react";
import { hasStatus } from "../../api/client";
import { useCrmDeal } from "../../api/crm";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import type { CrmDealDetail, CrmDealRow, HubspotWriteBack, ReminderInfo, Tone } from "../../types/api";
import { DASH, formatDateTime, formatNumber, orDash } from "../../utils/format";
import { DetailList, DetailSection } from "../DetailList";
import { Drawer } from "../Drawer";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { LoadingSkeleton } from "../LoadingSkeleton";
import { ProgressBar } from "../ProgressBar";
import { StatusBadge } from "../StatusBadge";
import { IconButton } from "../ui/Button";
import { linkClass } from "../ui/styles";

interface DealDetailsDrawerProps {
  job: CrmDealRow | null;
  onClose: () => void;
}

const REMINDER_TONES: Record<ReminderInfo["status"], Tone> = { SENT: "green", SKIPPED: "gray", FAILED: "red" };
const REMINDER_LABELS: Record<ReminderInfo["status"], string> = { SENT: "Sent", SKIPPED: "Skipped", FAILED: "Failed" };
const WRITE_BACK: Record<HubspotWriteBack, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "gray" },
  DONE: { label: "Job ID saved", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  SKIPPED: { label: "Off", tone: "gray" },
};

const environmentLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

function FlowSection({ deal }: { deal: CrmDealDetail }) {
  const stepByStep = deal.flowMode === "STEP_BY_STEP";
  const items = [
    { label: "Mode", value: stepByStep ? "Step by step" : "Automatic" },
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

function LearningPortalSection({ portal }: { portal: CrmDealDetail["learningPortal"] }) {
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
          { label: "Job ID", value: <span className="break-all tabular-nums">{orDash(portal.jobId)}</span>, wide: true },
          { label: "Organisation ID", value: <span className="break-all tabular-nums">{orDash(portal.organisationId)}</span>, wide: true },
          { label: "Order", value: formatNumber(portal.order) },
          { label: "HubSpot Job ID", value: <StatusBadge label={writeBack.label} tone={writeBack.tone} /> },
        ]}
      />
    </DetailSection>
  );
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
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

function DealDetailBody({ deal }: { deal: CrmDealDetail }) {
  const copy = useCopyToClipboard();
  const owner = [deal.crmOwnerName, deal.crmOwnerEmail].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-slate-50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-semibold text-ink">{deal.currentStep}</p>
          <ProgressBar value={deal.progressPercent} label="Workflow progress" />
        </div>
        {deal.lastError && (
          <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            {deal.lastError}
          </p>
        )}
      </div>

      <DetailSection title="Job">
        <DetailList
          items={[
            { label: "Company", value: orDash(deal.companyName) },
            { label: "Job Role", value: orDash(deal.jobRole) },
            { label: "Location", value: orDash(deal.location) },
            { label: "CTC", value: orDash(deal.ctc) },
            { label: "Employment Type", value: orDash(deal.employmentType) },
            { label: "Openings", value: formatNumber(deal.openings) },
            { label: "Batch", value: orDash(deal.batch) },
            { label: "Campus", value: orDash(deal.campus) },
            { label: "Program", value: orDash(deal.program) },
            { label: "CRM Owner", value: owner || DASH },
            { label: "Profiling POC", value: deal.profilingPoc?.name ?? DASH },
            { label: "ISE", value: deal.ise?.name ?? DASH },
            {
              label: "Skills",
              wide: true,
              value:
                deal.skills.length > 0 ? (
                  <span className="flex flex-wrap gap-1.5">
                    {deal.skills.map((skill) => (
                      <span key={skill} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {skill}
                      </span>
                    ))}
                  </span>
                ) : (
                  DASH
                ),
            },
          ]}
        />
      </DetailSection>

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
      </DetailSection>

      <FlowSection deal={deal} />

      <LearningPortalSection portal={deal.learningPortal} />

      <DetailSection title="Links">
        <DetailList
          items={[
            {
              label: "Student Apply Link",
              value: deal.learningPortalJobUrl ? (
                <ExternalLink href={deal.learningPortalJobUrl}>Open link</ExternalLink>
              ) : (
                DASH
              ),
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

      <DetailSection title="Reminders">
        <div className="space-y-2">
          <Reminder label="10-hour reminder" info={deal.reminders.r10h} />
          <Reminder label="20-hour reminder" info={deal.reminders.r20h} />
        </div>
      </DetailSection>

      <DetailSection title="Timeline">
        {deal.timeline.length === 0 ? (
          <p className="text-sm text-muted">No activity yet.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-line pl-4">
            {deal.timeline.map((entry, i) => (
              <li key={`${entry.status}-${entry.at}-${i}`} className="relative">
                <span
                  aria-hidden
                  className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-primary ring-4 ring-surface"
                />
                <p className="text-sm text-ink">{entry.label}</p>
                <p className="text-xs text-muted tabular-nums">{formatDateTime(entry.at)}</p>
              </li>
            ))}
          </ol>
        )}
      </DetailSection>

      <DetailSection title="Record">
        <DetailList
          items={[
            { label: "Created", value: formatDateTime(deal.createdAt) },
            { label: "Last Updated", value: formatDateTime(deal.updatedAt) },
          ]}
        />
      </DetailSection>
    </div>
  );
}

export function DealDetailsDrawer({ job, onClose }: DealDetailsDrawerProps) {
  const detail = useCrmDeal(job?.id ?? null);

  const renderBody = () => {
    if (detail.isPending) return <LoadingSkeleton lines={10} label="Loading deal details" />;
    if (detail.isError) {
      if (hasStatus(detail.error, 404)) return <EmptyState message="This deal could not be found." />;
      return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />;
    }
    return <DealDetailBody deal={detail.data} />;
  };

  return (
    <Drawer
      open={job !== null}
      onClose={onClose}
      title={job ? `Deal ${job.hubspotDealId}` : ""}
      headerExtra={<StatusBadge chip={detail.data?.displayStatus ?? job?.displayStatus} />}
    >
      {renderBody()}
    </Drawer>
  );
}
