import type { ColumnDef } from "@tanstack/react-table";
import { FilterX, History, RefreshCw, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuditLogFilters, useAuditLogs } from "../../api/admin";
import type { AuditLogEntry } from "../../types/api";
import { cn } from "../../utils/cn";
import { formatDateTime } from "../../utils/format";
import { DEFAULT_PAGE_SIZE } from "../../utils/pagination";
import { DataTable } from "../DataTable";
import { Drawer } from "../Drawer";
import { EmptyState } from "../EmptyState";
import { FilterMenu } from "../FilterMenu";
import { Pagination } from "../Pagination";
import { SearchInput } from "../SearchInput";
import { StatusBadge } from "../StatusBadge";
import { Button, IconButton } from "../ui/Button";
import { toolbarFieldClass } from "../ui/styles";

const ROLE_TONES: Record<string, "purple" | "blue" | "green" | "orange" | "gray"> = {
  ADMIN: "purple",
  CRM: "blue",
  PSM: "green",
  POOL_MANAGER: "orange",
  SYSTEM: "gray",
};

function dealText(entry: AuditLogEntry) {
  if (!entry.deal) return null;
  const name = [entry.deal.companyName, entry.deal.jobRole].filter(Boolean).join(" – ");
  return { name: name || "Deal", id: entry.deal.hubspotDealId };
}

function buildColumns(onOpen: (entry: AuditLogEntry) => void): ColumnDef<AuditLogEntry>[] {
  return [
    {
      id: "at",
      header: "When",
      cell: ({ row }) => <span className="whitespace-nowrap text-muted tabular-nums">{formatDateTime(row.original.at)}</span>,
      meta: { headerClassName: "w-44", cellClassName: "w-44" },
    },
    {
      id: "actor",
      header: "Who",
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-semibold text-ink">{row.original.actor.name}</span>
          <StatusBadge label={row.original.actor.roleLabel} tone={ROLE_TONES[row.original.actor.role] ?? "gray"} className="self-start" />
        </span>
      ),
      meta: { headerClassName: "w-48", cellClassName: "w-48" },
    },
    {
      id: "what",
      header: "What happened",
      cell: ({ row }) => (
        <button type="button" onClick={() => onOpen(row.original)} className="focus-ring block max-w-[640px] rounded text-left">
          <span className="block text-xs font-semibold tracking-wide text-muted uppercase">{row.original.label}</span>
          <span className="block text-sm text-ink hover:text-primary">{row.original.text}</span>
        </button>
      ),
    },
    {
      id: "deal",
      header: "Deal",
      cell: ({ row }) => {
        const deal = dealText(row.original);
        if (!deal) return <span className="text-muted/60">—</span>;
        return (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-ink">{deal.name}</span>
            {deal.id && <span className="text-xs text-muted tabular-nums">Deal {deal.id}</span>}
          </span>
        );
      },
      meta: { headerClassName: "w-56", cellClassName: "w-56 max-w-56" },
    },
  ];
}

