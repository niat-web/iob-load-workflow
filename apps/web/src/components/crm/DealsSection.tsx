import { FilterX, RefreshCw, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useCrmDealFilters, useCrmDeals } from "../../api/crm";
import { buildCrmColumns, dealPagePath } from "./crmColumns";
import { DataTable } from "../DataTable";
import { EmptyState } from "../EmptyState";
import { FilterMenu } from "../FilterMenu";
import { Pagination } from "../Pagination";
import { SearchInput } from "../SearchInput";
import { Button, IconButton } from "../ui/Button";
import { useClampPage, useUrlFilters } from "../../hooks/useUrlFilters";
import type { CrmDealsQuery } from "../../types/api";
import { cn } from "../../utils/cn";
import { DEFAULT_PAGE_SIZE, splitFilterValues } from "../../utils/pagination";

export const CRM_FILTER_KEYS = ["q", "status", "company"] as const;

interface DealsSectionProps {
  emptyDescription: string;
  fixedPageSize?: number;
}

export function DealsSection({ emptyDescription, fixedPageSize }: DealsSectionProps) {
  const { filters, page, hasFilters, setFilter, setPage, clearFilters } = useUrlFilters(CRM_FILTER_KEYS);
  const [chosenPageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const pageSize = fixedPageSize ?? chosenPageSize;
  const navigate = useNavigate();
  const location = useLocation();

  const query = useMemo<CrmDealsQuery>(
    () => ({
      search: filters.q.trim() || undefined,
      status: filters.status || undefined,
      company: filters.company || undefined,
      page,
      limit: pageSize,
    }),
    [filters, page, pageSize],
  );

  const deals = useCrmDeals(query);
  const filterOptions = useCrmDealFilters();
  const pagination = deals.data?.pagination;
  useClampPage(page, pagination?.totalPages, setPage);

  const offset = ((pagination?.page ?? page) - 1) * (pagination?.limit ?? pageSize);
  const from = `${location.pathname}${location.search}`;
  const columns = useMemo(() => buildCrmColumns({ offset, from }), [offset, from]);

  const refresh = () => {
    void deals.refetch();
    void filterOptions.refetch();
  };

  return (
    <section aria-label="Submitted deals" className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput
          value={filters.q}
          onChange={(v) => setFilter("q", v)}
          placeholder="Search company, Deal ID or role..."
          label="Search deals"
          className="w-full sm:w-80"
        />
        <FilterMenu
          categories={[
            { key: "status", label: "Status", options: filterOptions.data?.statuses ?? [] },
            { key: "company", label: "Company", options: filterOptions.data?.companies ?? [] },
          ]}
          values={{ status: splitFilterValues(filters.status), company: splitFilterValues(filters.company) }}
          onChange={(key, values) => setFilter(key as (typeof CRM_FILTER_KEYS)[number], values.join("|"))}
          onClear={clearFilters}
        />
        <Button variant="ghost" onClick={clearFilters} disabled={!hasFilters} icon={<FilterX className="size-4" aria-hidden />}>
          Clear Filters
        </Button>
        <IconButton label="Refresh" large onClick={refresh} className="sm:ml-auto">
          <RefreshCw className={cn("size-4", deals.isFetching && "animate-spin")} aria-hidden />
        </IconButton>
      </div>

      <DataTable
        caption="Submitted HubSpot deals"
        data={deals.data?.items}
        columns={columns}
        getRowId={(row) => row.id}
        onRowClick={(job) => void navigate(dealPagePath(job), { state: { from } })}
        isLoading={deals.isPending}
        isFetching={deals.isFetching}
        error={deals.error}
        onRetry={() => void deals.refetch()}
        emptyState={
          hasFilters ? (
            <EmptyState
              icon={<SearchX strokeWidth={1.6} aria-hidden />}
              message="No deals match your search or filters."
              description="Try a different search, or clear the filters."
              action={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear Filters
                </Button>
              }
            />
          ) : (
            <EmptyState message="No Deal IDs have been submitted yet." description={emptyDescription} />
          )
        }
        footer={
          pagination && pagination.total > 0 ? (
            <Pagination
              pagination={pagination}
              onPageChange={setPage}
              onPageSizeChange={
                fixedPageSize
                  ? undefined
                  : (size) => {
                      setPageSize(size);
                      setPage(1);
                    }
              }
              disabled={deals.isPlaceholderData}
            />
          ) : null
        }
      />
    </section>
  );
}
