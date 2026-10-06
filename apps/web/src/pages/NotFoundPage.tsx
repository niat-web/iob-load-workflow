import { FileQuestion } from "lucide-react";
import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState";
import { buttonClass } from "../components/ui/Button";
import { cardClass } from "../components/ui/styles";

export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <h1 className="sr-only">Page not found</h1>
      <div className={`${cardClass} w-full max-w-sm`}>
        <EmptyState
          icon={<FileQuestion className="size-5" aria-hidden />}
          message="This page does not exist."
          action={
            <Link to="/" className={buttonClass("secondary", "sm")}>
              Go to home
            </Link>
          }
        />
      </div>
    </main>
  );
}
