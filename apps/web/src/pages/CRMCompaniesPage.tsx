import type { ColumnDef } from "@tanstack/react-table";
import { Building2, FilterX, RefreshCw, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { errorMessage } from "../api/client";
import { useCrmCompanies, useCrmControls, useUpdateCompanyControls } from "../api/crm";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { FilterMenu } from "../components/FilterMenu";
import { Pagination } from "../components/Pagination";
import { SearchInput } from "../components/SearchInput";
import { TruncatedText } from "../components/TruncatedText";
import { useToast } from "../components/toast-context";
import { Button, IconButton, buttonClass } from "../components/ui/Button";
import { Switch } from "../components/ui/Switch";
import { useUrlFilters } from "../hooks/useUrlFilters";
import type { CheckpointSwitches, CompanySummary } from "../types/api";
import { cn } from "../utils/cn";
import { DEFAULT_PAGE_SIZE, splitFilterValues } from "../utils/pagination";
import { formatDateTime, formatNumber } from "../utils/format";

const FILTER_KEYS = ["q", "company", "state"] as const;

const DEAL_STATES = [
  { value: "inProgress", label: "In Progress" },
  { value: "waiting", label: "Waiting" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "stopped", label: "Stopped" },
] as const;

type DealState = (typeof DEAL_STATES)[number]["value"];

const numeric = { headerClassName: "text-right", cellClassName: "text-right tabular-nums" };

function Count({ value, tone }: { value: number; tone?: string }) {
  return <span className={cn(value === 0 ? "text-muted/60" : tone ?? "text-ink")}>{formatNumber(value)}</span>;
}

const CHECKPOINT_COLUMNS: { key: keyof CheckpointSwitches; header: string; label: string }[] = [
  { key: "firstEmails", header: "1st Reminder", label: "first-checkpoint reminder emails" },
  { key: "secondEmails", header: "2nd Reminder", label: "second-checkpoint reminder emails" },
  { key: "secondCalls", header: "2nd AI Calls", label: "second-checkpoint AI calls" },
];

interface ColumnOptions {
  admin: CheckpointSwitches | undefined;
  saving: string | null;
  onToggle: (company: CompanySummary, key: keyof CheckpointSwitches, next: boolean) => void;
}

function buildColumns({ admin, saving, onToggle }: ColumnOptions): ColumnDef<CompanySummary>[] {
  return [
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
  ...CHECKPOINT_COLUMNS.map(
    ({ key, header, label }): ColumnDef<CompanySummary> => ({
      id: key,
      header,
      cell: ({ row }) => {
        const company = row.original;
        const adminOff = admin ? !admin[key] : false;
        return (
          <Switch
            checked={!adminOff && company.checkpoints[key]}
            disabled={adminOff || saving === `${company.companyKey}:${key}`}
            label={`${company.name}: ${label}`}
            title={adminOff ? "Turned off by the admin for every company" : undefined}
            onChange={(next) => onToggle(company, key, next)}
          />
        );
      },
      meta: { headerClassName: "text-center", cellClassName: "text-center" },
    }),
  ),
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
}

export function CRMCompaniesPage() {
  const companies = useCrmCompanies();
  const controls = useCrmControls();
  const updateControls = useUpdateCompanyControls();
  const toast = useToast();
  const [saving, setSaving] = useState<string | null>(null);
  const columns = useMemo(
    () =>
      buildColumns({
        admin: controls.data?.checkpoints,
        saving,
        onToggle: (company, key, next) => {
          setSaving(`${company.companyKey}:${key}`);
          updateControls.mutate(
            { companyName: company.name, checkpoints: { [key]: next } },
            {
              onSuccess: () => toast.success(`${company.name}: ${next ? "turned on" : "turned off"}`),
              onError: (err) => toast.error(errorMessage(err, "The change could not be saved.")),
              onSettled: () => setSaving(null),
            },
          );
        },
      }),
    [controls.data?.checkpoints, saving, updateControls, toast],
  );
  const { filters, page, hasFilters, setFilter, setPage, clearFilters } = useUrlFilters(FILTER_KEYS);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const term = filters.q.trim().toLowerCase();
  const chosenCompanies = useMemo(() => splitFilterValues(filters.company), [filters.company]);
  const chosenStates = useMemo(() => splitFilterValues(filters.state) as DealState[], [filters.state]);
  const companyOptions = useMemo(() => (companies.data?.items ?? []).map((company) => company.name), [companies.data]);
  const matches = useMemo(
    () =>
      companies.data?.items.filter(
        (company) =>
          company.name.toLowerCase().includes(term) &&
          (!chosenCompanies.length || chosenCompanies.includes(company.name)) &&
          (!chosenStates.length || chosenStates.some((state) => company[state] > 0)),
      ),
    [companies.data, term, chosenCompanies, chosenStates],
  );
  const total = matches?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = useMemo(
    () => matches?.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [matches, currentPage, pageSize],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <h1 className="sr-only">Companies</h1>
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput
          value={filters.q}
          onChange={(value) => setFilter("q", value)}
          delay={0}
          placeholder="Search company..."
          label="Search companies"
          className="w-full sm:w-80"
        />
        <FilterMenu
          categories={[
            { key: "company", label: "Company", options: companyOptions },
            { key: "state", label: "Deal Status", options: DEAL_STATES },
          ]}
          values={{ company: chosenCompanies, state: chosenStates }}
          onChange={(key, values) => setFilter(key as (typeof FILTER_KEYS)[number], values.join("|"))}
          onClear={clearFilters}
        />
        <Button
          variant="ghost"
          onClick={clearFilters}
          disabled={!hasFilters}
          icon={<FilterX className="size-4" aria-hidden />}
        >
          Clear Filters
        </Button>
        <IconButton label="Refresh" large className="sm:ml-auto" onClick={() => void companies.refetch()}>
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
          hasFilters ? (
            <EmptyState
              icon={<SearchX strokeWidth={1.6} aria-hidden />}
              message="No companies match your search or filters."
              description="Try a different name, or clear the filters."
              action={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear Filters
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
        footer={
          total > 0 ? (
            <Pagination
              pagination={{ page: currentPage, limit: pageSize, total, totalPages }}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          ) : null
        }
      />
    </div>
  );
}
