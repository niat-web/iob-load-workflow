import type { ColumnDef } from "@tanstack/react-table";
import { Building2, RefreshCw, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useCrmCompanies } from "../api/crm";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { SearchInput } from "../components/SearchInput";
import { TruncatedText } from "../components/TruncatedText";
import { Button, IconButton, buttonClass } from "../components/ui/Button";
import type { CompanySummary } from "../types/api";
import { cn } from "../utils/cn";
import { formatDateTime, formatNumber } from "../utils/format";

const numeric = { headerClassName: "text-right", cellClassName: "text-right tabular-nums" };

function Count({ value, tone }: { value: number; tone?: string }) {
  return <span className={cn(value === 0 ? "text-muted/60" : tone ?? "text-ink")}>{formatNumber(value)}</span>;
}

const columns: ColumnDef<CompanySummary>[] = [
  {
    id: "index",
    header: "#",
    cell: ({ row }) => <span className="text-muted tabular-nums">{row.index + 1}</span>,
    meta: { headerClassName: "w-12", cellClassName: "w-12" },
  },
  {
    id: "name",
    header: "Company",
    cell: ({ row }) => <TruncatedText value={row.original.name} className="max-w-[280px] font-semibold" />,
  },
  { id: "deals", header: "Deals", cell: ({ row }) => <Count value={row.original.deals} />, meta: numeric },
  {
    id: "inProgress",
    header: "In Progress",
    cell: ({ row }) => <Count value={row.original.inProgress} tone="text-blue-700" />,
    meta: numeric,
  },
  {
    id: "waiting",
    header: "Waiting",
    cell: ({ row }) => <Count value={row.original.waiting} tone="text-amber-700" />,
    meta: numeric,
  },
  {
    id: "completed",
    header: "Completed",
    cell: ({ row }) => <Count value={row.original.completed} tone="text-green-700" />,
    meta: numeric,
  },
  {
    id: "failed",
    header: "Failed",
    cell: ({ row }) => <Count value={row.original.failed} tone="text-red-600" />,
    meta: numeric,
  },
  { id: "stopped", header: "Stopped", cell: ({ row }) => <Count value={row.original.stopped} />, meta: numeric },
  {
    id: "lastUpdated",
    header: "Last Updated",
    cell: ({ row }) => <span className="text-muted tabular-nums">{formatDateTime(row.original.lastUpdated)}</span>,
  },
  {
    id: "action",
    header: "Action",
    cell: ({ row }) => (
      <Link
        to={`/crm/deals?company=${encodeURIComponent(row.original.name)}`}
        className={buttonClass("secondary", "sm")}
      >
        View deals
      </Link>
    ),
    meta: { headerClassName: "text-right", cellClassName: "text-right" },
  },
];

export function CRMCompaniesPage() {
  const companies = useCrmCompanies();
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const rows = useMemo(
    () => companies.data?.items.filter((company) => company.name.toLowerCase().includes(term)),
    [companies.data, term],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <h1 className="sr-only">Companies</h1>
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput
          value={search}
          onChange={setSearch}
          delay={0}
          placeholder="Search company..."
          label="Search companies"
          className="w-full min-w-[260px] flex-1"
        />
        <IconButton label="Refresh" large onClick={() => void companies.refetch()}>
          <RefreshCw className={cn("size-4", companies.isFetching && "animate-spin")} aria-hidden />
        </IconButton>
      </div>

      <DataTable
        caption="Companies with HubSpot deals"
        data={rows}
        columns={columns}
        getRowId={(row) => row.name}
        isLoading={companies.isPending}
        isFetching={companies.isFetching}
        error={companies.error}
        onRetry={() => void companies.refetch()}
        emptyState={
          term ? (
            <EmptyState
              icon={<SearchX strokeWidth={1.6} aria-hidden />}
              message="No companies match your search."
              description="Try a different name."
              action={
                <Button variant="secondary" size="sm" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Building2 strokeWidth={1.6} aria-hidden />}
              message="No companies yet."
              description="A company appears here once its first deal is fetched from HubSpot."
            />
          )
        }
      />
    </div>
  );
}
