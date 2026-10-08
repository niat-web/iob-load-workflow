import type { ColumnDef } from "@tanstack/react-table";
import { FilterX, SlidersHorizontal, GraduationCap, Pencil, SearchX, Trash2, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { errorMessage } from "../api/client";
import { useDeletePoolStudent, useEligiblePool, useEligiblePoolSummary } from "../api/admin";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable, type TableSort } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { FilterSelect } from "../components/FilterSelect";
import { Pagination } from "../components/Pagination";
import { PoolStudentDialog } from "../components/pool/PoolStudentDialog";
import { SearchInput } from "../components/SearchInput";
import { StatusBadge } from "../components/StatusBadge";
import { Drawer } from "../components/Drawer";
import { useToast } from "../components/toast-context";
import { Button, IconButton } from "../components/ui/Button";
import { useClampPage, useUrlFilters } from "../hooks/useUrlFilters";
import { ELIGIBILITY_STATUSES, type EligiblePoolQuery, type EligiblePoolStudent } from "../types/api";
import { formatNumber } from "../utils/format";
import { productTone, statusTone } from "../utils/poolTones";
import { DEFAULT_PAGE_SIZE } from "../utils/pagination";

const FILTER_KEYS = ["q", "product", "status", "campus"] as const;

function textColumn(
  id: string,
  header: string,
  value: (student: EligiblePoolStudent) => string | number | null,
  options: { className?: string; sortKey?: string } = {},
): ColumnDef<EligiblePoolStudent> {
  return {
    id,
    header,
    cell: ({ row }) => {
      const content = value(row.original);
      if (content === null || content === "") return null;
      return <span className={options.className}>{content}</span>;
    },
    meta: options.sortKey ? { sortKey: options.sortKey } : undefined,
  };
}

interface PoolActions {
  onEdit: (student: EligiblePoolStudent) => void;
  onDelete: (student: EligiblePoolStudent) => void;
}

function buildPoolColumns(offset: number, actions: PoolActions): ColumnDef<EligiblePoolStudent>[] {
  return [
    {
      id: "index",
      header: "#",
      cell: ({ row }) => <span className="text-muted tabular-nums">{offset + row.index + 1}</span>,
      meta: { headerClassName: "w-12", cellClassName: "w-12" },
    },
    textColumn("userId", "User ID", (student) => student.studentId, {
      sortKey: "studentId",
      className: "font-mono text-xs whitespace-nowrap text-slate-600",
    }),
    textColumn("niatId", "NIAT ID", (student) => student.niatId, {
      sortKey: "niatId",
      className: "font-mono text-xs whitespace-nowrap",
    }),
    textColumn("name", "Name", (student) => student.studentName, {
      sortKey: "studentName",
      className: "font-semibold whitespace-nowrap text-ink",
    }),
    textColumn("mobile", "Mobile", (student) => student.mobile, {
      sortKey: "mobile",
      className: "whitespace-nowrap tabular-nums",
    }),
    textColumn("email", "Email", (student) => student.email, { sortKey: "email", className: "break-all" }),
    {
      id: "product",
      meta: { sortKey: "productGroup" },
      header: "Product",
      cell: ({ row }) =>
        row.original.productGroup && row.original.productGroup !== "Unknown" ? (
          <StatusBadge label={row.original.productGroup} tone={productTone(row.original.productGroup)} />
        ) : null,
    },
    textColumn("campus", "Campus", (student) => student.campus, {
      sortKey: "campus",
      className: "block max-w-64 truncate",
    }),
    textColumn("batch", "Batch", (student) => student.batch, { sortKey: "batch", className: "tabular-nums" }),
    {
      id: "status",
      meta: { sortKey: "eligibilityStatus" },
      header: "Eligibility Status",
      cell: ({ row }) =>
        row.original.eligibilityStatus ? (
          <StatusBadge label={row.original.eligibilityStatus} tone={statusTone(row.original.eligibilityStatus)} />
        ) : null,
    },
    textColumn("remarks", "Remarks", (student) => student.remarks, {
      sortKey: "remarks",
      className: "block max-w-56 truncate",
    }),
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <span className="flex items-center justify-end gap-1">
          <IconButton
            label={`Edit ${row.original.studentName || row.original.studentId}`}
            className="size-8 border-transparent shadow-none"
            onClick={() => actions.onEdit(row.original)}
          >
            <Pencil className="size-4" aria-hidden />
          </IconButton>
          <IconButton
            label={`Delete ${row.original.studentName || row.original.studentId}`}
            className="size-8 border-transparent text-red-600 shadow-none hover:bg-red-50"
            onClick={() => actions.onDelete(row.original)}
          >
            <Trash2 className="size-4" aria-hidden />
          </IconButton>
        </span>
      ),
      meta: { headerClassName: "text-right", cellClassName: "text-right" },
    },
  ];
}

