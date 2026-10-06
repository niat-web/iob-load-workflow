import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";

interface EmptyStateProps {
  message: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ message, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <div className="relative mb-3.5">
        <span aria-hidden className="absolute -top-3.5 left-1/2 flex -translate-x-1/2 items-end gap-2">
          <span className="block h-2 w-0.5 -rotate-45 rounded-full bg-primary/70" />
          <span className="block h-3 w-0.5 rounded-full bg-primary/70" />
          <span className="block h-2 w-0.5 rotate-45 rounded-full bg-primary/70" />
        </span>
        <div className="flex size-14 items-center justify-center rounded-full bg-slate-100/80 text-slate-400 [&>svg]:size-7">
          {icon ?? <Inbox strokeWidth={1.6} aria-hidden />}
        </div>
      </div>
      <p className="text-[15px] font-semibold text-ink">{message}</p>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
