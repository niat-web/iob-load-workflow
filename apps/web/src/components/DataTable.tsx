import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import { ErrorState } from "./ErrorState";
import { Skeleton } from "./LoadingSkeleton";
import { cardClass } from "./ui/styles";

interface DataTableProps<T> {
  data: T[] | undefined;
  columns: ColumnDef<T>[];
  getRowId: (row: T) => string;
  isLoading: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyState: ReactNode;
  caption: string;
  footer?: ReactNode;
  skeletonRows?: number;
  rowClassName?: (row: T) => string | undefined;
  sort?: TableSort | null;
  onSortChange?: (sort: TableSort | null) => void;
}

export interface TableSort {
  key: string;
  dir: "asc" | "desc";
}

function nextSort(current: TableSort | null | undefined, key: string): TableSort | null {
  if (current?.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

const EMPTY: never[] = [];
const SKELETON_WIDTHS = ["w-10", "w-24", "w-32", "w-20", "w-28", "w-16"];

export function DataTable<T>({
  data,
  columns,
  getRowId,
  isLoading,
  isFetching = false,
  error,
  onRetry,
  emptyState,
  caption,
  footer,
  skeletonRows = 8,
  rowClassName,
  sort,
  onSortChange,
}: DataTableProps<T>) {
  // oxlint-disable-next-line react/incompatible-library -- React Compiler is not used; TanStack Table v8 is intentional.
  const table = useReactTable<T>({
    data: data ?? EMPTY,
    columns,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  const rows = table.getRowModel().rows;
  const showError = Boolean(error) && rows.length === 0;
  const showSkeleton = !showError && isLoading && rows.length === 0;
  const showEmpty = !showError && !showSkeleton && rows.length === 0;
  const scrolls = rows.length > 0 || showSkeleton;
  const leafColumns = table.getVisibleLeafColumns();

  return (
    <div className={cn(cardClass, "relative flex min-h-[320px] flex-1 flex-col overflow-hidden")}>
      {isFetching && !showSkeleton && (
        <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden" aria-hidden>
          <div className="h-full w-1/3 animate-indeterminate bg-primary/60" />
        </div>
      )}
      <div
        className={cn(
          "overscroll-contain",
          scrolls ? "min-h-0 flex-1 overflow-auto" : "shrink-0 overflow-x-auto overflow-y-hidden",
        )}
      >
        <table
          className="w-full min-w-max border-separate border-spacing-0 text-left text-sm [&>tbody>tr:last-child>td]:border-b-0"
          aria-busy={showSkeleton || undefined}
        >
          <caption className="sr-only">{caption}</caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sortKey = onSortChange ? header.column.columnDef.meta?.sortKey : undefined;
                  const active = sortKey !== undefined && sort?.key === sortKey ? sort.dir : null;
                  const label = header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext());
                  const SortIcon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowUpDown;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        active === "asc" ? "ascending" : active === "desc" ? "descending" : sortKey ? "none" : undefined
                      }
                      className={cn(
                        "sticky top-0 z-10 h-13 border-b border-line bg-surface px-5 text-xs font-bold tracking-wider whitespace-nowrap text-muted uppercase",
                        header.column.columnDef.meta?.headerClassName,
                      )}
                    >
                      {sortKey ? (
                        <button
                          type="button"
                          onClick={() => onSortChange?.(nextSort(sort, sortKey))}
                          className={cn(
                            "group/sort -mx-1.5 inline-flex items-center gap-1.5 rounded px-1.5 py-1 font-bold tracking-wider uppercase transition-colors hover:bg-slate-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary",
                            active && "text-primary",
                          )}
                        >
                          {label}
                          <SortIcon
                            className={cn(
                              "size-3.5 shrink-0",
                              active ? "text-primary" : "text-slate-300 group-hover/sort:text-muted",
                            )}
                            aria-hidden
                          />
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {showSkeleton &&
              Array.from({ length: skeletonRows }, (_, r) => (
                <tr key={`skeleton-${r}`}>
                  {leafColumns.map((column, c) => (
                    <td key={column.id} className="h-15 border-b border-line px-5">
                      <Skeleton className={cn("h-3", SKELETON_WIDTHS[(r + c) % SKELETON_WIDTHS.length])} />
                    </td>
                  ))}
                </tr>
              ))}
            {rows.map((row) => (
              <tr
                key={row.id}
                className={cn("group transition-colors hover:bg-slate-50/70", rowClassName?.(row.original))}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn(
                      "h-15 border-b border-line px-5 align-middle whitespace-nowrap text-ink",
                      cell.column.columnDef.meta?.cellClassName,
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {showSkeleton && (
          <span className="sr-only" role="status">
            Loading…
          </span>
        )}
      </div>
      {showError && (
        <div className="flex flex-1 items-center justify-center">
          <ErrorState error={error} onRetry={onRetry} retrying={isFetching} />
        </div>
      )}
      {showEmpty && <div className="flex flex-1 items-center justify-center">{emptyState}</div>}
      {footer && !showError && <div className="shrink-0 border-t">{footer}</div>}
    </div>
  );
}
