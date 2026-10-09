import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronRight, Database, Eye, RefreshCw, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { adminKeys, useBigQueryDatasets, useBigQueryRows, useBigQueryTables } from "../../api/admin";
import type { BigQueryCell, BigQueryColumn, BigQueryTableInfo } from "../../types/api";
import { cn } from "../../utils/cn";
import { DASH, formatDateTime, formatNumber } from "../../utils/format";
import { DEFAULT_PAGE_SIZE } from "../../utils/pagination";
import { DataTable } from "../DataTable";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { Skeleton } from "../LoadingSkeleton";
import { Pagination } from "../Pagination";
import { IconButton } from "../ui/Button";
import { cardClass } from "../ui/styles";

interface RowItem {
  key: string;
  values: Record<string, BigQueryCell>;
}

function CellValue({ value }: { value: BigQueryCell | undefined }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted">{DASH}</span>;
  const text = String(value);
  return (
    <span className="block max-w-[320px] truncate" title={text}>
      {text}
    </span>
  );
}

function buildRowColumns(columns: BigQueryColumn[], offset: number): ColumnDef<RowItem>[] {
  return [
    {
      id: "__index",
      header: "#",
      cell: ({ row }) => <span className="text-muted tabular-nums">{offset + row.index + 1}</span>,
      meta: { headerClassName: "w-12", cellClassName: "w-12" },
    },
    ...columns.map(
      (column): ColumnDef<RowItem> => ({
        id: column.name,
        header: () => (
          <span title={`${column.name} · ${column.type}`} className="whitespace-nowrap">
            {column.name}
          </span>
        ),
        cell: ({ row }) => <CellValue value={row.original.values[column.name]} />,
      }),
    ),
  ];
}

function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

function TableRowsPanel({ dataset, table }: { dataset: string; table: BigQueryTableInfo }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const rows = useBigQueryRows(dataset, table.id, page, pageSize);
  const pagination = rows.data?.pagination;
  const columnsInfo = rows.data?.columns ?? table.columns;
  const offset = ((pagination?.page ?? page) - 1) * (pagination?.limit ?? pageSize);
  const columns = useMemo(() => buildRowColumns(columnsInfo, offset), [columnsInfo, offset]);
  const items = useMemo(
    () => rows.data?.rows.map((values, index) => ({ key: String(offset + index), values })),
    [rows.data, offset],
  );

  return (
    <section aria-label={`Rows of ${dataset}.${table.id}`} className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold break-all text-ink">
          {dataset}.{table.id}
        </h4>
        <span className="text-xs text-muted">
          {formatNumber(columnsInfo.length)} columns{pagination ? ` · ${formatNumber(pagination.total)} rows` : ""}
        </span>
      </div>
      <div className="flex flex-col">
        <DataTable
          caption={`Rows of ${dataset}.${table.id}`}
          data={items}
          columns={columns}
          getRowId={(row) => row.key}
          isLoading={rows.isPending}
          isFetching={rows.isFetching}
          error={rows.error}
          onRetry={() => void rows.refetch()}
          emptyState={<EmptyState message="This table has no rows." />}
          footer={
            pagination && pagination.total > 0 ? (
              <Pagination
                pagination={pagination}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                disabled={rows.isPlaceholderData}
              />
            ) : null
          }
        />
      </div>
    </section>
  );
}

function TablesList({ dataset }: { dataset: string }) {
  const tables = useBigQueryTables(dataset);
  const [selected, setSelected] = useState<string | null>(null);

  if (tables.isPending) return <ListSkeleton />;
  if (tables.isError) {
    return <ErrorState className="py-4" error={tables.error} onRetry={() => void tables.refetch()} retrying={tables.isFetching} />;
  }
  if (!tables.data.tables.length) return <p className="py-3 text-sm text-muted">This dataset has no tables.</p>;

  const current = tables.data.tables.find((table) => table.id === selected) ?? null;

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {tables.data.tables.map((table) => {
          const open = table.id === selected;
          const Icon = table.type === "VIEW" ? Eye : Table2;
          return (
            <li key={table.id}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setSelected(open ? null : table.id)}
                className={cn(
                  "focus-ring flex w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors",
                  open ? "border-primary/40 bg-primary-soft" : "border-line bg-surface hover:bg-slate-50",
                )}
              >
                <Icon className={cn("size-4 shrink-0", open ? "text-primary" : "text-muted")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm font-semibold break-all", open ? "text-primary" : "text-ink")}>
                    {table.id}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {table.type ?? "TABLE"} · {formatNumber(table.columns.length)} columns
                    {table.rowCount !== null ? ` · ${formatNumber(table.rowCount)} rows` : ""}
                    {table.updatedAt ? ` · updated ${formatDateTime(table.updatedAt)}` : ""}
                  </span>
                </span>
                {open ? (
                  <ChevronDown className="size-4 shrink-0 text-primary" aria-hidden />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {current && <TableRowsPanel key={current.id} dataset={dataset} table={current} />}
    </div>
  );
}

export function BigQueryBrowser() {
  const datasets = useBigQueryDatasets();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: adminKeys.bigquery() });

  return (
    <section aria-labelledby="bigquery-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="bigquery-title" className="text-lg font-bold text-ink">
            BigQuery
          </h2>
          <p className="mt-1 text-sm text-muted">
            Datasets and tables the service account can read
            {datasets.data ? (
              <>
                {" "}
                in project <span className="font-semibold text-ink">{datasets.data.projectId}</span>
              </>
            ) : null}
            . Click a dataset to see its tables, and a table to see its rows.
          </p>
        </div>
        <IconButton label="Refresh BigQuery" large onClick={refresh}>
          <RefreshCw className={cn("size-4", datasets.isFetching && "animate-spin")} aria-hidden />
        </IconButton>
      </div>

      <div className={cn(cardClass, "p-4")}>
        {datasets.isPending ? (
          <ListSkeleton count={2} />
        ) : datasets.isError ? (
          <ErrorState className="py-6" error={datasets.error} onRetry={() => void datasets.refetch()} retrying={datasets.isFetching} />
        ) : !datasets.data.datasets.length ? (
          <EmptyState message="No datasets found." description="The service account cannot see any dataset yet." />
        ) : (
          <ul className="space-y-2">
            {datasets.data.datasets.map((dataset) => {
              const open = dataset.id === selected;
              return (
                <li key={dataset.id} className={cn("rounded-xl border", open ? "border-primary/30" : "border-line")}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setSelected(open ? null : dataset.id)}
                    className={cn(
                      "focus-ring flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors",
                      open ? "bg-primary-soft" : "hover:bg-slate-50",
                    )}
                  >
                    <Database className={cn("size-5 shrink-0", open ? "text-primary" : "text-muted")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block font-semibold break-all", open ? "text-primary" : "text-ink")}>
                        {dataset.id}
                      </span>
                      {dataset.location && <span className="mt-0.5 block text-xs text-muted">{dataset.location}</span>}
                    </span>
                    {open ? (
                      <ChevronDown className="size-5 shrink-0 text-primary" aria-hidden />
                    ) : (
                      <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
                    )}
                  </button>
                  {open && (
                    <div className="border-t px-4 py-3">
                      <TablesList key={dataset.id} dataset={dataset.id} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
