import { ArrowUpRight, Check } from "lucide-react";
import { useState } from "react";
import { errorMessage, hasStatus } from "../../api/client";
import { useApproval, useApproveStep, useStopDeal, useUpdateApprovalPlans } from "../../api/crm";
import type { ApprovalPreview, CrmDealRow, LoadPreview, PreviewItem } from "../../types/api";
import { DASH, formatDateTime, formatNumber } from "../../utils/format";
import { DetailList, DetailSection } from "../DetailList";
import { Drawer } from "../Drawer";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { LoadingSkeleton } from "../LoadingSkeleton";
import { StatusBadge } from "../StatusBadge";
import { useToast } from "../toast-context";
import { Button } from "../ui/Button";
import { linkClass } from "../ui/styles";

interface ApprovalDrawerProps {
  job: CrmDealRow | null;
  onClose: () => void;
}

const environmentLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

const hoursLabel = (hours: number) => (hours < 1 ? `${Math.round(hours * 60)} min` : `${hours} h`);

const linkText = (item: PreviewItem) => {
  const value = item.value ?? "";
  return value.length > 48 ? "Open link" : value;
};

const previewItems = (items: PreviewItem[]) =>
  items.map((item) => ({
    label: item.label,
    wide: item.wide,
    value: item.href ? (
      <span className="inline-flex items-center gap-2.5">
        {item.image && (
          <img
            src={item.href}
            alt={item.label}
            className="size-10 rounded-md border bg-surface object-contain p-1"
            loading="lazy"
          />
        )}
        <a href={item.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
          {item.image ? "View URL" : linkText(item)}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </span>
    ) : (
      (item.value ?? DASH)
    ),
  }));

function TextBlock({ text }: { text: string }) {
  if (!text) return <p className="text-sm text-muted">{DASH}</p>;
  return <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm whitespace-pre-wrap text-ink">{text}</p>;
}

function PlanChips({ plans }: { plans: string[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {plans.map((plan) => (
        <span key={plan} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
          {plan}
        </span>
      ))}
    </span>
  );
}

function PlanEditor({ jobId, load }: { jobId: string; load: LoadPreview }) {
  const [selected, setSelected] = useState<string[]>(load.enrollPlans);
  const update = useUpdateApprovalPlans(jobId);
  const toast = useToast();
  const changed =
    selected.length !== load.enrollPlans.length || selected.some((plan) => !load.enrollPlans.includes(plan));
  const toggle = (plan: string) =>
    setSelected((current) => (current.includes(plan) ? current.filter((item) => item !== plan) : [...current, plan]));

  const save = () =>
    update.mutate(selected, {
      onSuccess: () => toast.success("Course plans updated"),
      onError: (err) => toast.error(errorMessage(err, "The course plans could not be saved.")),
    });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {load.planOptions.map((plan) => (
          <label key={plan} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={selected.includes(plan)}
              onChange={() => toggle(plan)}
              className="size-4 shrink-0 accent-primary"
            />
            <span className="break-all">{plan}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          disabled={!changed || selected.length === 0}
          loading={update.isPending}
          onClick={save}
        >
          Save course plans
        </Button>
        {selected.length === 0 ? (
          <span className="text-xs text-red-600">Choose at least one course plan.</span>
        ) : (
          changed && <span className="text-xs text-muted">Saving rewrites the eligibility text for these plans.</span>
        )}
      </div>
    </div>
  );
}

function LoadView({ jobId, load }: { jobId: string; load: LoadPreview }) {
  const where = environmentLabel(load.environment);
  return (
    <>
      <DetailSection title={`Load into ${where}`}>
        <DetailList
          items={[
            {
              label: "Organisation",
              value: (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {load.organisation.name ?? DASH}
                  <StatusBadge
                    label={load.organisation.existsInPortal ? `Already in ${where}` : `Will be created in ${where}`}
                    tone={load.organisation.existsInPortal ? "green" : "blue"}
                  />
                </span>
              ),
              wide: true,
            },
            { label: "Organisation ID", value: <span className="break-all tabular-nums">{load.organisation.id ?? DASH}</span>, wide: true },
            { label: "Job ID", value: <span className="break-all tabular-nums">{load.jobId ?? DASH}</span>, wide: true },
            {
              label: "Apply link",
              value: load.applyLink ? (
                <a href={load.applyLink} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  Open apply link
                  <ArrowUpRight className="size-3.5" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                DASH
              ),
            },
            { label: "Test accounts", value: formatNumber(load.testAccounts) },
            {
              label: "Already loaded in",
              value: load.loadedIn.length
                ? load.loadedIn.map((env) => `${environmentLabel(env.name)} (${formatDateTime(env.loadedAt)})`).join(", ")
                : "None yet",
              wide: true,
            },
          ]}
        />
      </DetailSection>

      <DetailSection title="Course plans">
        {load.canEditPlans ? <PlanEditor jobId={jobId} load={load} /> : <PlanChips plans={load.enrollPlans} />}
      </DetailSection>

      <DetailSection title="Job">
        <DetailList items={previewItems(load.details)} />
      </DetailSection>

      <DetailSection title="Eligibility criteria">
        {load.eligibility.length ? (
          <div className="space-y-4">
            {load.eligibility.map((group) => (
              <div key={group.plans.join(",")} className="space-y-1.5">
                <p className="text-xs font-bold tracking-wider break-all text-muted uppercase">{group.plans.join(", ")}</p>
                <TextBlock text={group.text} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{DASH}</p>
        )}
      </DetailSection>

      <DetailSection title="Disclaimer">
        <TextBlock text={load.disclaimer} />
      </DetailSection>

      <DetailSection title="Company description">
        <TextBlock text={load.organisationDescription} />
      </DetailSection>
    </>
  );
}

function StepPreview({ jobId, preview }: { jobId: string; preview: ApprovalPreview }) {
  return (
    <>
      {preview.deal && (
        <DetailSection title="Deal details">
          <DetailList items={previewItems(preview.deal)} />
        </DetailSection>
      )}
      {preview.load && <LoadView jobId={jobId} load={preview.load} />}
      {preview.students && (
        <DetailSection title="Eligible students">
          <DetailList
            items={[
              { label: "Eligible students", value: formatNumber(preview.students.total) },
              { label: "Access given in", value: environmentLabel(preview.students.accessEnvironment) },
              { label: "With an email", value: formatNumber(preview.students.withEmail) },
              { label: "With a phone number", value: formatNumber(preview.students.withPhone) },
            ]}
          />
        </DetailSection>
      )}
      {preview.window && (
        <DetailSection title="Application window">
          <DetailList
            items={[
              { label: "Students with access", value: formatNumber(preview.window.granted) },
              { label: "Refused by the portal", value: formatNumber(preview.window.rejected) },
              {
                label: "Window length",
                value: preview.window.closed
                  ? "None. The job's deadline on the portal has passed"
                  : preview.window.windowHours < preview.window.plannedWindowHours
                    ? `${hoursLabel(preview.window.windowHours)} left of ${hoursLabel(preview.window.plannedWindowHours)}`
                    : hoursLabel(preview.window.windowHours),
              },
              { label: "Student checkpoints after", value: preview.window.reminderHours.map(hoursLabel).join(" and ") },
              { label: "Closes at", value: formatDateTime(preview.window.closesAt) },
            ]}
          />
        </DetailSection>
      )}
    </>
  );
}

export function ApprovalDrawer({ job, onClose }: ApprovalDrawerProps) {
  const approval = useApproval(job?.id ?? null);
  const approve = useApproveStep();
  const stop = useStopDeal();
  const toast = useToast();
  const [confirmingStop, setConfirmingStop] = useState(false);

  const close = () => {
    setConfirmingStop(false);
    onClose();
  };

  const handleApprove = (preview: ApprovalPreview) => {
    if (!job) return;
    approve.mutate(
      { jobId: job.id, gate: preview.gate },
      {
        onSuccess: () => {
          toast.success(`Approved: ${preview.label}`);
          close();
        },
        onError: (err) => toast.error(errorMessage(err, "This step could not be approved.")),
      },
    );
  };

  const handleStop = () => {
    if (!job) return;
    stop.mutate(job.id, {
      onSuccess: () => {
        toast.success(`Deal ${job.hubspotDealId} stopped`);
        close();
      },
      onError: (err) => toast.error(errorMessage(err, "The deal could not be stopped.")),
    });
  };

  const renderBody = () => {
    if (!job) return null;
    if (approval.isPending) return <LoadingSkeleton lines={10} label="Loading the step to approve" />;
    if (approval.isError) {
      if (hasStatus(approval.error, 404, 409)) return <EmptyState message="This deal is no longer waiting for approval." />;
      return <ErrorState error={approval.error} onRetry={() => void approval.refetch()} retrying={approval.isFetching} />;
    }
    const preview = approval.data.approval;
    return (
      <div className="space-y-6">
        <div className="rounded-lg bg-slate-50 px-4 py-3">
          <p className="text-sm font-semibold text-ink">{preview.label}</p>
          <p className="mt-0.5 text-sm text-muted">{preview.description}</p>
          {preview.requestedAt && (
            <p className="mt-1 text-xs text-muted tabular-nums">Waiting since {formatDateTime(preview.requestedAt)}</p>
          )}
        </div>

        <StepPreview key={job.id} jobId={job.id} preview={preview} />

        <div className="sticky bottom-0 -mx-5 -mb-5 border-t bg-surface px-5 py-4">
          {confirmingStop ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink">Stop this deal? No further steps will run.</p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setConfirmingStop(false)} disabled={stop.isPending}>
                  Keep deal
                </Button>
                <Button variant="danger" onClick={handleStop} loading={stop.isPending}>
                  Stop deal
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                variant="ghost"
                className="text-red-600 hover:text-red-700"
                onClick={() => setConfirmingStop(true)}
                disabled={approve.isPending}
              >
                Stop deal
              </Button>
              <Button
                onClick={() => handleApprove(preview)}
                loading={approve.isPending}
                icon={<Check className="size-4" aria-hidden />}
              >
                Approve and continue
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Drawer
      open={job !== null}
      onClose={close}
      title={job ? `Approve · Deal ${job.hubspotDealId}` : ""}
      headerExtra={<StatusBadge label="Waiting for Approval" tone="yellow" />}
    >
      {renderBody()}
    </Drawer>
  );
}
