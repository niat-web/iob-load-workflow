import { ArrowLeft, ExternalLink, Lock, Rows3, Trash2, TriangleAlert, Video } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { errorMessage } from "../api/client";
import {
  useAddInterviewColumn,
  useAddInterviewRow,
  useCreateMeet,
  useDeleteInterviewColumn,
  useDeleteInterviewRow,
  useInterviewSheet,
  useRenameInterviewColumn,
  useUpdateInterviewCell,
} from "../api/interviews";
import { sharedResumeUrl } from "../api/shared";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorState } from "../components/ErrorState";
import { GoogleConnectCard } from "../components/interviews/GoogleConnectCard";
import { InterviewersCard } from "../components/interviews/InterviewersCard";
import { MeetDialog } from "../components/interviews/MeetDialog";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { SearchInput } from "../components/SearchInput";
import { AddColumnForm, ColumnHeader, EditableCell } from "../components/sheet/SheetCells";
import { SummaryStrip } from "../components/SummaryStrip";
import { useToast } from "../components/toast-context";
import { Button, IconButton, buttonClass } from "../components/ui/Button";
import { cardClass, linkClass } from "../components/ui/styles";
import type { InterviewColumn, InterviewRow, InterviewSheet, MeetRequest } from "../types/api";
import { cn } from "../utils/cn";
import { formatDateTime, formatNumber } from "../utils/format";

const isUrl = (value: string) => /^https:\/\/\S+$/.test(value.trim());

function MeetNotice({ sheet }: { sheet: InterviewSheet }) {
  if (sheet.meetEnabled) return null;
  const text = "Google Meet interviews are turned off by the admin in Settings.";
  return (
    <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      {text}
    </p>
  );
}

function RecordingCell({ value }: { value: string }) {
  if (!value) return <span className="block px-2 py-1.5 text-muted/50">—</span>;
  const on = value.startsWith("On");
  return (
    <span title={value} className={cn("block max-w-[220px] truncate px-2 py-1.5 text-sm font-medium", on ? "text-emerald-700" : "text-red-600")}>
      {value}
    </span>
  );
}

