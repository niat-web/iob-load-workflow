import type { ColumnDef } from "@tanstack/react-table";
import { Check, Download, FilterX, Minus, RefreshCw, SearchX, UserPlus, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { errorMessage } from "../../api/client";
import { dealStudentsExportUrl, useAddNewEligible, useDealStudents, useNewEligiblePreview } from "../../api/crm";
import type {
  CrmDealDetail,
  DealStudent,
  DealStudentsQuery,
  NewEligiblePreview,
  StudentAccessFilter,
  StudentAccessStatus,
  Tone,
} from "../../types/api";
import { cn } from "../../utils/cn";
import { DASH, formatDateTime, formatNumber, orDash } from "../../utils/format";
import { DEFAULT_PAGE_SIZE } from "../../utils/pagination";
import { DataTable } from "../DataTable";
import { DetailSection } from "../DetailList";
import { EmptyState } from "../EmptyState";
import { FilterMenu } from "../FilterMenu";
import { LoadingSkeleton } from "../LoadingSkeleton";
import { Pagination } from "../Pagination";
import { SearchInput } from "../SearchInput";
import { StatusBadge } from "../StatusBadge";
import { SummaryStrip, SummaryStripSkeleton } from "../SummaryStrip";
import { useToast } from "../toast-context";
import { Button, IconButton, buttonClass } from "../ui/Button";
import { Card } from "./DealSections";

const ACCESS: Record<StudentAccessStatus, { label: string; tone: Tone }> = {
  ACCESS: { label: "Access given", tone: "green" },
  REFUSED: { label: "Refused", tone: "red" },
  WAITING: { label: "Waiting", tone: "gray" },
};

const ACCESS_FILTERS: { value: StudentAccessFilter; label: string }[] = [
  { value: "ACCESS", label: "Access given" },
  { value: "REFUSED", label: "Refused by the portal" },
  { value: "WAITING", label: "Waiting for access" },
  { value: "APPLIED", label: "Applied" },
  { value: "NOT_APPLIED", label: "Not applied yet" },
];

const PRODUCT_FILTERS = [
  { value: "NIAT", label: "NIAT" },
  { value: "Academy", label: "Academy" },
];

function YesNo({ value, label }: { value: boolean; label: string }) {
  return value ? (
    <Check className="size-4 text-emerald-600" aria-label={`Has ${label}`} />
  ) : (
    <Minus className="size-4 text-slate-300" aria-label={`No ${label}`} />
  );
}

function NewStudentsList({ preview }: { preview: NewEligiblePreview }) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border">
      <table className="w-full min-w-max text-left text-sm">
        <caption className="sr-only">New eligible students</caption>
        <thead className="sticky top-0 bg-slate-50 text-xs font-bold tracking-wider text-muted uppercase">
          <tr>
            {["User ID", "Student", "Campus", "Batch", "Product", "Email", "Mobile"].map((heading) => (
              <th key={heading} scope="col" className="px-3 py-2">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.students.map((student) => (
            <tr key={student.studentId} className="border-t">
              <td className="px-3 py-2 font-mono text-xs text-slate-700">{student.studentId}</td>
              <td className="px-3 py-2 font-semibold text-ink">{student.studentName || DASH}</td>
              <td className="px-3 py-2 text-muted">{orDash(student.campus)}</td>
              <td className="px-3 py-2 text-muted tabular-nums">{orDash(student.batch)}</td>
              <td className="px-3 py-2 text-muted">{orDash(student.product)}</td>
              <td className="px-3 py-2">
                <YesNo value={student.hasEmail} label="email" />
              </td>
              <td className="px-3 py-2">
                <YesNo value={student.hasMobile} label="mobile" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NewEligibleCard({ deal }: { deal: CrmDealDetail }) {
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  const preview = useNewEligiblePreview(deal.id, checking);
  const add = useAddNewEligible(deal.id);
  const state = deal.addEligible;

  const giveAccess = () =>
    add.mutate(undefined, {
      onSuccess: ({ result }) => {
        setChecking(false);
        toast.success(
          result.accessNow
            ? `${result.added} new students added. Job access given to ${result.granted}${result.rejected ? `, ${result.rejected} refused by the portal` : ""}.`
            : `${result.added} new students added. They get job access when "Give students access" is approved.`,
        );
      },
      onError: (err) => toast.error(errorMessage(err, "The new students could not be added.")),
    });

  const renderPreview = () => {
    if (preview.isPending) return <LoadingSkeleton lines={3} label="Checking the Eligible Pool" />;
    if (preview.isError) {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage(preview.error, "The Eligible Pool could not be checked.")}
          </p>
          <Button variant="ghost" size="sm" loading={preview.isFetching} onClick={() => void preview.refetch()}>
            Check again
          </Button>
        </div>
      );
    }
    const data = preview.data;
    if (data.total === 0) {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink">No new eligible students for this deal. Everyone who matches already has it.</p>
          <Button variant="ghost" size="sm" loading={preview.isFetching} onClick={() => void preview.refetch()}>
            Check again
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setChecking(false)}>
            Close
          </Button>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-ink">
          {formatNumber(data.total)} new students · {formatNumber(data.withEmail)} with email ·{" "}
          {formatNumber(data.withMobile)} with mobile
        </p>
        <NewStudentsList preview={data} />
        {data.total > data.students.length && (
          <p className="text-xs text-muted">
            Showing the first {formatNumber(data.students.length)}; all {formatNumber(data.total)} will be added.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button loading={add.isPending} onClick={giveAccess} icon={<UserPlus className="size-4" aria-hidden />}>
            {data.accessNow
              ? `Give job access to ${formatNumber(data.total)} students`
              : `Add ${formatNumber(data.total)} students to this deal`}
          </Button>
          <Button variant="ghost" onClick={() => setChecking(false)} disabled={add.isPending}>
            Cancel
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <DetailSection title="Add New Eligible Students">
        {!state.allowed ? (
          <p className="text-sm text-muted">{state.reason}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Students added to the Eligible Pool after this deal's list was made can join it here. Only students who match
              this deal (same products, marked Eligible, same pass-out year) and are not on it yet are picked.{" "}
              {state.accessNow
                ? "They get job access on the Learning Portal straight away, the portal emails them, and they are included in the remaining reminders and AI calls."
                : 'They get job access together with everyone else when "Give students access" is approved.'}
            </p>
            {checking ? (
              renderPreview()
            ) : (
              <Button size="sm" onClick={() => setChecking(true)} icon={<UserPlus className="size-4" aria-hidden />}>
                Check for new eligible students
              </Button>
            )}
          </div>
        )}
      </DetailSection>
    </Card>
  );
}

function buildColumns(offset: number): ColumnDef<DealStudent>[] {
  return [
    {
      id: "index",
      header: "#",
      cell: ({ row }) => <span className="text-muted tabular-nums">{offset + row.index + 1}</span>,
      meta: { headerClassName: "w-12", cellClassName: "w-12" },
    },
    {
      id: "studentId",
      header: "User ID",
      cell: ({ row }) => <span className="font-mono text-xs text-slate-700">{row.original.studentId}</span>,
    },
    {
      id: "student",
      header: "Student",
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-semibold text-ink">{row.original.studentName || DASH}</span>
          <span className="text-xs text-muted">{[row.original.campus, row.original.batch].filter(Boolean).join(" · ") || DASH}</span>
        </span>
      ),
    },
    { id: "product", header: "Product", cell: ({ row }) => orDash(row.original.product) },
    { id: "email", header: "Email", cell: ({ row }) => <span className="text-muted">{orDash(row.original.email)}</span> },
    { id: "mobile", header: "Mobile", cell: ({ row }) => <span className="text-muted tabular-nums">{orDash(row.original.mobile)}</span> },
    {
      id: "access",
      header: "Job Access",
      cell: ({ row }) => {
        const status = ACCESS[row.original.status];
        const detail =
          row.original.status === "ACCESS"
            ? formatDateTime(row.original.accessGrantedAt)
            : row.original.status === "REFUSED"
              ? row.original.accessRejectedReason
              : "Not given yet";
        return (
          <span className="flex flex-col items-start gap-1">
            <StatusBadge label={status.label} tone={status.tone} />
            <span className="max-w-[260px] truncate text-xs text-muted" title={detail ?? undefined}>
              {detail ?? DASH}
            </span>
          </span>
        );
      },
    },
    {
      id: "applied",
      header: "Applied",
      cell: ({ row }) =>
        row.original.applied ? (
          <span className="flex flex-col items-start gap-1">
            <StatusBadge label="Applied" tone="blue" />
            <span className="text-xs text-muted tabular-nums">{formatDateTime(row.original.appliedAt)}</span>
          </span>
        ) : (
          <span className="text-muted">Not yet</span>
        ),
    },
    {
      id: "eligibleAt",
      header: "Added",
      cell: ({ row }) => <span className="text-muted tabular-nums">{formatDateTime(row.original.eligibleAt)}</span>,
    },
  ];
}

export function DealStudentsTab({ deal }: { deal: CrmDealDetail }) {
  const [search, setSearch] = useState("");
  const [access, setAccess] = useState<string[]>([]);
  const [product, setProduct] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const filters = useMemo(
    () => ({
      search: search.trim() || undefined,
      access: access.join("|") || undefined,
      product: product.join("|") || undefined,
    }),
    [search, access, product],
  );
  const query = useMemo<DealStudentsQuery>(() => ({ ...filters, page, limit: pageSize }), [filters, page, pageSize]);
  const students = useDealStudents(deal.id, query);
  const summary = students.data?.summary;
  const pagination = students.data?.pagination;
  const offset = ((pagination?.page ?? page) - 1) * (pagination?.limit ?? pageSize);
  const columns = useMemo(() => buildColumns(offset), [offset]);
  const hasFilters = Boolean(filters.search || filters.access || filters.product);

  const clear = () => {
    setSearch("");
    setAccess([]);
    setProduct([]);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-5">
      {summary ? (
        <SummaryStrip
          items={[
            { label: "On this deal", value: formatNumber(summary.total) },
            { label: "Access given", value: formatNumber(summary.access) },
            { label: "Refused by portal", value: formatNumber(summary.refused) },
            { label: "Waiting for access", value: formatNumber(summary.waiting) },
            { label: "Applied", value: formatNumber(summary.applied) },
            {
              label: "Products",
              value:
                Object.entries(summary.products)
                  .map(([name, count]) => `${name} ${formatNumber(count)}`)
                  .join(" · ") || DASH,
            },
          ]}
        />
      ) : (
        <SummaryStripSkeleton count={6} />
      )}

      <NewEligibleCard deal={deal} />

      <section aria-label="Students on this deal" className="flex min-h-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search user ID, name, email, mobile..."
            label="Search students on this deal"
            className="w-full sm:w-80"
          />
          <FilterMenu
            categories={[
              { key: "access", label: "Job access", options: ACCESS_FILTERS },
              { key: "product", label: "Product", options: PRODUCT_FILTERS },
            ]}
            values={{ access, product }}
            onChange={(key, values) => {
              if (key === "access") setAccess(values);
              else setProduct(values);
              setPage(1);
            }}
            onClear={clear}
          />
          <Button variant="ghost" onClick={clear} disabled={!hasFilters} icon={<FilterX className="size-4" aria-hidden />}>
            Clear Filters
          </Button>
          <a
            href={dealStudentsExportUrl(deal.id, filters)}
            download
            className={cn(buttonClass("secondary", "md"), "gap-2 sm:ml-auto")}
          >
            <Download className="size-4" aria-hidden />
            Download CSV
          </a>
          <IconButton label="Refresh" large onClick={() => void students.refetch()}>
            <RefreshCw className={cn("size-4", students.isFetching && "animate-spin")} aria-hidden />
          </IconButton>
        </div>

        <div className="flex flex-col">
          <DataTable
            caption="Students on this deal"
            data={students.data?.items}
            columns={columns}
            getRowId={(row) => row.studentId}
            isLoading={students.isPending}
            isFetching={students.isFetching}
            error={students.error}
            onRetry={() => void students.refetch()}
            emptyState={
              hasFilters ? (
                <EmptyState
                  icon={<SearchX strokeWidth={1.6} aria-hidden />}
                  message="No students match your search or filters."
                  action={
                    <Button variant="secondary" size="sm" onClick={clear}>
                      Clear Filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<UsersRound strokeWidth={1.6} aria-hidden />}
                  message="No students are on this deal yet."
                  description="Students are added at the Find eligible students step."
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
                  disabled={students.isPlaceholderData}
                />
              ) : null
            }
          />
        </div>
      </section>
    </div>
  );
}
