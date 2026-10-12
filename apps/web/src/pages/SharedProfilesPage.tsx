import { Hourglass, Link2Off, Rows3, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
import { AddColumnForm, ColumnHeader, EditableCell, OptionCell } from "../components/sheet/SheetCells";
import { FreezeMenu } from "../components/sheet/SheetControls";
import { useToast } from "../components/toast-context";
import { Button } from "../components/ui/Button";
import { cardClass, linkClass } from "../components/ui/styles";
import { useSheetLayout } from "../hooks/useSheetLayout";
import type { SharedColumn, SharedProfiles, SharedRow } from "../types/api";
import { cn } from "../utils/cn";
import { formatDateTime } from "../utils/format";

const ROW_NUMBER_WIDTH = 48;
const LETTER_ROW_HEIGHT = 24;
const FROZEN_EDGE = "shadow-[6px_0_8px_-6px_rgb(15_23_42/0.18)]";
const FROZEN_ROW_EDGE = "border-b-2 border-b-slate-300";
const FROZEN_WIDTH = 190;
const WIDTHS: Record<string, number> = {
  fullName: FROZEN_WIDTH,
  mobile: 150,
  email: 250,
  bachelorsCourse: 210,
  bachelorsDepartment: 250,
  bachelorsYear: 200,
  bachelorsPercentage: 170,
  resume: 100,
};
const widthOf = (column: SharedColumn) => WIDTHS[column.key] ?? (column.type === "select" ? 180 : 190);

function columnLetter(index: number) {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <main className="relative flex min-h-0 w-full flex-1 flex-col gap-3 px-3 py-3 sm:px-4">{children}</main>
    </div>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <Shell>
      <div className={cn(cardClass, "mx-auto mt-10 w-full max-w-xl")}>{children}</div>
    </Shell>
  );
}

const gridLine = "border-r border-b border-[#e1e3e6]";

