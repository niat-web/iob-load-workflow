import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import { Skeleton } from "./LoadingSkeleton";
import { cardClass } from "./ui/styles";

export interface SummaryItem {
  label: string;
  value: ReactNode;
}

export function SummaryStrip({ items, className }: { items: SummaryItem[]; className?: string }) {
  return (
    <dl className={cn(cardClass, "flex flex-wrap items-start gap-x-10 gap-y-3 px-5 py-3.5", className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-bold tracking-wider text-muted uppercase">{item.label}</dt>
          <dd className="mt-0.5 max-w-[280px] truncate text-sm font-bold text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SummaryStripSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading summary" className={cn(cardClass, "flex flex-wrap gap-x-10 gap-y-3 px-5 py-3.5")}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ))}
    </div>
  );
}
