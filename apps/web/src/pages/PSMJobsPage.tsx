import { FilterX, SearchX } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "react-router";
import { usePsmJobFilters, usePsmJobs } from "../api/psm";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { FilterSelect } from "../components/FilterSelect";
import { Pagination } from "../components/Pagination";
import { buildPsmJobColumns } from "../components/psm/psmJobColumns";
import { SearchInput } from "../components/SearchInput";
import { Button } from "../components/ui/Button";
import { useClampPage, useUrlFilters } from "../hooks/useUrlFilters";
import type { PsmJobsQuery } from "../types/api";

const FILTER_KEYS = ["q", "company", "psmStatus", "priorityStatus", "aiStatus"] as const;
const PAGE_SIZE = 20;

export function PSMJobsPage() {
  const { filters, page, hasFilters, setFilter, setPage, clearFilters } = useUrlFilters(FILTER_KEYS);
  const location = useLocation();
  const backTo = `/psm${location.search}`;

  const query = useMemo<PsmJobsQuery>(
    () => ({
      search: filters.q.trim() || undefined,
      company: filters.company || undefined,
      psmStatus: filters.psmStatus || undefined,
      priorityStatus: filters.priorityStatus || undefined,
      aiStatus: filters.aiStatus || undefined,
      page,
      limit: PAGE_SIZE,
    }),
    [filters, page],
  );

  const jobs = usePsmJobs(query);
  const options = usePsmJobFilters();
  const pagination = jobs.data?.pagination;
  useClampPage(page, pagination?.totalPages, setPage);

  const offset = ((pagination?.page ?? page) - 1) * (pagination?.limit ?? PAGE_SIZE);
  const columns = useMemo(() => buildPsmJobColumns(offset, backTo), [offset, backTo]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <h1 className="sr-only">PSM candidate pools</h1>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={filters.q}
          onChange={(v) => setFilter("q", v)}
          placeholder="Search by company, role or Deal ID..."
          label="Search candidate pools"
          className="w-full sm:w-80"
        />
        <FilterSelect
          value={filters.company}
          onChange={(v) => setFilter("company", v)}
          options={options.data?.companies ?? []}
          placeholder="All Companies"
          label="Filter by company"
          className="w-[calc(50%-4px)] sm:w-44"
        />
        <FilterSelect
          value={filters.psmStatus}
          onChange={(v) => setFilter("psmStatus", v)}
          options={options.data?.psmStatuses ?? []}
          placeholder="All PSM Status"
          label="Filter by PSM review status"
          className="w-[calc(50%-4px)] sm:w-44"
        />
        <FilterSelect
          value={filters.priorityStatus}
          onChange={(v) => setFilter("priorityStatus", v)}
          options={options.data?.priorityStatuses ?? []}
          placeholder="All Priority"
          label="Filter by priority status"
          className="w-[calc(50%-4px)] sm:w-44"
        />
        <FilterSelect
          value={filters.aiStatus}
          onChange={(v) => setFilter("aiStatus", v)}
          options={options.data?.aiStatuses ?? []}
          placeholder="All AI Status"
          label="Filter by AI analysis status"
          className="w-[calc(50%-4px)] sm:w-40"
        />
        <Button
          variant="ghost"
          onClick={clearFilters}
          disabled={!hasFilters}
          icon={<FilterX className="size-4" aria-hidden />}
        >
          Clear Filters
        </Button>
      </div>

      <DataTable
        caption="Candidate pools by company"
        data={jobs.data?.items}
        columns={columns}
        getRowId={(row) => row.id}
        isLoading={jobs.isPending}
        isFetching={jobs.isFetching}
        error={jobs.error}
        onRetry={() => void jobs.refetch()}
        emptyState={
          hasFilters ? (
            <EmptyState
              icon={<SearchX className="size-5" aria-hidden />}
              message="No candidate pools match your search or filters."
              action={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear Filters
                </Button>
              }
            />
          ) : (
            <EmptyState message="No candidate pools are ready for review." />
          )
        }
        footer={
          pagination && pagination.total > 0 ? (
            <Pagination pagination={pagination} onPageChange={setPage} disabled={jobs.isPlaceholderData} />
          ) : null
        }
      />
    </div>
  );
}
