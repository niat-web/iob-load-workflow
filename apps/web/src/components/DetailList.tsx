import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export interface DetailItem {
  label: string;
  value: ReactNode;
  wide?: boolean;
}

export function DetailList({ items, className }: { items: DetailItem[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2", className)}>
      {items.map((item) => (
        <div key={item.label} className={cn("min-w-0", item.wide && "sm:col-span-full")}>
          <dt className="text-xs font-bold tracking-wider text-muted uppercase">{item.label}</dt>
          <dd className="mt-0.5 text-sm font-semibold break-words text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DetailSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("border-t pt-5 first:border-t-0 first:pt-0", className)}>
      <h3 className="mb-3 text-sm font-bold tracking-wider text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}