function Sheet({ jobId, sheet, crmEmail }: { jobId: string; sheet: InterviewSheet; crmEmail: string }) {
  const toast = useToast();
  const updateCell = useUpdateInterviewCell(jobId);
  const addRow = useAddInterviewRow(jobId);
  const deleteRow = useDeleteInterviewRow(jobId);
  const addColumn = useAddInterviewColumn(jobId);
  const renameColumn = useRenameInterviewColumn(jobId);
  const deleteColumn = useDeleteInterviewColumn(jobId);
  const createMeet = useCreateMeet(jobId);
  const [search, setSearch] = useState("");
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [meetRow, setMeetRow] = useState<InterviewRow | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "row"; row: InterviewRow } | { kind: "column"; column: InterviewColumn } | null>(null);

  const failed = (fallback: string) => (err: unknown) => toast.error(errorMessage(err, fallback));
  const term = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      term ? sheet.rows.filter((row) => Object.values(row.values).some((value) => value.toLowerCase().includes(term))) : sheet.rows,
    [sheet.rows, term],
  );
  const busy =
    updateCell.isPending || addRow.isPending || deleteRow.isPending || addColumn.isPending || renameColumn.isPending || deleteColumn.isPending;
  const canMeet = sheet.meetEnabled && !sheet.meetProblem;

  const saveCell = (row: InterviewRow, column: InterviewColumn, value: string) => {
    setSavingCell(`${row.id}:${column.key}`);
    updateCell.mutate(
      { rowId: row.id, key: column.key, value },
      { onError: failed("The change could not be saved."), onSettled: () => setSavingCell(null) },
    );
  };

  const submitMeet = (body: MeetRequest) => {
    if (!meetRow) return;
    const updating = Boolean(meetRow.meet);
    createMeet.mutate(
      { rowId: meetRow.id, body },
      {
        onSuccess: (result) => {
          setMeetRow(null);
          if (result.meet.recording.status === "ON") {
            toast.success(updating ? "Meet updated. Guests get the new time." : "Meet created with auto-recording. Invites sent.");
          } else {
            toast.error(`Meet ${updating ? "updated" : "created"} and invites sent, but auto-recording is not on: ${result.meet.recording.error ?? "unknown reason"}`);
          }
        },
      },
    );
  };

  const cell = (row: InterviewRow, column: InterviewColumn, index: number) => {
    const value = row.values[column.key] ?? "";
    if (column.key === "resume") {
      return row.resumeRef ? (
        <a href={sharedResumeUrl(sheet.learningPortalJobId, row.resumeRef)} target="_blank" rel="noopener noreferrer" className={cn(linkClass, "px-2 py-1.5")}>
          View
          <span className="sr-only"> resume (opens in a new tab)</span>
        </a>
      ) : (
        <span className="block px-2 py-1.5 text-muted/50">—</span>
      );
    }
    if (column.key === "recording") return <RecordingCell value={value} />;
    const editable = (
      <EditableCell
        value={value}
        label={`${column.label}, row ${index + 1}`}
        saving={savingCell === `${row.id}:${column.key}`}
        onSave={(next) => saveCell(row, column, next)}
      />
    );
    if (column.key !== "meetLink" || !isUrl(value)) return editable;
    return (
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">{editable}</div>
        <a href={value.trim()} target="_blank" rel="noopener noreferrer" className={cn(linkClass, "mt-1.5 shrink-0")} aria-label={`Join the Meet for row ${index + 1} (opens in a new tab)`}>
          <ExternalLink className="size-4" aria-hidden />
        </a>
      </div>
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} delay={0} placeholder="Search profiles..." label="Search profiles" className="w-full sm:w-72" />
        <Button
          onClick={() => addRow.mutate(undefined, { onSuccess: () => toast.success("Row added at the bottom"), onError: failed("The row could not be added.") })}
          loading={addRow.isPending}
          icon={<Rows3 className="size-4" aria-hidden />}
        >
          Add row
        </Button>
        <AddColumnForm pending={addColumn.isPending} onAdd={(label) => addColumn.mutate(label, { onError: failed("The column could not be added.") })} />
        <span role="status" className="ml-auto text-xs text-muted">
          {busy ? "Saving…" : `All changes saved${sheet.updatedAt ? ` · last change ${formatDateTime(sheet.updatedAt)}` : ""}`}
        </span>
      </div>

      <div data-scroll-region="" className={cn(cardClass, "min-h-[320px] flex-1 overflow-auto")}>
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-header">
            <tr>
              <th scope="col" className="w-12 border-b border-line px-3 py-2.5 text-left text-xs font-bold tracking-wider text-muted uppercase">
                #
              </th>
              <th scope="col" className="border-b border-l border-line px-3 py-2.5 text-left text-xs font-bold tracking-wider text-muted uppercase">
                Meet
              </th>
              {sheet.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "border-b border-l border-line px-3 py-2.5 text-left text-xs font-bold tracking-wider whitespace-nowrap text-muted uppercase",
                    column.internal && "bg-primary-soft/40",
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {column.internal && (
                      <span title="Only on this page. The company does not see this column.">
                        <Lock className="size-3" aria-label="Internal column" />
                      </span>
                    )}
                    <ColumnHeader
                      column={column}
                      onRename={(label) => renameColumn.mutate({ key: column.key, label }, { onError: failed("The column could not be renamed.") })}
                      onDelete={() => setConfirm({ kind: "column", column })}
                    />
                  </span>
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
                <td className="border-b border-l border-line px-2 py-1.5">
                  <Button
                    size="sm"
                    variant={row.meet ? "secondary" : "primary"}
                    disabled={!canMeet}
                    title={canMeet ? undefined : (sheet.meetProblem ?? "Turned off by the admin")}
                    onClick={() => {
                      createMeet.reset();
                      setMeetRow(row);
                    }}
                    icon={<Video className="size-4" aria-hidden />}
                    aria-label={`${row.meet ? "Update the Meet" : "Create a Meet"} for row ${index + 1}`}
                  >
                    {row.meet ? "Update" : "Meet"}
                  </Button>
                </td>
                {sheet.columns.map((column) => (
                  <td key={column.key} className={cn("border-b border-l border-line px-1 py-1", column.internal && "bg-primary-soft/15")}>
                    {cell(row, column, index)}
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
                <td colSpan={sheet.columns.length + 3} className="px-4 py-10 text-center text-sm text-muted">
                  {term ? "No profiles match your search." : "No profiles yet. Use Add row to add one."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Columns with a lock are only on this page. Rows and the other columns are the same as on the company&apos;s shared
        profiles page. Click a cell to edit it: Enter saves, Shift+Enter adds a line, Esc cancels.
      </p>

      {meetRow && (
        <MeetDialog
          sheet={sheet}
          row={meetRow}
          crmEmail={crmEmail}
          pending={createMeet.isPending}
          error={createMeet.error ? errorMessage(createMeet.error, "The Meet could not be created.") : null}
          onSubmit={submitMeet}
          onClose={() => setMeetRow(null)}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "column" ? `Delete the column "${confirm.column.label}"?` : "Delete this row?"}
        message={
          confirm?.kind === "column"
            ? confirm.column.internal
              ? "Everything in this column is deleted."
              : "Everything in this column is deleted, also on the company's shared profiles page."
            : "This row is deleted here and on the company's shared profiles page."
        }
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

export function InterviewSheetPage() {
  const { jobId = "" } = useParams();
  const { state } = useAuth();
  const sheet = useInterviewSheet(jobId);

  const back = (
    <Link to="/crm/interviews" className={cn(buttonClass("ghost", "sm"), "self-start")}>
      <ArrowLeft className="size-4" aria-hidden />
      All companies
    </Link>
  );

  if (sheet.isError) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <div className={cardClass}>
          <ErrorState error={sheet.error} onRetry={() => void sheet.refetch()} retrying={sheet.isFetching} />
        </div>
      </div>
    );
  }
  if (sheet.isPending) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <div className={cn(cardClass, "p-6")}>
          <LoadingSkeleton lines={8} label="Loading profiles" />
        </div>
      </div>
    );
  }

  const data = sheet.data;
  const meets = data.rows.filter((row) => row.meet).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <h1 className="sr-only">Interviews for {data.companyName}</h1>
      <div className="flex flex-wrap items-center gap-3">
        {back}
        <a href={data.url} target="_blank" rel="noopener noreferrer" className={cn(linkClass, "text-sm")}>
          Open the shared profiles page
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      <SummaryStrip
        items={[
          { label: "Company Name", value: data.companyName },
          { label: "Job Role", value: data.jobRole || "—" },
          { label: "Total Applied", value: formatNumber(data.totalApplied) },
          { label: "Profiles", value: formatNumber(data.rows.length) },
          { label: "Meets", value: formatNumber(meets) },
        ]}
      />
      <MeetNotice sheet={data} />
      {data.meetEnabled && <GoogleConnectCard returnTo={`/crm/interviews/${jobId}`} />}
      <InterviewersCard jobId={jobId} companyName={data.companyName} emails={data.interviewerEmails} />
      <Sheet jobId={jobId} sheet={data} crmEmail={state.user?.email ?? ""} />
    </div>
  );
}