function Sheet({ jobId, data }: { jobId: string; data: SharedProfiles }) {
  const toast = useToast();
  const updateCell = useUpdateSharedCell(jobId);
  const addRow = useAddSharedRow(jobId);
  const deleteRow = useDeleteSharedRow(jobId);
  const addColumn = useAddSharedColumn(jobId);
  const renameColumn = useRenameSharedColumn(jobId);
  const deleteColumn = useDeleteSharedColumn(jobId);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const layout = useSheetLayout(`shared-sheet-${jobId}`, { freezeColumns: 1 });
  const headRefs = useRef(new Map<string, HTMLTableCellElement>());
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const headerRowRef = useRef<HTMLTableRowElement>(null);
  const [measured, setMeasured] = useState<{ widths: number[]; heights: number[]; header: number }>({
    widths: [],
    heights: [],
    header: 0,
  });
  useLayoutEffect(() => {
    const widths = data.columns.map((column) => headRefs.current.get(column.key)?.offsetWidth ?? 0);
    const heights = data.rows.map((row) => rowRefs.current.get(row.id)?.offsetHeight ?? 0);
    const header = headerRowRef.current?.offsetHeight ?? 0;
    setMeasured((current) =>
      current.header === header && current.widths.join() === widths.join() && current.heights.join() === heights.join()
        ? current
        : { widths, heights, header },
    );
  });
  const frozenColumns = Math.min(layout.freezeColumns, data.columns.length);
  const frozenRows = Math.min(layout.freezeRows, data.rows.length);
  const leftOf = (index: number) => ROW_NUMBER_WIDTH + measured.widths.slice(0, index).reduce((sum, width) => sum + width, 0);
  const topOf = (index: number) =>
    LETTER_ROW_HEIGHT + measured.header + measured.heights.slice(0, index).reduce((sum, height) => sum + height, 0);
  const columnStyle = (column: SharedColumn, index: number): CSSProperties => ({
    minWidth: widthOf(column),
    ...(index < frozenColumns ? { left: leftOf(index) } : {}),
  });
  const [confirm, setConfirm] = useState<{ kind: "row"; row: SharedRow; number: number } | { kind: "column"; column: SharedColumn } | null>(null);

  const failed = (fallback: string) => (err: unknown) => toast.error(errorMessage(err, fallback));
  const busy =
    updateCell.isPending || addRow.isPending || deleteRow.isPending || addColumn.isPending || renameColumn.isPending || deleteColumn.isPending;

  const saveCell = (row: SharedRow, column: SharedColumn, value: string) => {
    setSavingCell(`${row.id}:${column.key}`);
    updateCell.mutate(
      { rowId: row.id, key: column.key, value },
      { onError: failed("The change could not be saved."), onSettled: () => setSavingCell(null) },
    );
  };

  const cell = (row: SharedRow, column: SharedColumn, number: number) => {
    const value = row.values[column.key] ?? "";
    const label = `${column.label}, row ${number}`;
    if (column.type === "resume") {
      return row.resumeRef ? (
        <a href={sharedResumeUrl(jobId, row.resumeRef)} target="_blank" rel="noopener noreferrer" className={cn(linkClass, "px-2")}>
          View
          <span className="sr-only"> resume (opens in a new tab)</span>
        </a>
      ) : null;
    }
    if (column.type === "select") {
      return (
        <OptionCell
          value={value}
          options={column.options}
          label={label}
          saving={savingCell === `${row.id}:${column.key}`}
          onSave={(next) => saveCell(row, column, next)}
        />
      );
    }
    if (column.custom || row.source === "ADDED") {
      return (
        <EditableCell
          value={value}
          label={label}
          saving={savingCell === `${row.id}:${column.key}`}
          onSave={(next) => saveCell(row, column, next)}
        />
      );
    }
    return <span className="block px-2 py-1 text-[13px] leading-snug break-words text-ink">{value}</span>;
  };

  const frozen = (index: number) => index < frozenColumns;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() =>
            addRow.mutate(undefined, {
              onSuccess: () => toast.success("Row added at the bottom"),
              onError: failed("The row could not be added."),
            })
          }
          loading={addRow.isPending}
          icon={<Rows3 className="size-4" aria-hidden />}
        >
          Add row
        </Button>
        <AddColumnForm pending={addColumn.isPending} onAdd={(label) => addColumn.mutate(label, { onError: failed("The column could not be added.") })} />
        <div className="ml-auto flex items-center gap-3">
          <span role="status" className="text-xs text-muted">
            {busy ? "Saving…" : `All changes saved${data.updatedAt ? ` · last change ${formatDateTime(data.updatedAt)}` : ""}`}
          </span>
          <FreezeMenu
            columnLabels={data.columns.map((column) => column.label)}
            freezeColumns={layout.freezeColumns}
            freezeRows={layout.freezeRows}
            onColumns={layout.setFreezeColumns}
            onRows={layout.setFreezeRows}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[#dadce0] bg-white shadow-card">
        <table className="border-separate border-spacing-0 text-sm" style={{ minWidth: "100%" }}>
          <thead>
            <tr>
              <th
                scope="col"
                aria-hidden
                className={cn(gridLine, "sticky top-0 left-0 z-30 h-6 bg-[#f8f9fa]")}
                style={{ width: ROW_NUMBER_WIDTH, minWidth: ROW_NUMBER_WIDTH }}
              />
              {data.columns.map((column, index) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-hidden
                  className={cn(
                    gridLine,
                    "sticky top-0 h-6 bg-[#f8f9fa] text-center text-[11px] font-medium text-[#5f6368]",
                    frozen(index) ? "z-30" : "z-20",
                    index === frozenColumns - 1 && FROZEN_EDGE,
                  )}
                  style={columnStyle(column, index)}
                >
                  {columnLetter(index)}
                </th>
              ))}
            </tr>
            <tr ref={headerRowRef}>
              <th
                scope="col"
                className={cn(gridLine, "sticky top-6 left-0 z-30 bg-[#f8f9fa] text-center text-[11px] font-medium text-[#5f6368]")}
              >
                <span className="sr-only">Row</span>
              </th>
              {data.columns.map((column, index) => (
                <th
                  key={column.key}
                  ref={(element) => {
                    if (element) headRefs.current.set(column.key, element);
                    else headRefs.current.delete(column.key);
                  }}
                  scope="col"
                  className={cn(
                    gridLine,
                    "sticky top-6 bg-[#fff2cc] px-2 py-2 text-left align-bottom text-[13px] font-bold text-ink",
                    frozen(index) ? "z-30" : "z-20",
                    index === frozenColumns - 1 && FROZEN_EDGE,
                  )}
                  style={columnStyle(column, index)}
                >
                  {column.custom ? (
                    <ColumnHeader
                      column={column}
                      onRename={(label) => renameColumn.mutate({ key: column.key, label }, { onError: failed("The column could not be renamed.") })}
                      onDelete={() => setConfirm({ kind: "column", column })}
                    />
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rowIndex) => {
              const number = rowIndex + 1;
              return (
                <tr
                  key={row.id}
                  ref={(element) => {
                    if (element) rowRefs.current.set(row.id, element);
                    else rowRefs.current.delete(row.id);
                  }}
                  className="group"
                >
                  <th
                    scope="row"
                    style={rowIndex < frozenRows ? { top: topOf(rowIndex) } : undefined}
                    className={cn(
                      gridLine,
                      "sticky left-0 bg-[#f8f9fa] px-1 text-center align-middle text-[11px] font-medium text-[#5f6368]",
                      rowIndex < frozenRows ? "z-[15]" : "z-10",
                      rowIndex === frozenRows - 1 && FROZEN_ROW_EDGE,
                    )}
                  >
                    <span className={cn(row.source === "ADDED" && "group-hover:hidden group-focus-within:hidden")}>{number}</span>
                    {row.source === "ADDED" && (
                      <button
                        type="button"
                        onClick={() => setConfirm({ kind: "row", row, number })}
                        aria-label={`Delete row ${number}`}
                        className="focus-ring mx-auto hidden size-6 items-center justify-center rounded text-muted group-focus-within:flex group-hover:flex hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </th>
                  {data.columns.map((column, index) => {
                    const frozenRow = rowIndex < frozenRows;
                    return (
                      <td
                        key={column.key}
                        className={cn(
                          gridLine,
                          "h-9 px-1 py-1 align-middle group-hover:bg-[#f8fafd]",
                          (frozen(index) || frozenRow) && "sticky bg-white",
                          frozen(index) && frozenRow ? "z-[15]" : (frozen(index) || frozenRow) && "z-10",
                          index === frozenColumns - 1 && FROZEN_EDGE,
                          frozenRow && rowIndex === frozenRows - 1 && FROZEN_ROW_EDGE,
                        )}
                        style={{ ...columnStyle(column, index), ...(frozenRow ? { top: topOf(rowIndex) } : {}) }}
                      >
                        {cell(row, column, number)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={data.columns.length + 1} className="px-4 py-10 text-center text-sm text-muted">
                  No profiles yet. Use Add row to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Shortlisted students come from the placement team and their details cannot be changed here. Rows and columns you
        add can be edited, renamed and deleted. Click a cell to edit it: Enter saves, Esc cancels.
      </p>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "column" ? `Delete the column "${confirm.column.label}"?` : `Delete row ${confirm?.kind === "row" ? confirm.number : ""}?`}
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
      <Message>
        <EmptyState icon={<Link2Off className="size-5" aria-hidden />} message="This link is not valid" />
      </Message>
    );
  }
  if (hasStatus(profiles.error, 410)) {
    return (
      <Message>
        <EmptyState icon={<Hourglass className="size-5" aria-hidden />} message="This link has expired" />
      </Message>
    );
  }
  if (profiles.isError) {
    return (
      <Message>
        <ErrorState error={profiles.error} onRetry={() => void profiles.refetch()} retrying={profiles.isFetching} />
      </Message>
    );
  }
  if (profiles.isPending) {
    return (
      <Message>
        <div className="p-6">
          <LoadingSkeleton lines={8} label="Loading profiles" />
        </div>
      </Message>
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
