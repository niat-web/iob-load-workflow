import { cn } from "../utils/cn";

interface ProgressBarProps {
  value: number;
  label?: string;
  className?: string;
}

export function ProgressBar({ value, label = "Progress", className }: ProgressBarProps) {
  const pct = Math.round(Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0)));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", pct >= 100 ? "bg-emerald-500" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-9 text-xs text-muted tabular-nums">{pct}%</span>
    </div>
  );
}