export function EligiblePoolPage() {
  const { filters, page, hasFilters, setFilter, setPage, clearFilters } = useUrlFilters(FILTER_KEYS);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const toast = useToast();
  const summary = useEligiblePoolSummary();
  const remove = useDeletePoolStudent();
  const { reset: resetRemove } = remove;
  const [editor, setEditor] = useState<{ student: EligiblePoolStudent | null } | null>(null);
  const [deleting, setDeleting] = useState<EligiblePoolStudent | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<TableSort | null>(null);

  const activeFilters = [filters.product, filters.status, filters.campus].filter(Boolean).length;

  const query = useMemo<EligiblePoolQuery>(
    () => ({
      search: filters.q.trim() || undefined,
      product: filters.product || undefined,
      status: filters.status || undefined,
      campus: filters.campus || undefined,
      sort: sort ? `${sort.key}:${sort.dir}` : undefined,
      page,
      limit: pageSize,
    }),
    [filters.q, filters.product, filters.status, filters.campus, sort, page, pageSize],
  );
  const pool = useEligiblePool(query);
  const pagination = pool.data?.pagination;
  useClampPage(page, pagination?.totalPages, setPage);

  const offset = ((pagination?.page ?? page) - 1) * (pagination?.limit ?? pageSize);
  const columns = useMemo(
    () =>
      buildPoolColumns(offset, {
        onEdit: (student) => setEditor({ student }),
        onDelete: (student) => {
          resetRemove();
          setDeleting(student);
        },
      }),
    [offset, resetRemove],
  );

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.studentId, {
      onSuccess: () => {
        toast.success(`${deleting.studentName || deleting.studentId} removed from the eligible pool`);
        setDeleting(null);
      },
    });
  };

  const productOptions = useMemo(
    () =>
      (summary.data?.products ?? []).map((row) => ({
        value: row.product,
        label: `${row.product} (${formatNumber(row.count)})`,
      })),
    [summary.data],
  );
  const statusOptions = useMemo(() => {
    const counts = new Map((summary.data?.statuses ?? []).map((row) => [row.status, row.count]));
    return ELIGIBILITY_STATUSES.map((status) => ({
      value: status,
      label: `${status} (${formatNumber(counts.get(status) ?? 0)})`,
    }));
  }, [summary.data]);
  const campusOptions = useMemo(
    () =>
      (summary.data?.campuses ?? []).map((row) => ({
        value: row.campus,
        label: `${row.campus} (${formatNumber(row.count)})`,
      })),
    [summary.data],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <h1 className="sr-only">Eligible pool</h1>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={filters.q}
          onChange={(value) => setFilter("q", value)}
          placeholder="Search name, NIAT ID, mobile, email or user ID..."
          label="Search the eligible pool"
          className="w-full sm:w-96"
        />
        <Button
          variant="secondary"
          className="sm:ml-auto"
          onClick={() => setFiltersOpen(true)}
          icon={<SlidersHorizontal className="size-4" aria-hidden />}
          aria-label={activeFilters ? `Filters, ${activeFilters} active` : "Filters"}
        >
          Filters
          {activeFilters > 0 && (
            <span className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
              {activeFilters}
            </span>
          )}
        </Button>
        <Button
          variant="ghost"
          onClick={clearFilters}
          disabled={!hasFilters}
          icon={<FilterX className="size-4" aria-hidden />}
        >
          Clear Filters
        </Button>
        <Button onClick={() => setEditor({ student: null })} icon={<UserPlus className="size-4" aria-hidden />}>
          Add student
        </Button>
      </div>

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <div className="space-y-5">
          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-ink">Product</p>
            <FilterSelect
              value={filters.product}
              onChange={(value) => setFilter("product", value)}
              options={productOptions}
              placeholder="All Products"
              label="Filter by product"
              className="w-full"
            />
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-ink">Eligibility status</p>
            <FilterSelect
              value={filters.status}
              onChange={(value) => setFilter("status", value)}
              options={statusOptions}
              placeholder="All Statuses"
              label="Filter by eligibility status"
              className="w-full"
            />
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-ink">Campus</p>
            <FilterSelect
              value={filters.campus}
              onChange={(value) => setFilter("campus", value)}
              options={campusOptions}
              placeholder="All Campuses"
              label="Filter by campus"
              className="w-full"
            />
          </div>
          <p className="text-sm text-muted">
            {pagination ? `${formatNumber(pagination.total)} students match` : "Loading…"}
          </p>
          <div className="flex justify-end gap-2 border-t pt-5">
            <Button variant="secondary" onClick={clearFilters} disabled={activeFilters === 0}>
              Clear
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>Done</Button>
          </div>
        </div>
      </Drawer>

      <DataTable
        caption="Eligible pool students"
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        data={pool.data?.items}
        columns={columns}
        getRowId={(row) => row.studentId}
        isLoading={pool.isPending}
        isFetching={pool.isFetching}
        error={pool.error}
        onRetry={() => void pool.refetch()}
        emptyState={
          hasFilters ? (
            <EmptyState
              icon={<SearchX className="size-5" aria-hidden />}
              message="No students match your search or filters."
              action={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear Filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<GraduationCap strokeWidth={1.6} aria-hidden />}
              message="The eligible pool is empty."
              description="Add students here, or sync them from BigQuery under Settings → Config."
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
              disabled={pool.isPlaceholderData}
            />
          ) : null
        }
      />

      <PoolStudentDialog open={editor !== null} student={editor?.student ?? null} onClose={() => setEditor(null)} />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this student?"
        message={
          deleting && (
            <>
              <span className="font-semibold text-ink">{deleting.studentName || deleting.studentId}</span> (
              {deleting.studentId}) will be removed from the eligible pool.
              {!deleting.manual && " They come back at the next BigQuery sync if they are still in BigQuery."}
            </>
          )
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        pending={remove.isPending}
        error={remove.isError ? errorMessage(remove.error, "The student could not be deleted.") : null}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
