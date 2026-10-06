import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "../components/ui/Button";
import { cardClass } from "../components/ui/styles";

export function RouteErrorPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <h1 className="sr-only">Unexpected error</h1>
      <div role="alert" className={`${cardClass} flex w-full max-w-sm flex-col items-center gap-3 px-6 py-12 text-center`}>
        <div className="flex size-10 items-center justify-center rounded-full bg-red-50 text-red-500">
          <TriangleAlert className="size-5" aria-hidden />
        </div>
        <p className="text-sm text-muted">Something went wrong. Please reload the page.</p>
        <Button
          variant="secondary"
          size="sm"
          icon={<RotateCcw className="size-3.5" aria-hidden />}
          onClick={() => window.location.reload()}
        >
          Reload
        </Button>
      </div>
    </main>
  );
}
