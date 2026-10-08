import { ArrowLeft, FilterX, SearchX, Send, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { errorMessage, hasStatus, isApiError } from "../api/client";
import { useCandidates, usePsmJob, useRefreshReview, useStartReview, useSubmitPool, useUpdateCandidate } from "../api/psm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { FilterSelect } from "../components/FilterSelect";
import { Pagination } from "../components/Pagination";
import { buildCandidateColumns } from "../components/psm/candidateColumns";
import { SubmittedNote } from "../components/psm/SubmittedNote";
import { SearchInput } from "../components/SearchInput";
import { StatusBadge } from "../components/StatusBadge";
import { SummaryStrip, SummaryStripSkeleton } from "../components/SummaryStrip";
import { useToast } from "../components/toast-context";
import { Button } from "../components/ui/Button";
import { cardClass } from "../components/ui/styles";
import { useClampPage, useUrlFilters } from "../hooks/useUrlFilters";
import { DEFAULT_PAGE_SIZE } from "../utils/pagination";
import type { CandidatePatch, CandidatesQuery, PsmJobDetail } from "../types/api";
import { CANDIDATE_STATUS_OPTIONS } from "../utils/candidate";
import { formatNumber, priorityOptions } from "../utils/format";
import { AccessDenied } from "./AccessDenied";

const FILTER_KEYS = ["q", "aiPriority", "finalPriority", "status"] as const;
const CONFIRM_MESSAGE =
  "You are about to finalize this candidate pool. Please verify all priority changes before submitting.";
const FROZEN_MESSAGE = "This candidate pool has already been submitted. Changes are no longer allowed.";

function useBackLink(): string {
  const location = useLocation();
  const state = location.state as { backTo?: unknown } | null;
  const backTo = state?.backTo;
  return typeof backTo === "string" && backTo.startsWith("/psm") && !backTo.startsWith("//") ? backTo : "/psm";
}

function BackLink() {
  const to = useBackLink();
  return (
    <Link
      to={to}
      className="focus-ring inline-flex items-center gap-1.5 rounded text-sm font-semibold text-muted hover:text-ink"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Back
    </Link>
  );
}

function ReviewSummary({ job }: { job: PsmJobDetail }) {
  return (
    <SummaryStrip
      items={[
        { label: "Company", value: job.companyName },
        { label: "Job Role", value: job.jobRole },
        { label: "Deal ID", value: <span className="tabular-nums">{job.hubspotDealId}</span> },
        { label: "Expected Pool", value: formatNumber(job.expectedPoolCount) },
        { label: "Total Applied", value: formatNumber(job.appliedCount) },
        { label: "Application Status", value: job.applicationStatus },
        { label: "AI Analysis Status", value: <StatusBadge chip={job.aiStatus} /> },
      ]}
    />
  );
}

export function PSMReviewPage() {
  const { jobId = "" } = useParams();
  return <PSMReview key={jobId} jobId={jobId} />;
}

function PSMReview({ jobId }: { jobId: string }) {
  const toast = useToast();
  const refreshReview = useRefreshReview(jobId);
  const { filters, page, hasFilters, setFilter, setPage, clearFilters } = useUrlFilters(FILTER_KEYS);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const startReview = useStartReview(jobId);
  const { mutate: start } = startReview;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
  }, [start]);
  const ready = startReview.isSuccess || startReview.isError;

  const job = usePsmJob(jobId, ready);

  const query = useMemo<CandidatesQuery>(
    () => ({
      search: filters.q.trim() || undefined,
      aiPriority: filters.aiPriority || undefined,
      finalPriority: filters.finalPriority || undefined,
      status: filters.status || undefined,
      page,
      limit: pageSize,
    }),
    [filters, page, pageSize],
  );
  const candidates = useCandidates(jobId, query, ready);
  const pagination = candidates.data?.pagination;
  useClampPage(page, pagination?.totalPages, setPage);

  const update = useUpdateCandidate(jobId);
  const { mutateAsync: updateAsync } = update;
  const save = useCallback(
    async (studentId: string, patch: CandidatePatch) => {
      try {
        await updateAsync({ studentId, patch });
        return true;
      } catch (err) {
        if (isApiError(err) && err.code === "REVIEW_FROZEN") {
          toast.error(FROZEN_MESSAGE);
          refreshReview();
        } else {
          toast.error(errorMessage(err, "The change could not be saved."));
        }
        return false;
      }
    },
    [updateAsync, toast, refreshReview],
  );

  const submit = useSubmitPool(jobId);
  const handleConfirm = () => {
    submit.mutate(undefined, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast.success("Candidate pool submitted");
        window.scrollTo({ top: 0, behavior: "smooth" });
      },
      onError: (err) => {
        if (isApiError(err) && err.code === "REVIEW_FROZEN") {
          setConfirmOpen(false);
          toast.error(FROZEN_MESSAGE);
          refreshReview();
        }
      },
    });
  };

  const detail = job.data;
  const readOnly = detail?.isSubmitted ?? true;
  const candidateCount = detail?.candidateCount ?? 0;
  const offset = ((pagination?.page ?? page) - 1) * (pagination?.limit ?? pageSize);

  const columns = useMemo(
    () => buildCandidateColumns({ jobId, offset, candidateCount, readOnly, save }),
    [jobId, offset, candidateCount, readOnly, save],
  );
  const priorities = useMemo(() => priorityOptions(candidateCount), [candidateCount]);

  if (job.isError && !detail) {
    let content;
    if (hasStatus(job.error, 404)) {
      content = <EmptyState message="This candidate pool could not be found." />;
    } else if (hasStatus(job.error, 403)) {
      content = <AccessDenied message={errorMessage(job.error, "You do not have access to this candidate pool.")} />;
    } else {
      content = <ErrorState error={job.error} onRetry={() => void job.refetch()} retrying={job.isFetching} />;
    }
    return (
      <div className="space-y-4">
        <h1 className="sr-only">Candidate review</h1>
        <BackLink />
        <div className={cardClass}>{content}</div>
      </div>
    );
  }

  const startError =
    startReview.isError && !hasStatus(startReview.error, 404, 403) && !detail?.isSubmitted
      ? errorMessage(startReview.error, "The review could not be started.")
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <h1 className="sr-only">Candidate review</h1>
      <BackLink />

      {detail ? <ReviewSummary job={detail} /> : <SummaryStripSkeleton count={7} />}

      {startError && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {startError}
        </p>
      )}

      {detail?.isSubmitted && <SubmittedNote job={detail} />}

      <section aria-label="Candidates" className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={filters.q}
            onChange={(v) => setFilter("q", v)}
            placeholder="Search by name or student ID..."
            label="Search candidates"
            className="w-full sm:w-72"
          />
          <FilterSelect
            value={filters.aiPriority}
            onChange={(v) => setFilter("aiPriority", v)}
            options={priorities}
            placeholder="All AI Priority"
            label="Filter by AI priority"
            className="w-[calc(50%-4px)] sm:w-40"
          />
          <FilterSelect
            value={filters.finalPriority}
            onChange={(v) => setFilter("finalPriority", v)}
            options={priorities}
            placeholder="All Final Priority"
            label="Filter by final priority"
            className="w-[calc(50%-4px)] sm:w-40"
          />
          <FilterSelect
            value={filters.status}
            onChange={(v) => setFilter("status", v)}
            options={CANDIDATE_STATUS_OPTIONS}
            placeholder="All Candidate Status"
            label="Filter by candidate status"
            className="w-[calc(50%-4px)] sm:w-48"
          />
          {hasFilters && (
            <Button variant="ghost" onClick={clearFilters} icon={<FilterX className="size-4" aria-hidden />}>
              Clear Filters
            </Button>
          )}
        </div>

        <DataTable
          caption="Candidate pool"
          data={detail ? candidates.data?.items : undefined}
          columns={columns}
          getRowId={(row) => row.studentId}
          isLoading={!detail || candidates.isPending}
          isFetching={candidates.isFetching}
          error={candidates.error}
          onRetry={() => void candidates.refetch()}
          emptyState={
            hasFilters ? (
              <EmptyState
                icon={<SearchX className="size-5" aria-hidden />}
                message="No candidates match your search or filters."
                action={
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Clear Filters
                  </Button>
                }
              />
            ) : (
              <EmptyState message="No candidates in this pool yet." />
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
              disabled={candidates.isPlaceholderData}
            />
            ) : null
          }
        />
      </section>

      {detail && !detail.isSubmitted && (
        <div className="flex shrink-0 justify-end">
          <Button
            onClick={() => {
              submit.reset();
              setConfirmOpen(true);
            }}
            icon={<Send className="size-4" aria-hidden />}
          >
            Submit Final Candidate Pool
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Submit Final Candidate Pool"
        message={CONFIRM_MESSAGE}
        cancelLabel="Cancel"
        confirmLabel="Confirm & Submit"
        pending={submit.isPending}
        error={submit.isError ? errorMessage(submit.error, "The candidate pool could not be submitted.") : null}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
