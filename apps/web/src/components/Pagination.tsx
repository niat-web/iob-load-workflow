import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Pagination as PaginationInfo } from "../types/api";
import { cn } from "../utils/cn";
import { formatNumber } from "../utils/format";

type PageToken = number | "gap-start" | "gap-end";

function pageTokens(current: number, total: number): PageToken[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const tokens: PageToken[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) tokens.push("gap-start");
  for (let p = start; p <= end; p += 1) tokens.push(p);
  if (end < total - 1) tokens.push("gap-end");
  tokens.push(total);
  return tokens;
}

interface PaginationProps {
  pagination: PaginationInfo;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

const navButton =
  "focus-ring inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40";

export function Pagination({ pagination, onPageChange, disabled }: PaginationProps) {
  const { page, limit, total, totalPages } = pagination;
  const pages = Math.max(totalPages, 1);
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <p className="text-sm text-muted tabular-nums" aria-live="polite">
        {total === 0
          ? "0 results"
          : `Showing ${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`}
      </p>
      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <button
            type="button"
            className={cn(navButton, "text-muted hover:bg-slate-100 hover:text-ink")}
            onClick={() => onPageChange(page - 1)}
            disabled={disabled || page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          {pageTokens(page, pages).map((token) =>
            typeof token === "number" ? (
              <button
                key={token}
                type="button"
                onClick={() => onPageChange(token)}
                disabled={disabled}
                aria-current={token === page ? "page" : undefined}
                aria-label={`Page ${token}`}
                className={cn(
                  navButton,
                  token === page
                    ? "bg-primary-soft font-semibold text-primary"
                    : "text-ink hover:bg-slate-100",
                )}
              >
                {token}
              </button>
            ) : (
              <span key={token} className="px-1 text-sm text-muted" aria-hidden>
                …
              </span>
            ),
          )}
          <button
            type="button"
            className={cn(navButton, "text-muted hover:bg-slate-100 hover:text-ink")}
            onClick={() => onPageChange(page + 1)}
            disabled={disabled || page >= pages}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </nav>
      )}
    </div>
  );
}
