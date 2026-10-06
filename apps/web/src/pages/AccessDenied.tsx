import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";

interface AccessDeniedProps {
  message?: string;
  action?: ReactNode;
  className?: string;
}

export function AccessDenied({
  message = "Your account does not have access to this page.",
  action,
  className,
}: AccessDeniedProps) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-3 px-6 py-16 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-red-50 text-red-500">
        <ShieldAlert className="size-5" aria-hidden />
      </div>
      <h2 className="text-lg font-bold text-ink">Access Denied</h2>
      <p className="max-w-md text-sm text-muted">{message}</p>
      {action}
    </div>
  );
}
