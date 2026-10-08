import { DatabaseZap } from "lucide-react";
import { errorMessage } from "../../api/client";
import { useEligiblePoolSummary, useSyncEligiblePool } from "../../api/admin";
import { formatDateTime, formatNumber } from "../../utils/format";
import { Skeleton } from "../LoadingSkeleton";
import { useToast } from "../toast-context";
import { Button } from "../ui/Button";
import { cardClass } from "../ui/styles";

function EligiblePoolSyncCard() {
  const summary = useEligiblePoolSummary();
  const sync = useSyncEligiblePool();
  const toast = useToast();
  const state = summary.data?.sync;
  const running = state?.status === "RUNNING";
  const configured = summary.data?.syncConfigured ?? false;

  let detail = "Not synced yet. Sync once BigQuery access is ready.";
  if (!configured) detail = "The BigQuery table for eligible students is not added yet. Until then, add students on the Eligible Pool page.";
  else if (running) detail = `Syncing from BigQuery… ${formatNumber(state?.rowsRead ?? 0)} students saved so far`;
  else if (state?.status === "DONE") {
    detail = `Last synced ${formatDateTime(state.finishedAt)}${state.startedBy ? ` by ${state.startedBy}` : ""} · ${formatNumber(state.rowsRead)} students${state.removed ? `, ${formatNumber(state.removed)} removed` : ""}`;
  }

  const startSync = () =>
    sync.mutate(undefined, {
      onSuccess: () => toast.info("Eligible pool sync started"),
      onError: (err) => toast.error(errorMessage(err, "The sync could not be started.")),
    });

  return (
    <div className={`${cardClass} flex flex-wrap items-center justify-between gap-4 p-5`}>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink">Eligible pool · BigQuery sync</p>
        <p className="mt-1 text-sm text-muted">
          Loads students from the BigQuery pool table into the Eligible Pool page. New students start as Eligible. Students
          added or edited by hand are kept as they are. Deals always pick their students from the Eligible Pool page.
        </p>
        {summary.isPending ? (
          <Skeleton className="mt-3 h-4 w-72" />
        ) : (
          <p className="mt-3 text-sm text-ink">
            {detail}
            {summary.data ? ` · ${formatNumber(summary.data.total)} students in the pool now` : ""}
          </p>
        )}
        {state?.status === "FAILED" && (
          <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">
            Last sync failed {formatDateTime(state.finishedAt)}: {state.error}
          </p>
        )}
      </div>
      <Button
        onClick={startSync}
        loading={sync.isPending || running}
        disabled={running || !configured}
        icon={<DatabaseZap className="size-4" aria-hidden />}
      >
        {running ? "Syncing…" : "Sync from BigQuery"}
      </Button>
    </div>
  );
}

export function ConfigSection() {
  return (
    <section aria-labelledby="config-title" className="flex flex-col gap-4">
      <div>
        <h2 id="config-title" className="text-lg font-bold text-ink">
          Config
        </h2>
        <p className="mt-1 text-sm text-muted">Data syncs and other application settings.</p>
      </div>
      <EligiblePoolSyncCard />
    </section>
  );
}
