import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Bot, Mail, PhoneCall, RefreshCw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { errorMessage, hasStatus } from "../api/client";
import { useBoost, useBoostCalls, useBoostEmails, useBoostSync } from "../api/crm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/toast-context";
import { Button } from "../components/ui/Button";
import { cardClass, linkClass } from "../components/ui/styles";
import type { AiCallStatus, BoostCallRow, BoostOverview, Tone } from "../types/api";
import { cn } from "../utils/cn";
import { formatDateTime, formatNumber } from "../utils/format";

const STATUS: Record<AiCallStatus, { label: string; tone: Tone }> = {
  QUEUED: { label: "Queued", tone: "gray" },
  CALLING: { label: "Calling", tone: "yellow" },
  COMPLETED: { label: "Completed", tone: "green" },
  NO_ANSWER: { label: "No answer", tone: "orange" },
  BUSY: { label: "Busy", tone: "orange" },
  FAILED: { label: "Failed", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "gray" },
};

const answerTone = (value: string | null): Tone => {
  const text = (value ?? "").toLowerCase();
  if (text === "yes") return "green";
  if (text === "no") return "red";
  return "yellow";
};

function duration(seconds: number | null) {
  if (!seconds) return null;
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

const text = (value: string | number | null, className?: string) =>
  value === null || value === "" ? null : <span className={className}>{value}</span>;

const callColumns: ColumnDef<BoostCallRow>[] = [
  { id: "name", header: "Name", cell: ({ row }) => text(row.original.name, "font-semibold text-ink") },
  { id: "phone", header: "Mobile", cell: ({ row }) => text(row.original.phone, "tabular-nums") },
  {
    id: "status",
    header: "Call Status",
    cell: ({ row }) => (
      <StatusBadge
        label={STATUS[row.original.status]?.label ?? row.original.status}
        tone={STATUS[row.original.status]?.tone ?? "gray"}
      />
    ),
  },
  {
    id: "duration",
    header: "Duration",
    cell: ({ row }) => text(duration(row.original.durationSeconds), "tabular-nums"),
  },
  {
    id: "interested",
    header: "Interested",
    cell: ({ row }) =>
      row.original.interested ? (
        <StatusBadge label={row.original.interested} tone={answerTone(row.original.interested)} />
      ) : null,
  },
  {
    id: "willApply",
    header: "Will Apply",
    cell: ({ row }) =>
      row.original.willApply ? (
        <StatusBadge label={row.original.willApply} tone={answerTone(row.original.willApply)} />
      ) : null,
  },
  {
    id: "reason",
    header: "Reason Not Applied",
    cell: ({ row }) => text(row.original.reason, "block max-w-56 truncate"),
  },
  { id: "questions", header: "Questions", cell: ({ row }) => text(row.original.questions, "block max-w-48 truncate") },
  { id: "callBack", header: "Call Back", cell: ({ row }) => text(row.original.callBack) },
  {
    id: "rating",
    header: "Rating",
    cell: ({ row }) =>
      text(
        row.original.overallRating === null ? null : `${Math.round(row.original.overallRating * 10) / 10} / 5`,
        "tabular-nums",
      ),
  },
  {
    id: "remarks",
    header: "Remarks",
    cell: ({ row }) => {
      const value = row.original.remarks || row.original.summary || row.original.error;
      return value ? (
        <span className="block max-w-72 truncate" title={value}>
          {value}
        </span>
      ) : null;
    },
  },
  {
    id: "recording",
    header: "Recording",
    cell: ({ row }) =>
      row.original.recordingUrl ? (
        <a href={row.original.recordingUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
          Listen
        </a>
      ) : null,
  },
  {
    id: "calledAt",
    header: "Called At",
    cell: ({ row }) => text(row.original.calledAt ? formatDateTime(row.original.calledAt) : null, "tabular-nums"),
  },
];

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className={cn(cardClass, "px-5 py-4")}>
      <p className="text-xs font-bold tracking-wider text-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function ActionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={cn(cardClass, "flex flex-col gap-4 p-5")}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <div className="mt-1 text-sm text-muted">{description}</div>
        </div>
      </div>
      {children}
    </section>
  );
}

