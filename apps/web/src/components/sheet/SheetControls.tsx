import { Check, Snowflake } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { useDismiss } from "../../hooks/useDismiss";
import { cn } from "../../utils/cn";
import { Button } from "../ui/Button";

const KEY_STEP = 10;

function useDrag(axis: "x" | "y", current: () => number, onResize: (size: number | null) => void) {
  const start = useRef<{ position: number; size: number } | null>(null);
  const at = (event: PointerEvent) => (axis === "x" ? event.clientX : event.clientY);
  return {
    onPointerDown: (event: PointerEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = { position: at(event), size: current() };
    },
    onPointerMove: (event: PointerEvent<HTMLSpanElement>) => {
      if (!start.current) return;
      onResize(start.current.size + at(event) - start.current.position);
    },
    onPointerUp: (event: PointerEvent<HTMLSpanElement>) => {
      start.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onDoubleClick: () => onResize(null),
    onClick: (event: MouseEvent) => event.stopPropagation(),
    onKeyDown: (event: KeyboardEvent<HTMLSpanElement>) => {
      const grow = axis === "x" ? "ArrowRight" : "ArrowDown";
      const shrink = axis === "x" ? "ArrowLeft" : "ArrowUp";
      if (event.key === grow || event.key === shrink) {
        event.preventDefault();
        onResize(current() + (event.key === grow ? KEY_STEP : -KEY_STEP));
      } else if (event.key === "Enter") {
        onResize(null);
      }
    },
  };
}

export function ColumnResizeHandle({
  label,
  width,
  onResize,
}: {
  label: string;
  width: () => number;
  onResize: (width: number | null) => void;
}) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${label} column. Drag, or use the arrow keys; double-click or Enter resets it.`}
      tabIndex={0}
      {...useDrag("x", width, onResize)}
      className="absolute top-0 right-0 z-10 h-full w-2.5 translate-x-1/2 cursor-col-resize touch-none select-none after:absolute after:inset-y-1.5 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded after:bg-transparent hover:after:bg-primary focus-visible:outline-none focus-visible:after:bg-primary"
    />
  );
}

export function RowResizeHandle({
  label,
  height,
  onResize,
}: {
  label: string;
  height: () => number;
  onResize: (height: number | null) => void;
}) {
  return (
    <span
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Resize ${label}. Drag, or use the arrow keys; double-click or Enter resets it.`}
      tabIndex={0}
      {...useDrag("y", height, onResize)}
      className="absolute right-0 bottom-0 left-0 z-10 h-2.5 translate-y-1/2 cursor-row-resize touch-none select-none after:absolute after:inset-x-1 after:top-1/2 after:h-0.5 after:-translate-y-1/2 after:rounded after:bg-transparent hover:after:bg-primary focus-visible:outline-none focus-visible:after:bg-primary"
    />
  );
}

interface FreezeMenuProps {
  columnLabels: string[];
  freezeColumns: number;
  freezeRows: number;
  maxRows?: number;
  rowLabel?: (count: number) => string;
  onColumns: (count: number) => void;
  onRows: (count: number) => void;
}

function Choice({ checked, onSelect, children }: { checked: boolean; onSelect: () => void; children: string }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50",
        checked ? "font-semibold text-ink" : "text-slate-700",
      )}
    >
      <span aria-hidden className="flex size-4 shrink-0 items-center justify-center text-primary">
        {checked && <Check className="size-4" strokeWidth={3} />}
      </span>
      <span className="truncate">{children}</span>
    </button>
  );
}

export function FreezeMenu({
  columnLabels,
  freezeColumns,
  freezeRows,
  maxRows = 5,
  rowLabel = (count) => (count === 1 ? "1 row" : `${count} rows`),
  onColumns,
  onRows,
}: FreezeMenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [buttonRef, panelRef]);
  const columnChoices = columnLabels.slice(0, 5);
  const active = freezeColumns + freezeRows > 0;

  return (
    <div className="relative">
      <div ref={buttonRef}>
        <Button
          variant="secondary"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          icon={<Snowflake className={cn("size-4", active && "text-primary")} aria-hidden />}
        >
          Freeze
        </Button>
      </div>
      {open && (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label="Freeze rows and columns"
          className="absolute top-full right-0 z-40 mt-1.5 grid w-72 animate-pop-in grid-cols-2 gap-3 rounded-lg border bg-surface p-3 shadow-pop"
        >
          <div className="min-w-0">
            <p className="px-2 pb-1 text-xs font-bold tracking-wider text-muted uppercase">Columns</p>
            <Choice checked={freezeColumns === 0} onSelect={() => onColumns(0)}>
              No columns
            </Choice>
            {columnChoices.map((label, index) => (
              <Choice key={label} checked={freezeColumns === index + 1} onSelect={() => onColumns(index + 1)}>
                {`Up to ${label}`}
              </Choice>
            ))}
          </div>
          <div className="min-w-0">
            <p className="px-2 pb-1 text-xs font-bold tracking-wider text-muted uppercase">Rows</p>
            <Choice checked={freezeRows === 0} onSelect={() => onRows(0)}>
              No rows
            </Choice>
            {Array.from({ length: maxRows }, (_, index) => (
              <Choice key={index} checked={freezeRows === index + 1} onSelect={() => onRows(index + 1)}>
                {rowLabel(index + 1)}
              </Choice>
            ))}
          </div>
          <p className="col-span-2 border-t pt-2 text-xs text-muted">
            The header row always stays on top. Drag a column&apos;s right edge or a row&apos;s bottom edge to resize;
            double-click the edge to reset.
          </p>
        </div>
      )}
    </div>
  );
}
