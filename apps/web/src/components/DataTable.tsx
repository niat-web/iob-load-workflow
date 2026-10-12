import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { SheetLayout } from "../hooks/useSheetLayout";
import { cn } from "../utils/cn";
import { ErrorState } from "./ErrorState";
import { Skeleton } from "./LoadingSkeleton";
import { ColumnResizeHandle, RowResizeHandle } from "./sheet/SheetControls";
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
  onRowClick?: (row: T) => void;
  sort?: TableSort | null;
  onSortChange?: (sort: TableSort | null) => void;
  sheet?: SheetLayout;
}

const INTERACTIVE = "button, a, input, select, textarea, label, [role='menuitem'], [role='checkbox'], [role='switch']";

function rowClickTarget(event: MouseEvent<HTMLTableRowElement>) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !event.currentTarget.contains(target) || target.closest(INTERACTIVE)) return false;
  return !window.getSelection()?.toString();
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

interface Measured {
  widths: Record<string, number>;
  heights: Record<string, number>;
  header: number;
}

const sameNumbers = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

const FROZEN_EDGE = "shadow-[inset_-1px_0_0_var(--color-line),6px_0_8px_-6px_rgb(15_23_42/0.18)]";
const FROZEN_ROW_EDGE = "border-b-2 border-b-slate-300";
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
  onRowClick,
  sort,
  onSortChange,
  sheet,
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
  const leafColumns = table.getVisibleLeafColumns();

  const headRefs = useRef(new Map<string, HTMLTableCellElement>());
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const headerRowRef = useRef<HTMLTableRowElement>(null);
  const [measured, setMeasured] = useState<Measured>({ widths: {}, heights: {}, header: 0 });
  useLayoutEffect(() => {
    if (!sheet) return;
    const widths: Record<string, number> = {};
    headRefs.current.forEach((element, id) => {
      widths[id] = element.offsetWidth;
    });
    const heights: Record<string, number> = {};
    rowRefs.current.forEach((element, id) => {
      heights[id] = element.offsetHeight;
    });
    const header = headerRowRef.current?.offsetHeight ?? 0;
    setMeasured((current) =>
      current.header === header && sameNumbers(current.widths, widths) && sameNumbers(current.heights, heights)
        ? current
        : { widths, heights, header },
    );
  });

  const frozenColumns = sheet ? Math.min(sheet.freezeColumns, leafColumns.length) : 0;
  const frozenRows = sheet ? Math.min(sheet.freezeRows, rows.length) : 0;
  const widthOf = (id: string) => sheet?.widths[id] ?? measured.widths[id] ?? 0;
  const leftOf = (index: number) => leafColumns.slice(0, index).reduce((sum, column) => sum + widthOf(column.id), 0);
  const topOf = (index: number) =>
    measured.header + rows.slice(0, index).reduce((sum, row) => sum + (measured.heights[row.id] ?? 0), 0);
  const sizeStyle = (id: string): CSSProperties => {
    const width = sheet?.widths[id];
    return width ? { width, minWidth: width, maxWidth: width } : {};
  };

  return (
    <div className={cn(cardClass, "relative flex min-h-[320px] flex-1 shrink-0 flex-col overflow-hidden")}>
      {isFetching && !showSkeleton && (
        <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden" aria-hidden>
          <div className="h-full w-1/3 animate-indeterminate bg-primary/60" />
        </div>
      )}
      {/* The empty and error states live inside the scroll region so the horizontal scrollbar
          always sits at the bottom of the table, never directly under the header row. */}
      <div className={cn("flex flex-1 flex-col", sheet ? "max-h-[calc(100dvh-12rem)] overflow-auto" : "overflow-x-auto overflow-y-hidden")}>
        <table
          className="w-full min-w-max shrink-0 border-separate border-spacing-0 text-left text-sm [&>tbody>tr:last-child>td]:border-b-0"
          aria-busy={showSkeleton || undefined}
        >
          <caption className="sr-only">{caption}</caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} ref={headerRowRef}>
                {group.headers.map((header, columnIndex) => {
                  const sortKey = onSortChange ? header.column.columnDef.meta?.sortKey : undefined;
                  const active = sortKey !== undefined && sort?.key === sortKey ? sort.dir : null;
                  const label = header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext());
                  const SortIcon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowUpDown;
                  return (
                    <th
                      key={header.id}
                      ref={(element) => {
                        if (element) headRefs.current.set(header.column.id, element);
                        else headRefs.current.delete(header.column.id);
                      }}
                      style={{
                        ...sizeStyle(header.column.id),
                        ...(columnIndex < frozenColumns ? { left: leftOf(columnIndex) } : {}),
                      }}
                      scope="col"
                      aria-sort={
                        active === "asc" ? "ascending" : active === "desc" ? "descending" : sortKey ? "none" : undefined
                      }
                      className={cn(
                        "h-13 border-b border-line bg-surface px-5 text-xs font-bold tracking-wider whitespace-nowrap text-muted uppercase",
                        header.column.columnDef.meta?.headerClassName,
                        sheet && "sticky top-0 z-20 overflow-hidden text-ellipsis",
                        columnIndex < frozenColumns && "z-30",
                        columnIndex === frozenColumns - 1 && FROZEN_EDGE,
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
                      {sheet && !header.isPlaceholder && (
                        <ColumnResizeHandle
                          label={typeof header.column.columnDef.header === "string" ? header.column.columnDef.header : header.column.id}
                          width={() => widthOf(header.column.id)}
                          onResize={(width) => sheet.setWidth(header.column.id, width)}
                        />
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
            {rows.map((row, rowIndex) => (
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- keyboard users open the same page from the link inside the row.
              <tr
                key={row.id}
                ref={(element) => {
                  if (element) rowRefs.current.set(row.id, element);
                  else rowRefs.current.delete(row.id);
                }}
                onClick={
                  onRowClick
                    ? (event) => {
                        if (rowClickTarget(event)) onRowClick(row.original);
                      }
                    : undefined
                }
                className={cn(
                  "group transition-colors hover:bg-slate-50/70",
                  onRowClick && "cursor-pointer",
                  rowClassName?.(row.original),
                )}
              >
                {row.getVisibleCells().map((cell, columnIndex) => {
                  const frozenColumn = columnIndex < frozenColumns;
                  const frozenRow = rowIndex < frozenRows;
                  const height = sheet?.heights[row.id];
                  return (
                    <td
                      key={cell.id}
                      style={{
                        ...sizeStyle(cell.column.id),
                        ...(height ? { height } : {}),
                        ...(frozenColumn ? { left: leftOf(columnIndex) } : {}),
                        ...(frozenRow ? { top: topOf(rowIndex) } : {}),
                      }}
                      className={cn(
                        "h-15 border-b border-line px-5 align-middle whitespace-nowrap text-ink",
                        cell.column.columnDef.meta?.cellClassName,
                        sheet && "overflow-hidden text-ellipsis",
                        (frozenColumn || frozenRow) && "sticky bg-surface group-hover:bg-slate-50",
                        frozenColumn && frozenRow ? "z-[15]" : (frozenColumn || frozenRow) && "z-10",
                        sheet && columnIndex === 0 && !frozenColumn && !frozenRow && "relative",
                        columnIndex === frozenColumns - 1 && FROZEN_EDGE,
                        rowIndex === frozenRows - 1 && FROZEN_ROW_EDGE,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      {sheet && columnIndex === 0 && (
                        <RowResizeHandle
                          label={`row ${rowIndex + 1}`}
                          height={() => measured.heights[row.id] ?? 60}
                          onResize={(next) => sheet.setHeight(row.id, next)}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {showSkeleton && (
          <span className="sr-only" role="status">
            Loading…
          </span>
        )}
        {/* sticky left-0 keeps the message centred in the visible area while the header scrolls sideways. */}
        {showError && (
          <div className="sticky left-0 flex flex-1 items-center justify-center">
            <ErrorState error={error} onRetry={onRetry} retrying={isFetching} />
          </div>
        )}
        {showEmpty && <div className="sticky left-0 flex flex-1 items-center justify-center">{emptyState}</div>}
      </div>
      {footer && !showError && <div className="shrink-0 border-t">{footer}</div>}
    </div>
  );
}
