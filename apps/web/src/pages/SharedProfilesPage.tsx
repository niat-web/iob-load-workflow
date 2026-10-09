import { Hourglass, Link2Off } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { errorMessage, hasStatus } from "../api/client";
import { sharedResumeUrl, useSharedProfiles, useUpdateSharedCell } from "../api/shared";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { OptionCell, TextCell } from "../components/sheet/SheetCells";
import { useToast } from "../components/toast-context";
import { cardClass, linkClass } from "../components/ui/styles";
import type { SharedColumn, SharedProfiles, SharedRow } from "../types/api";
import { cn } from "../utils/cn";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <main className="relative mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

function Sheet({ jobId, data }: { jobId: string; data: SharedProfiles }) {
  const toast = useToast();
  const updateCell = useUpdateSharedCell(jobId);
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const saveCell = (row: SharedRow, column: SharedColumn, value: string) => {
    const id = `${row.id}:${column.key}`;
    setSavingCell(id);
    updateCell.mutate(
      { rowId: row.id, key: column.key, value },
      {
        onError: (err) => toast.error(errorMessage(err, "The change could not be saved.")),
        onSettled: () => setSavingCell(null),
      },
    );
  };

  const cell = (row: SharedRow, column: SharedColumn, index: number) => {
    if (column.type === "resume") {
      return row.resumeRef ? (
        <a
          href={sharedResumeUrl(jobId, row.resumeRef)}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(linkClass, "px-2 py-1.5")}
        >
          View
          <span className="sr-only"> resume (opens in a new tab)</span>
        </a>
      ) : (
        <span className="block px-2 py-1.5 text-muted/50">—</span>
      );
    }
    if (column.type === "select") {
      return (
        <OptionCell
          value={row.values[column.key] ?? ""}
          options={column.options}
          label={`${column.label}, row ${index + 1}`}
          saving={savingCell === `${row.id}:${column.key}`}
          onSave={(value) => saveCell(row, column, value)}
        />
      );
    }
    return <TextCell value={row.values[column.key] ?? ""} />;
  };

  return (
    <div className={cn(cardClass, "min-h-[320px] shrink-0 overflow-x-auto overflow-y-hidden")}>
      <table className="w-full border-collapse text-sm">
        <thead className="bg-header">
          <tr>
            <th scope="col" className="w-12 border-b border-line px-3 py-2.5 text-left text-xs font-bold tracking-wider text-muted uppercase">
              #
            </th>
            {data.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "border-b border-l border-line px-3 py-2.5 text-left text-xs font-bold tracking-wider whitespace-nowrap text-muted uppercase",
                  column.editable && "bg-primary-soft/40",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, index) => (
            <tr key={row.id} className="align-middle odd:bg-surface even:bg-slate-50/50">
              <td className="border-b border-line px-3 py-2.5 text-xs text-muted tabular-nums">{index + 1}</td>
              {data.columns.map((column) => (
                <td key={column.key} className="border-b border-l border-line px-1.5 py-1">
                  {cell(row, column, index)}
                </td>
              ))}
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr>
              <td colSpan={data.columns.length + 1} className="px-4 py-10 text-center text-sm text-muted">
                No profiles yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SharedProfilesPage() {
  const { jobId = "" } = useParams();
  const profiles = useSharedProfiles(jobId);

  if (!jobId || hasStatus(profiles.error, 404, 400)) {
    return (
      <Shell>
        <div className={cardClass}>
          <EmptyState icon={<Link2Off className="size-5" aria-hidden />} message="This link is not valid" />
        </div>
      </Shell>
    );
  }
  if (hasStatus(profiles.error, 410)) {
    return (
      <Shell>
        <div className={cardClass}>
          <EmptyState icon={<Hourglass className="size-5" aria-hidden />} message="This link has expired" />
        </div>
      </Shell>
    );
  }
  if (profiles.isError) {
    return (
      <Shell>
        <div className={cardClass}>
          <ErrorState error={profiles.error} onRetry={() => void profiles.refetch()} retrying={profiles.isFetching} />
        </div>
      </Shell>
    );
  }
  if (profiles.isPending) {
    return (
      <Shell>
        <div className={cn(cardClass, "p-6")}>
          <LoadingSkeleton lines={8} label="Loading profiles" />
        </div>
      </Shell>
    );
  }

  const data = profiles.data;
  return (
    <Shell>
      <h1 className="sr-only">
        Shared profiles{data.companyName ? ` for ${data.companyName}` : ""}
        {data.jobRole ? `, ${data.jobRole}` : ""}
      </h1>
      <Sheet jobId={jobId} data={data} />
    </Shell>
  );
}
