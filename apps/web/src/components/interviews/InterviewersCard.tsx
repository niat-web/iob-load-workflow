import { Lock, UserPlus, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { errorMessage } from "../../api/client";
import { useSaveInterviewers } from "../../api/interviews";
import { cn } from "../../utils/cn";
import { useToast } from "../toast-context";
import { Button } from "../ui/Button";
import { cardClass, fieldClass } from "../ui/styles";
import { parseEmails } from "./MeetDialog";

export function InterviewersCard({ jobId, companyName, emails }: { jobId: string; companyName: string; emails: string[] }) {
  const id = useId();
  const toast = useToast();
  const save = useSaveInterviewers(jobId);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const persist = (next: string[], success: string) =>
    save.mutate(next, {
      onSuccess: () => toast.success(success),
      onError: (err) => toast.error(errorMessage(err, "The interviewer emails could not be saved.")),
    });

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseEmails(draft);
    if (!parsed.emails.length) return;
    if (parsed.invalid.length) {
      setError(`Not valid: ${parsed.invalid.join(", ")}`);
      return;
    }
    setError(null);
    setDraft("");
    persist([...new Set([...emails, ...parsed.emails])], "Interviewer emails saved");
  };

  return (
    <section aria-labelledby={`${id}-title`} className={cn(cardClass, "px-5 py-4")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={`${id}-title`} className="text-sm font-bold text-ink">
          Company interviewer emails
        </h2>
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <Lock className="size-3" aria-hidden />
          Saved for {companyName}. Only visible here, never on the shared profiles page.
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {emails.map((email) => (
          <span key={email} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pr-1 pl-3 text-sm text-ink">
            {email}
            <button
              type="button"
              onClick={() => persist(emails.filter((item) => item !== email), "Interviewer removed")}
              disabled={save.isPending}
              className="focus-ring rounded-full p-0.5 text-muted hover:text-red-600"
              aria-label={`Remove ${email}`}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ))}
        {emails.length === 0 && <span className="text-sm text-muted">No interviewer emails yet.</span>}
      </div>
      <form onSubmit={add} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          aria-label="Add interviewer emails"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="name@company.com, other@company.com"
          className={cn(fieldClass, "w-full sm:w-96")}
        />
        <Button type="submit" variant="secondary" loading={save.isPending} disabled={!draft.trim()} icon={<UserPlus className="size-4" aria-hidden />}>
          Add
        </Button>
        {error && (
          <p role="alert" className="text-sm font-medium text-red-600">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
