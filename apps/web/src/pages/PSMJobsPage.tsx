import { FilterX, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "react-router";
import { usePsmJobFilters, usePsmJobs } from "../api/psm";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { FilterMenu } from "../components/FilterMenu";
import { Pagination } from "../components/Pagination";
import { buildPsmJobColumns } from "../components/psm/psmJobColumns";
import { SearchInput } from "../components/SearchInput";
import { Button } from "../components/ui/Button";
import { useClampPage, useUrlFilters } from "../hooks/useUrlFilters";
import { DEFAULT_PAGE_SIZE } from "../utils/pagination";
import type { PsmJobsQuery } from "../types/api";

const FILTER_KEYS = ["q", "company", "psmStatus", "priorityStatus", "aiStatus"] as const;

const splitValues = (value: string) => (value ? value.split("|").filter(Boolean) : []);

export function PSMJobsPage() {
  const { filters, page, hasFilters, setFilter, setPage, clearFilters } = useUrlFilters(FILTER_KEYS);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
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
      limit: pageSize,
    }),
    [filters, page, pageSize],
  );

  const jobs = usePsmJobs(query);
  const options = usePsmJobFilters();
  const pagination = jobs.data?.pagination;
  useClampPage(page, pagination?.totalPages, setPage);

  const offset = ((pagination?.page ?? page) - 1) * (pagination?.limit ?? pageSize);
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
        <FilterMenu
          categories={[
            { key: "company", label: "Company", options: options.data?.companies ?? [] },
            { key: "psmStatus", label: "PSM Status", options: options.data?.psmStatuses ?? [] },
            { key: "priorityStatus", label: "Priority", options: options.data?.priorityStatuses ?? [] },
            { key: "aiStatus", label: "AI Status", options: options.data?.aiStatuses ?? [] },
          ]}
          values={{
            company: splitValues(filters.company),
            psmStatus: splitValues(filters.psmStatus),
            priorityStatus: splitValues(filters.priorityStatus),
            aiStatus: splitValues(filters.aiStatus),
          }}
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
            <Pagination
              pagination={pagination}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              disabled={jobs.isPlaceholderData}
            />
          ) : null
        }
      />
    </div>
  );
}