function DetailsDrawer({ entry, onClose }: { entry: AuditLogEntry | null; onClose: () => void }) {
  const rows: [string, string][] = entry
    ? [
        ["When", `${formatDateTime(entry.at)} IST`],
        ["Who", entry.actor.email ? `${entry.actor.name} (${entry.actor.email}) · ${entry.actor.roleLabel}` : "System"],
        ["Action", `${entry.label} (${entry.action})`],
        ["Record", `${entry.entityType} ${entry.entityId}`],
        ...(entry.deal
          ? ([
              ["Deal", `${dealText(entry)?.name ?? ""}${entry.deal.hubspotDealId ? ` · HubSpot ${entry.deal.hubspotDealId}` : ""}`],
              ["Learning Portal job ID", entry.deal.learningPortalJobId ?? "—"],
            ] as [string, string][])
          : []),
        ...(entry.ip ? ([["IP address", entry.ip]] as [string, string][]) : []),
      ]
    : [];
  return (
    <Drawer open={entry !== null} onClose={onClose} title="Audit log entry">
      {entry && (
        <div className="space-y-5 p-5">
          <p className="text-base font-semibold text-ink">{entry.text}</p>
          <dl className="divide-y divide-line rounded-lg border">
            {rows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 px-4 py-2.5 text-sm">
                <dt className="text-muted">{label}</dt>
                <dd className="break-words text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {Object.keys(entry.metadata).length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-bold tracking-wider text-muted uppercase">Recorded details</p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-ink">
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function AuditLogSection() {
  const [search, setSearch] = useState("");
  const [actors, setActors] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [open, setOpen] = useState<AuditLogEntry | null>(null);
  const filters = useAuditLogFilters();
  const query = useMemo(
    () => ({
      search: search.trim() || undefined,
      actor: actors.join("|") || undefined,
      action: actions.join("|") || undefined,
      from: from || undefined,
      to: to || undefined,
      page,
      limit: pageSize,
    }),
    [search, actors, actions, from, to, page, pageSize],
  );
  const logs = useAuditLogs(query);
  const columns = useMemo(() => buildColumns(setOpen), []);
  const hasFilters = Boolean(search.trim() || actors.length || actions.length || from || to);
  const clear = () => {
    setSearch("");
    setActors([]);
    setActions([]);
    setFrom("");
    setTo("");
    setPage(1);
  };
  const resetPage = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
  };

  return (
    <section aria-labelledby="audit-title" className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-w-0">
        <h2 id="audit-title" className="text-lg font-bold text-ink">
          Audit Log
        </h2>
        <p className="mt-1 text-sm text-muted">
          Everything that happened, newest first: sign-ins, deal steps, job access, emails, calls, approvals, settings,
          users and Eligible Pool changes. Kept forever and only visible to admins. Click a line for its details.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput
          value={search}
          onChange={resetPage(setSearch)}
          placeholder="Search deal ID, company, student, email..."
          label="Search the audit log"
          className="w-full sm:w-80"
        />
        <FilterMenu
          categories={[
            { key: "actor", label: "Who", options: filters.data?.actors ?? [] },
            { key: "action", label: "Action", options: filters.data?.actions ?? [] },
          ]}
          values={{ actor: actors, action: actions }}
          onChange={(key, values) => {
            if (key === "actor") setActors(values);
            else setActions(values);
            setPage(1);
          }}
          onClear={clear}
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => resetPage(setFrom)(event.target.value)}
            className={cn(toolbarFieldClass, "w-40")}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => resetPage(setTo)(event.target.value)}
            className={cn(toolbarFieldClass, "w-40")}
          />
        </label>
        <Button variant="ghost" onClick={clear} disabled={!hasFilters} icon={<FilterX className="size-4" aria-hidden />}>
          Clear Filters
        </Button>
        <IconButton label="Refresh" large className="sm:ml-auto" onClick={() => void logs.refetch()}>
          <RefreshCw className={cn("size-4", logs.isFetching && "animate-spin")} aria-hidden />
        </IconButton>
      </div>

      <DataTable
        caption="Audit log"
        data={logs.data?.items}
        columns={columns}
        getRowId={(row) => row.id}
        isLoading={logs.isPending}
        isFetching={logs.isFetching}
        error={logs.error}
        onRetry={() => void logs.refetch()}
        emptyState={
          hasFilters ? (
            <EmptyState
              icon={<SearchX strokeWidth={1.6} aria-hidden />}
              message="Nothing matches these filters."
              action={
                <Button variant="secondary" size="sm" onClick={clear}>
                  Clear Filters
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<History strokeWidth={1.6} aria-hidden />} message="Nothing has been recorded yet." />
          )
        }
        footer={
          logs.data && logs.data.pagination.total > 0 ? (
            <Pagination
              pagination={logs.data.pagination}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          ) : null
        }
      />
      <DetailsDrawer entry={open} onClose={() => setOpen(null)} />
    </section>
  );
}
