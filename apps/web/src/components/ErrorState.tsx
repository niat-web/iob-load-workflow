import { RotateCcw, TriangleAlert } from "lucide-react";
import { errorMessage } from "../api/client";
import { cn } from "../utils/cn";
import { Button } from "./ui/Button";

interface ErrorStateProps {
  error?: unknown;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

export function ErrorState({ error, message, onRetry, retrying, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-red-50 text-red-500">
        <TriangleAlert className="size-5" aria-hidden />
      </div>
      <p className="max-w-md text-sm text-muted">
        {message ?? errorMessage(error, "Something went wrong while loading this data.")}
      </p>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          loading={retrying}
          icon={<RotateCcw className="size-3.5" aria-hidden />}
        >
          Retry
        </Button>
      )}
    </div>
  );
}
