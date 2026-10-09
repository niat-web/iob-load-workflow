import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Inbox, RefreshCw, SearchX, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { hasStatus } from "../api/client";
import { applicantResumeUrl, useApplicants, usePsmJob } from "../api/psm";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Pagination } from "../components/Pagination";
import { SearchInput } from "../components/SearchInput";
import { TruncatedText } from "../components/TruncatedText";
import { Button, IconButton } from "../components/ui/Button";
import { cardClass, linkClass } from "../components/ui/styles";
import { useClampPage, useUrlFilters } from "../hooks/useUrlFilters";
import type { PsmApplicant, PsmApplicantsQuery, PsmApplicantsResponse } from "../types/api";
import { cn } from "../utils/cn";
import { DASH, formatDateTime, formatNumber, orDash } from "../utils/format";
import { DEFAULT_PAGE_SIZE } from "../utils/pagination";

const FILTER_KEYS = ["q"] as const;

function useBackLink(): string {
  const location = useLocation();
  const backTo = (location.state as { backTo?: unknown } | null)?.backTo;
  return typeof backTo === "string" && backTo.startsWith("/psm") && !backTo.startsWith("//") ? backTo : "/psm";
}

function buildColumns(jobId: string, offset: number): ColumnDef<PsmApplicant>[] {
  return [
    {
      id: "index",
      header: "#",
      cell: ({ row }) => <span className="text-muted tabular-nums">{offset + row.index + 1}</span>,
      meta: { headerClassName: "w-12", cellClassName: "w-12" },
    },
    {
      id: "studentName",
      header: "Student Name",
      cell: ({ row }) => <TruncatedText value={orDash(row.original.studentName)} className="max-w-[200px] font-semibold" />,
    },
    {
      id: "studentId",
      header: "User ID",
      cell: ({ row }) => <TruncatedText value={row.original.studentId} className="max-w-[160px] font-mono text-xs text-slate-700" />,
    },
    { id: "product", header: "Product", cell: ({ row }) => <span className="text-muted">{orDash(row.original.product)}</span> },
    {
      id: "campus",
      header: "Campus",
      cell: ({ row }) => <TruncatedText value={orDash(row.original.campus)} className="max-w-[160px] text-muted" />,
    },
    { id: "batch", header: "Batch", cell: ({ row }) => <span className="text-muted tabular-nums">{orDash(row.original.batch)}</span> },
    {
      id: "email",
      header: "Email",
      cell: ({ row }) => <TruncatedText value={orDash(row.original.email)} className="max-w-[220px] text-muted" />,
    },
    { id: "mobile", header: "Mobile", cell: ({ row }) => <span className="text-muted tabular-nums">{orDash(row.original.mobile)}</span> },
    {
      id: "appliedAt",
      header: "Applied At",
      cell: ({ row }) => <span className="whitespace-nowrap text-muted tabular-nums">{formatDateTime(row.original.appliedAt)}</span>,
    },
    {
      id: "resume",
      header: "Resume",
      cell: ({ row }) =>
        row.original.hasResume ? (
          <a href={applicantResumeUrl(jobId, row.original.studentId)} target="_blank" rel="noopener noreferrer" className={linkClass}>
            View
            <span className="sr-only"> resume of {row.original.studentName} (opens in a new tab)</span>
          </a>
        ) : (
          <span className="text-muted">{DASH}</span>
        ),
    },
  ];
}

function SyncNote({ data }: { data: PsmApplicantsResponse | undefined }) {
  if (!data) return null;
  const synced = data.lastSyncedAt ? `Last synced ${formatDateTime(data.lastSyncedAt)}.` : "Not synced yet.";
  return (
    <div className="flex flex-col gap-2">
      <p className={cn(cardClass, "px-4 py-3 text-sm text-ink")}>
        {data.windowOpen ? (
          <>
            <span className="font-semibold">{formatNumber(data.appliedCount)} applied so far.</span> The applied pool is read
            from BigQuery every 30 minutes while the window is open, until it closes on {formatDateTime(data.applicationEndAt)}.{" "}
            {synced}
          </>
        ) : (
          <>
            <span className="font-semibold">{formatNumber(data.appliedCount)} applied.</span> The application window has closed.
            The AI ranking runs next, and the review opens on Candidate Pools when it is ready. {synced}
          </>
        )}
      </p>
      {data.syncError && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          The last sync failed and runs again at the next 30-minute check: {data.syncError}
        </p>
      )}
    </div>
  );
}

export function PSMApplicantsPage() {
  const { jobId = "" } = useParams();
  const backTo = useBackLink();
  const job = usePsmJob(jobId, jobId.length > 0);
  const { filters, page, hasFilters, setFilter, setPage, clearFilters } = useUrlFilters(FILTER_KEYS);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const query = useMemo<PsmApplicantsQuery>(
    () => ({ search: filters.q.trim() || undefined, page, limit: pageSize }),
    [filters.q, page, pageSize],
  );
  const applicants = useApplicants(jobId, query);
  const pagination = applicants.data?.pagination;
  useClampPage(page, pagination?.totalPages, setPage);
  const offset = ((pagination?.page ?? page) - 1) * (pagination?.limit ?? pageSize);
  const columns = useMemo(() => buildColumns(jobId, offset), [jobId, offset]);
  const title = [job.data?.companyName, job.data?.jobRole].filter(Boolean).join(" · ");

  const back = (
    <Link to={backTo} className="focus-ring inline-flex items-center gap-1.5 rounded text-sm font-semibold text-muted hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden />
      Back
    </Link>
  );

  if (hasStatus(applicants.error, 404) || hasStatus(job.error, 404)) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="sr-only">Applicants</h1>
        {back}
        <div className={cardClass}>
          <EmptyState message="This deal could not be found." />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {back}
          <h1 className="mt-2 truncate text-xl font-bold tracking-tight text-ink">{title || "Applicants"}</h1>
          <p className="mt-0.5 text-sm text-muted">Students who have applied, updated live from the applied pool.</p>
        </div>
      </div>

      <SyncNote data={applicants.data} />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={filters.q}
          onChange={(value) => setFilter("q", value)}
          placeholder="Search by name, user ID or email..."
          label="Search applicants"
          className="w-full sm:w-80"
        />
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear search
          </Button>
        )}
        <IconButton label="Refresh" large className="sm:ml-auto" onClick={() => void applicants.refetch()}>
          <RefreshCw className={cn("size-4", applicants.isFetching && "animate-spin")} aria-hidden />
        </IconButton>
      </div>

      {applicants.isError && !applicants.data ? (
        <div className={cardClass}>
          <ErrorState error={applicants.error} onRetry={() => void applicants.refetch()} retrying={applicants.isFetching} />
        </div>
      ) : (
        <DataTable
          caption="Applicants so far"
          data={applicants.data?.items}
          columns={columns}
          getRowId={(row) => row.studentId}
          isLoading={applicants.isPending}
          isFetching={applicants.isFetching}
          error={applicants.error}
          onRetry={() => void applicants.refetch()}
          emptyState={
            hasFilters ? (
              <EmptyState icon={<SearchX className="size-5" aria-hidden />} message="No applicants match your search." />
            ) : (
              <EmptyState
                icon={<Inbox className="size-5" aria-hidden />}
                message="No applications yet."
                description="Students appear here within 30 minutes of applying."
              />
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
                disabled={applicants.isPlaceholderData}
              />
            ) : null
          }
        />
      )}
    </div>
  );
}
