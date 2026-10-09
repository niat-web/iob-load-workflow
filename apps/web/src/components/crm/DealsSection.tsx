import { FilterX, RefreshCw, SearchX } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { errorMessage } from "../../api/client";
import { useCrmDealFilters, useCrmDeals, useDeleteDeal, useRetryDeal, useStopDeal } from "../../api/crm";
import { buildCrmColumns } from "./crmColumns";
import { ConfirmDialog } from "../ConfirmDialog";
import { ApprovalDrawer } from "./ApprovalDrawer";
import { DataTable } from "../DataTable";
import { EmptyState } from "../EmptyState";
import { FilterMenu } from "../FilterMenu";
import { Pagination } from "../Pagination";
import { SearchInput } from "../SearchInput";
import { useToast } from "../toast-context";
import { Button, IconButton } from "../ui/Button";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useClampPage, useUrlFilters } from "../../hooks/useUrlFilters";
import type { CrmDealRow, CrmDealsQuery } from "../../types/api";
import { cn } from "../../utils/cn";
import { DEFAULT_PAGE_SIZE, splitFilterValues } from "../../utils/pagination";

export const CRM_FILTER_KEYS = ["q", "status", "company"] as const;

type Panel = { kind: "approval"; job: CrmDealRow } | null;
type Confirm = { kind: "stop" | "delete"; job: CrmDealRow } | null;

function dealName(job: CrmDealRow) {
  return job.companyName ? `${job.hubspotDealId} (${job.companyName})` : job.hubspotDealId;
}

interface DealsSectionProps {
  emptyDescription: string;
  fixedPageSize?: number;
}

export function DealsSection({ emptyDescription, fixedPageSize }: DealsSectionProps) {
  const { filters, page, hasFilters, setFilter, setPage, clearFilters } = useUrlFilters(CRM_FILTER_KEYS);
  const [chosenPageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const pageSize = fixedPageSize ?? chosenPageSize;
  const [panel, setPanel] = useState<Panel>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const copy = useCopyToClipboard();
  const retry = useRetryDeal();
  const stop = useStopDeal();
  const remove = useDeleteDeal();
  const [confirm, setConfirm] = useState<Confirm>(null);

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

  const { mutate: retryMutate } = retry;
  const handleRetry = useCallback(
    (row: CrmDealRow) => {
      retryMutate(row.id, {
        onSuccess: () => toast.success(`Retry started for deal ${row.hubspotDealId}`),
        onError: (err) => toast.error(errorMessage(err, "This step could not be retried.")),
      });
    },
    [retryMutate, toast],
  );

  const offset = ((pagination?.page ?? page) - 1) * (pagination?.limit ?? pageSize);
  const from = `${location.pathname}${location.search}`;
  const openDeal = useCallback(
    (job: CrmDealRow, tab = "") => {
      void navigate(`/crm/deals/${encodeURIComponent(job.id)}${tab ? `/${tab}` : ""}`, { state: { from } });
    },
    [navigate, from],
  );
  const columns = useMemo(
    () =>
      buildCrmColumns({
        offset,
        onViewDetails: (job) => openDeal(job),
        onViewLogs: (job) => openDeal(job, "logs"),
        onReviewApproval: (job) => setPanel({ kind: "approval", job }),
        onStop: (job) => setConfirm({ kind: "stop", job }),
        onDelete: (job) => setConfirm({ kind: "delete", job }),
        onRetry: handleRetry,
        onCopyLink: (job) => {
          if (job.publicLinkUrl) void copy(job.publicLinkUrl, "Public link copied");
        },
      }),
    [offset, handleRetry, copy, openDeal],
  );

  const refresh = () => {
    void deals.refetch();
    void filterOptions.refetch();
  };

  const closePanel = useCallback(() => setPanel(null), []);

  const closeConfirm = () => {
    stop.reset();
    remove.reset();
    setConfirm(null);
  };

  const runConfirm = () => {
    if (!confirm) return;
    const { kind, job } = confirm;
    if (kind === "stop") {
      stop.mutate(job.id, {
        onSuccess: () => {
          toast.success(`Deal ${job.hubspotDealId} stopped`);
          setConfirm(null);
        },
      });
      return;
    }
    remove.mutate(job.id, {
      onSuccess: () => {
        toast.success(`Deal ${job.hubspotDealId} deleted`);
        setConfirm(null);
        setPanel((current) => (current?.job.id === job.id ? null : current));
      },
    });
  };

  const confirmError = stop.error ?? remove.error;

  return (
    <>
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
          <Button
            variant="ghost"
            onClick={clearFilters}
            disabled={!hasFilters}
            icon={<FilterX className="size-4" aria-hidden />}
          >
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
          onRowClick={(job) => openDeal(job)}
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

      <ApprovalDrawer job={panel?.job ?? null} onClose={closePanel} />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "delete" ? "Delete this deal?" : "Stop this deal?"}
        message={
          confirm?.kind === "delete" ? (
            <>
              <p>
                Deal <span className="font-semibold text-ink">{dealName(confirm.job)}</span> and all its data in this
                app (students, applications, rankings and logs) will be removed for good. You can submit this Deal ID
                again afterwards.
              </p>
              <p className="mt-2">
                Anything already done outside this app, like the job in the Learning Portal or emails already sent,
                stays as it is.
              </p>
            </>
          ) : confirm ? (
            <>
              <p>
                Deal <span className="font-semibold text-ink">{dealName(confirm.job)}</span> will stop now. No further
                steps will run: no portal loading, emails, reminders or AI ranking.
              </p>
              <p className="mt-2">Steps already done are not undone. You can delete the deal after stopping it.</p>
            </>
          ) : null
        }
        confirmLabel={confirm?.kind === "delete" ? "Delete deal" : "Stop deal"}
        confirmVariant="danger"
        cancelLabel={confirm?.kind === "delete" ? "Keep deal" : "Keep running"}
        pending={stop.isPending || remove.isPending}
        error={confirmError ? errorMessage(confirmError, "This action could not be completed.") : null}
        onConfirm={runConfirm}
        onCancel={closeConfirm}
      />
    </>
  );
}
