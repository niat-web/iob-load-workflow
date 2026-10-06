import { cn } from "../utils/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-slate-200/70", className)} aria-hidden />;
}

interface LoadingSkeletonProps {
  lines?: number;
  className?: string;
  label?: string;
}

export function LoadingSkeleton({ lines = 4, className, label = "Loading" }: LoadingSkeletonProps) {
  return (
    <div role="status" aria-label={label} className={cn("space-y-3", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i % 3 === 2 ? "w-2/5" : i % 2 === 0 ? "w-4/5" : "w-3/5")} />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function PageLoader() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-dvh items-center justify-center bg-canvas">
      <div className="size-6 animate-spin rounded-full border-2 border-primary/20 border-t-primary" aria-hidden />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
