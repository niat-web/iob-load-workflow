import { useState } from "react";
import { errorMessage } from "../../api/client";
import { useDealReminders, useUpdateDealReminders } from "../../api/crm";
import type { CrmDealDetail, ReminderCheckpoint, ReminderInfo, ReminderSwitch, Tone } from "../../types/api";
import { formatDateTime, formatNumber } from "../../utils/format";
import { ErrorState } from "../ErrorState";
import { LoadingSkeleton } from "../LoadingSkeleton";
import { StatusBadge } from "../StatusBadge";
import { useToast } from "../toast-context";
import { SwitchRow } from "../ui/Switch";
import { Card } from "./DealSections";

const RESULT: Record<ReminderInfo["status"], { label: string; tone: Tone }> = {
  SENT: { label: "Sent", tone: "green" },
  SKIPPED: { label: "Skipped", tone: "gray" },
  FAILED: { label: "Failed", tone: "red" },
};

const hoursText = (hours: number) => `${formatNumber(hours)} hour${hours === 1 ? "" : "s"}`;

function switchHelp(item: ReminderSwitch, product: string, final: boolean) {
  if (item.adminOffReason) return item.adminOffReason;
  const who = `${product} students with job access who have not applied yet`;
  if (item.key === "secondCalls") return `AI calls to ${who} who have a mobile number.`;
  return `${final ? "A final reminder email" : "A reminder email"} to ${who}.`;
}

function checkpointState(checkpoint: ReminderCheckpoint): { label: string; tone: Tone } {
  if (checkpoint.result) return RESULT[checkpoint.result.status];
  if (checkpoint.lockedReason) return { label: "Will not run", tone: "gray" };
  if (checkpoint.runsAt) return { label: "Scheduled", tone: "blue" };
  return { label: "Not scheduled yet", tone: "gray" };
}

function whenText(checkpoint: ReminderCheckpoint) {
  const after = `${hoursText(checkpoint.hours)} after the application window opens`;
  if (checkpoint.result) return `Ran ${formatDateTime(checkpoint.result.at)}`;
  if (checkpoint.runsAt) return `Runs ${formatDateTime(checkpoint.runsAt)} (${after})`;
  return `Runs ${after}`;
}

interface CheckpointCardProps {
  checkpoint: ReminderCheckpoint;
  product: string;
  saving: string | null;
  onToggle: (checkpoint: ReminderCheckpoint, item: ReminderSwitch, next: boolean) => void;
}

function CheckpointCard({ checkpoint, product, saving, onToggle }: CheckpointCardProps) {
  const state = checkpointState(checkpoint);
  const final = checkpoint.key === "r20h";
  const result = checkpoint.result;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{checkpoint.label}</h3>
          <p className="mt-0.5 text-sm text-muted tabular-nums">{whenText(checkpoint)}</p>
        </div>
        <StatusBadge label={state.label} tone={state.tone} />
      </div>
      {result && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3.5 py-3 text-sm">
          <p className="font-semibold text-ink tabular-nums">
            {formatNumber(result.emailCount)} reminder email{result.emailCount === 1 ? "" : "s"}
            {final ? ` · ${formatNumber(result.callCount)} AI call${result.callCount === 1 ? "" : "s"}` : ""}
          </p>
          {result.reason && <p className="mt-0.5 text-xs break-words text-muted">{result.reason}</p>}
        </div>
      )}
      <div className="mt-3 divide-y border-t">
        {checkpoint.switches.map((item) => (
          <SwitchRow
            key={item.key}
            label={item.label}
            description={switchHelp(item, product, final)}
            checked={item.on && !item.adminOffReason}
            disabled={Boolean(checkpoint.lockedReason || item.adminOffReason) || saving === item.key}
            onChange={(next) => onToggle(checkpoint, item, next)}
          />
        ))}
      </div>
      {checkpoint.lockedReason && (
        <p className="mt-1 text-xs text-muted">{checkpoint.lockedReason}, so these switches can no longer change.</p>
      )}
    </Card>
  );
}

function windowText(windowStartAt: string | null, windowEndAt: string | null) {
  if (!windowStartAt) return "The application window has not opened yet.";
  return `Application window: opened ${formatDateTime(windowStartAt)}, closes ${formatDateTime(windowEndAt)}.`;
}

export function DealRemindersTab({ deal }: { deal: CrmDealDetail }) {
  const reminders = useDealReminders(deal.id, deal.isActive);
  const update = useUpdateDealReminders(deal.id);
  const toast = useToast();
  const [saving, setSaving] = useState<string | null>(null);

  if (reminders.isPending) return <LoadingSkeleton lines={8} label="Loading reminders" />;
  if (reminders.isError) {
    return <ErrorState error={reminders.error} onRetry={() => void reminders.refetch()} retrying={reminders.isFetching} />;
  }

  const data = reminders.data;
  const toggle = (checkpoint: ReminderCheckpoint, item: ReminderSwitch, next: boolean) => {
    setSaving(item.key);
    update.mutate(
      { [item.key]: next },
      {
        onSuccess: () =>
          toast.success(`${checkpoint.label}: ${item.label.toLowerCase()} turned ${next ? "on" : "off"} for this deal`),
        onError: (err) => toast.error(errorMessage(err, "The change could not be saved.")),
        onSettled: () => setSaving(null),
      },
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <Card className="bg-slate-50/70">
        <p className="text-sm text-ink">
          Checkpoint reminders go only to {data.product} students who have job access and have not applied yet. Turn a
          switch off before its checkpoint runs to skip it for this deal only.
        </p>
        <p className="mt-1 text-xs text-muted tabular-nums">
          {windowText(data.windowStartAt, data.windowEndAt)} A switch the admin turns off in Settings is off for every
          deal.
        </p>
      </Card>
      <div className="grid items-start gap-5 xl:grid-cols-2">
        {data.checkpoints.map((checkpoint) => (
          <CheckpointCard
            key={checkpoint.key}
            checkpoint={checkpoint}
            product={data.product}
            saving={saving}
            onToggle={toggle}
          />
        ))}
      </div>
    </div>
  );
}
