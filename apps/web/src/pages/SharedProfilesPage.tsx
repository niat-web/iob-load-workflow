import { Hourglass, Link2Off, Rows3, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { errorMessage, hasStatus } from "../api/client";
import {
  sharedResumeUrl,
  useAddSharedColumn,
  useAddSharedRow,
  useDeleteSharedColumn,
  useDeleteSharedRow,
  useRenameSharedColumn,
  useSharedProfiles,
  useUpdateSharedCell,
} from "../api/shared";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { SearchInput } from "../components/SearchInput";
import { AddColumnForm, ColumnHeader, EditableCell } from "../components/sheet/SheetCells";
import { SummaryStrip } from "../components/SummaryStrip";
import { useToast } from "../components/toast-context";
import { Button, IconButton } from "../components/ui/Button";
import { cardClass, linkClass } from "../components/ui/styles";
import type { SharedColumn, SharedProfiles, SharedRow } from "../types/api";
import { cn } from "../utils/cn";
import { formatDateTime, formatNumber } from "../utils/format";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <main className="relative mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

function Sheet({ jobId, data }: { jobId: string; data: SharedProfiles }) {
  const toast = useToast();
  const updateCell = useUpdateSharedCell(jobId);
  const addRow = useAddSharedRow(jobId);
  const deleteRow = useDeleteSharedRow(jobId);
  const addColumn = useAddSharedColumn(jobId);
  const renameColumn = useRenameSharedColumn(jobId);
  const deleteColumn = useDeleteSharedColumn(jobId);
  const [search, setSearch] = useState("");
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "row"; row: SharedRow } | { kind: "column"; column: SharedColumn } | null>(null);

  const failed = (fallback: string) => (err: unknown) => toast.error(errorMessage(err, fallback));
  const term = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      term ? data.rows.filter((row) => Object.values(row.values).some((value) => value.toLowerCase().includes(term))) : data.rows,
    [data.rows, term],
  );
  const busy =
    updateCell.isPending || addRow.isPending || deleteRow.isPending || addColumn.isPending || renameColumn.isPending || deleteColumn.isPending;

  const saveCell = (row: SharedRow, column: SharedColumn, value: string) => {
    const id = `${row.id}:${column.key}`;
    setSavingCell(id);
    updateCell.mutate(
      { rowId: row.id, key: column.key, value },
      { onError: failed("The change could not be saved."), onSettled: () => setSavingCell(null) },
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} delay={0} placeholder="Search profiles..." label="Search profiles" className="w-full sm:w-72" />
        <Button
          onClick={() =>
            addRow.mutate({}, {
              onSuccess: () => toast.success("Row added at the bottom"),
              onError: failed("The row could not be added."),
            })
          }
          loading={addRow.isPending}
          icon={<Rows3 className="size-4" aria-hidden />}
        >
          Add row
        </Button>
        <AddColumnForm
          pending={addColumn.isPending}
          onAdd={(label) => addColumn.mutate(label, { onError: failed("The column could not be added.") })}
        />
        <span role="status" className="ml-auto text-xs text-muted">
          {busy ? "Saving…" : `All changes saved${data.updatedAt ? ` · last change ${formatDateTime(data.updatedAt)}` : ""}`}
        </span>
      </div>

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
                  className="border-b border-l border-line px-3 py-2.5 text-left text-xs font-bold tracking-wider whitespace-nowrap text-muted uppercase"
                >
                  <ColumnHeader
                    column={column}
                    onRename={(label) => renameColumn.mutate({ key: column.key, label }, { onError: failed("The column could not be renamed.") })}
                    onDelete={() => setConfirm({ kind: "column", column })}
                  />
                </th>
              ))}
              <th scope="col" className="w-12 border-b border-l border-line">
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id} className="align-top odd:bg-surface even:bg-slate-50/50">
                <td className="border-b border-line px-3 py-2.5 text-xs text-muted tabular-nums">{index + 1}</td>
                {data.columns.map((column) => (
                  <td key={column.key} className="border-b border-l border-line px-1 py-1">
                    {column.key === "resume" ? (
                      row.resumeRef ? (
                        <a href={sharedResumeUrl(jobId, row.resumeRef)} target="_blank" rel="noopener noreferrer" className={cn(linkClass, "px-2 py-1.5")}>
                          View
                          <span className="sr-only"> resume (opens in a new tab)</span>
                        </a>
                      ) : (
                        <span className="block px-2 py-1.5 text-muted/50">—</span>
                      )
                    ) : (
                      <EditableCell
                        value={row.values[column.key] ?? ""}
                        label={`${column.label}, row ${index + 1}`}
                        saving={savingCell === `${row.id}:${column.key}`}
                        onSave={(value) => saveCell(row, column, value)}
                      />
                    )}
                  </td>
                ))}
                <td className="border-b border-l border-line px-1 py-1 text-center">
                  {row.source === "ADDED" && (
                    <IconButton label={`Delete row ${index + 1}`} onClick={() => setConfirm({ kind: "row", row })} className="size-8 text-muted hover:text-red-600">
                      <Trash2 className="size-4" aria-hidden />
                    </IconButton>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={data.columns.length + 2} className="px-4 py-10 text-center text-sm text-muted">
                  {term ? "No profiles match your search." : "No profiles yet. Use Add row to add one."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Click a cell to edit it. Press Enter to save, Shift+Enter for a new line, Esc to cancel. Rows added here can be
        deleted; the shortlisted profiles stay.
      </p>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "column" ? `Delete the column "${confirm.column.label}"?` : "Delete this row?"}
        message={confirm?.kind === "column" ? "Everything in this column is deleted for everyone." : "This row is deleted for everyone."}
        confirmLabel="Delete"
        confirmVariant="danger"
        pending={deleteRow.isPending || deleteColumn.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const done = { onSettled: () => setConfirm(null), onError: failed("It could not be deleted.") };
          if (confirm.kind === "row") deleteRow.mutate(confirm.row.id, done);
          else deleteColumn.mutate(confirm.column.key, done);
        }}
      />
    </>
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
      <h1 className="sr-only">Shared profiles</h1>
      <SummaryStrip
        items={[
          { label: "Company Name", value: data.companyName },
          { label: "Job Role", value: data.jobRole },
          { label: "Total Applied", value: formatNumber(data.totalApplied) },
          { label: "Profiles", value: formatNumber(data.rows.length) },
        ]}
      />
      <Sheet jobId={jobId} data={data} />
    </Shell>
  );
}