function BoostContent({ data, jobId }: { data: BoostOverview; jobId: string }) {
  const toast = useToast();
  const emails = useBoostEmails(jobId);
  const calls = useBoostCalls(jobId);
  const sync = useBoostSync(jobId);
  const [confirm, setConfirm] = useState<"emails" | "calls" | null>(null);
  const { deal, notApplied } = data;
  const counts = data.calls.counts;
  const finished = counts.COMPLETED + counts.NO_ANSWER + counts.BUSY + counts.FAILED + counts.CANCELLED;
  const total = finished + counts.QUEUED + counts.CALLING;
  const emailBlocked = !deal.windowOpen || notApplied.withEmail === 0 || Boolean(data.emails.availableAt);
  const callBlocked =
    !deal.windowOpen || notApplied.withPhone === 0 || data.calls.active || Boolean(data.calls.setupProblem);
  const minutes = Math.round(data.calls.maxSeconds / 60);
  const items = useMemo(() => data.calls.items, [data.calls.items]);

  const run = (kind: "emails" | "calls") => {
    const mutation = kind === "emails" ? emails : calls;
    mutation.mutate(undefined, {
      onSuccess: () => {
        setConfirm(null);
        toast.success(
          kind === "emails" ? "Reminder emails sent" : "AI calls started. Results appear here as calls finish.",
        );
      },
    });
  };
  const pendingAction = confirm === "emails" ? emails : calls;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/crm/deals"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Deals
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">Boost applications</h1>
          <p className="mt-1 text-sm text-muted">
            {deal.companyName} · {deal.jobRole} · Deal {deal.hubspotDealId}
          </p>
        </div>
        <StatusBadge
          label={
            deal.windowOpen
              ? `Applications close ${formatDateTime(deal.applicationEndAt)}`
              : "Application window closed"
          }
          tone={deal.windowOpen ? "blue" : "gray"}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Expected Pool" value={formatNumber(deal.expectedPoolCount)} />
        <Stat
          label="Applied"
          value={formatNumber(deal.appliedCount)}
          hint={`of ${formatNumber(deal.eligibleCount)} eligible`}
        />
        <Stat
          label="Not Applied"
          value={formatNumber(notApplied.total)}
          hint={`${notApplied.withEmail} with email · ${notApplied.withPhone} with mobile`}
        />
        <Stat
          label="AI Calls"
          value={formatNumber(total)}
          hint={`${data.calls.interested} interested · ${data.calls.willApply} will apply`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ActionCard
          icon={<Mail className="size-5" aria-hidden />}
          title="Send reminder email"
          description={`Email the ${notApplied.withEmail} students who have not applied, with the job details and apply link.`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => setConfirm("emails")}
              disabled={emailBlocked}
              icon={<Mail className="size-4" aria-hidden />}
            >
              Send reminder email
            </Button>
            {data.emails.availableAt && (
              <span className="text-xs text-muted">Next send possible {formatDateTime(data.emails.availableAt)}</span>
            )}
          </div>
          {data.emails.runs.length > 0 && (
            <ul className="space-y-1 border-t pt-3 text-xs text-muted">
              {data.emails.runs.slice(0, 5).map((emailRun) => (
                <li key={emailRun.at}>
                  {formatDateTime(emailRun.at)} · {emailRun.sent} sent
                  {emailRun.skipped ? ` · ${emailRun.skipped} skipped` : ""}
                  {emailRun.failed ? ` · ${emailRun.failed} failed` : ""}
                  {emailRun.by ? ` · by ${emailRun.by}` : ""}
                </li>
              ))}
            </ul>
          )}
        </ActionCard>

        <ActionCard
          icon={<PhoneCall className="size-5" aria-hidden />}
          title="AI calls"
          description={`Call the ${notApplied.withPhone} students with a mobile number who have not applied. A voice agent built from this job's description talks with each student for up to ${minutes} minute${minutes === 1 ? "" : "s"}, encourages them to apply and records their answers.`}
        >
          {data.calls.setupProblem && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {data.calls.setupProblem}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => setConfirm("calls")}
              disabled={callBlocked}
              icon={<PhoneCall className="size-4" aria-hidden />}
            >
              {data.calls.active ? "Calls in progress…" : "Start AI calls"}
            </Button>
            {data.calls.runs.length > 0 && (
              <Button
                variant="secondary"
                loading={sync.isPending}
                onClick={() =>
                  sync.mutate(undefined, {
                    onError: (err) => toast.error(errorMessage(err, "Results could not be refreshed.")),
                  })
                }
                icon={<RefreshCw className="size-4" aria-hidden />}
              >
                Refresh results
              </Button>
            )}
          </div>
          <p className="flex items-start gap-2 border-t pt-3 text-xs text-muted">
            <Bot className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {data.calls.agentId
              ? `Agent ready${data.calls.agentCreatedAt ? ` (created ${formatDateTime(data.calls.agentCreatedAt)})` : ""}. It uses each student's name and this job's details.`
              : "The agent is created automatically from this job's description the first time you start calls."}
          </p>
          {data.calls.spokenJd && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer font-semibold text-ink">What the agent says about the job</summary>
              <p className="mt-1.5 rounded-md bg-slate-50 p-3 leading-relaxed">{data.calls.spokenJd}</p>
            </details>
          )}
        </ActionCard>
      </div>

      <section className="flex min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-ink">AI call results</h2>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(STATUS) as AiCallStatus[])
              .filter((status) => counts[status] > 0)
              .map((status) => (
                <StatusBadge
                  key={status}
                  label={`${STATUS[status].label} ${counts[status]}`}
                  tone={STATUS[status].tone}
                />
              ))}
          </div>
        </div>
        {data.calls.active && (
          <p className="text-sm text-muted">
            {finished} of {total} calls finished. This page refreshes on its own every 15 seconds.
          </p>
        )}
        <div className="flex h-[560px] min-h-0 flex-col">
          <DataTable
            caption="AI call results"
            data={items}
            columns={callColumns}
            getRowId={(row) => row.id}
            isLoading={false}
            emptyState={
              <EmptyState
                message="No AI calls yet."
                description="Start AI calls above to reach students who have not applied."
              />
            }
          />
        </div>
      </section>

      {data.crmAlerts.length > 0 && (
        <section className={cn(cardClass, "p-5")}>
          <h2 className="text-sm font-bold tracking-wider text-muted uppercase">Alerts sent to the CRM</h2>
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {data.crmAlerts.map((alert) => (
              <li key={`${alert.reminder}-${alert.at}`}>
                {formatDateTime(alert.at)} · {alert.appliedCount} of {alert.expectedPoolCount ?? "?"} applied ·{" "}
                {alert.notApplied} not applied
                {alert.to ? ` · emailed ${alert.to}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "emails" ? "Send reminder emails?" : "Start AI calls?"}
        message={
          confirm === "emails"
            ? `${notApplied.withEmail} students who have not applied will get a reminder email.`
            : `Up to ${notApplied.withPhone} students who have not applied will be called one by one. Each call lasts at most ${minutes} minute${minutes === 1 ? "" : "s"}. Students already reached are not called again.`
        }
        confirmLabel={confirm === "emails" ? "Send emails" : "Start calls"}
        pending={pendingAction.isPending}
        error={pendingAction.isError ? errorMessage(pendingAction.error, "This action could not be completed.") : null}
        onConfirm={() => confirm && run(confirm)}
        onCancel={() => {
          setConfirm(null);
          emails.reset();
          calls.reset();
        }}
      />
    </div>
  );
}

export function BoostPage() {
  const { jobId = "" } = useParams();
  const boost = useBoost(jobId);

  if (boost.isPending) {
    return (
      <div className={cn(cardClass, "p-6")}>
        <LoadingSkeleton lines={8} label="Loading" />
      </div>
    );
  }
  if (boost.isError) {
    if (hasStatus(boost.error, 404)) return <EmptyState message="This deal could not be found." />;
    return <ErrorState error={boost.error} onRetry={() => void boost.refetch()} retrying={boost.isFetching} />;
  }
  return <BoostContent data={boost.data} jobId={jobId} />;
}
