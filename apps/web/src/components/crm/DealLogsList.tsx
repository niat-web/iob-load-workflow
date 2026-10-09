import { RefreshCw } from "lucide-react";
import { useCrmDealLogs } from "../../api/crm";
import type { LogLevel } from "../../types/api";
import { cn } from "../../utils/cn";
import { formatDateTime } from "../../utils/format";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { LoadingSkeleton } from "../LoadingSkeleton";
import { Button } from "../ui/Button";
import { cardClass } from "../ui/styles";

const LEVEL_STYLES: Record<LogLevel, { row: string; badge: string }> = {
  info: { row: "", badge: "bg-slate-100 text-slate-600" },
  warn: { row: "bg-amber-50/60", badge: "bg-amber-100 text-amber-800" },
  error: { row: "bg-red-50/60", badge: "bg-red-100 text-red-700" },
};

export function DealLogsList({ jobId }: { jobId: string }) {
  const logs = useCrmDealLogs(jobId);

  const renderBody = () => {
    if (logs.isPending) return <LoadingSkeleton lines={12} label="Loading logs" />;
    if (logs.isError) return <ErrorState error={logs.error} onRetry={() => void logs.refetch()} retrying={logs.isFetching} />;
    if (logs.data.items.length === 0) return <EmptyState message="No logs have been recorded for this deal yet." />;
    return (
      <ol className={cn(cardClass, "divide-y overflow-hidden")}>
        {logs.data.items.map((entry, i) => {
          const style = LEVEL_STYLES[entry.level] ?? LEVEL_STYLES.info;
          return (
            <li key={`${entry.at}-${i}`} className={cn("px-5 py-3", style.row)}>
              <div className="flex items-center gap-2 text-xs">
                <span className={cn("rounded px-1.5 py-0.5 font-bold tracking-wider uppercase", style.badge)}>{entry.level}</span>
                <span className="text-muted capitalize">{entry.type}</span>
                <span className="ml-auto text-muted tabular-nums">{formatDateTime(entry.at)}</span>
              </div>
              <p className="mt-1.5 text-sm break-words text-ink">{entry.message}</p>
            </li>
          );
        })}
      </ol>
    );
  };

  return (
    <section aria-label="Deal logs" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Every step, task, email, call and approval for this deal, newest first.</p>
        <Button
          variant="secondary"
          size="sm"
          loading={logs.isFetching}
          onClick={() => void logs.refetch()}
          icon={<RefreshCw className="size-4" aria-hidden />}
        >
          Refresh
        </Button>
      </div>
      {renderBody()}
    </section>
  );
}
