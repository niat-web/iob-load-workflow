import { CircleCheck, Link2Off, Send } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";
import { errorMessage, hasStatus } from "../api/client";
import { useJobUpdateForm, useSubmitJobUpdate } from "../api/public";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { Button } from "../components/ui/Button";
import { cardClass, fieldClass } from "../components/ui/styles";
import type { InterestReason, JobUpdateForm } from "../types/api";
import { INTEREST_REASON_LABELS } from "../utils/candidate";
import { cn } from "../utils/cn";
import { formatDateTime } from "../utils/format";

const REASONS = Object.entries(INTEREST_REASON_LABELS) as [InterestReason, string][];

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 sm:py-12">{children}</main>
    </div>
  );
}

function Header({ form }: { form: JobUpdateForm }) {
  return (
    <header className={cn(cardClass, "flex flex-col gap-1 p-5 sm:p-6")}>
      <p className="text-xs font-bold tracking-wider text-primary uppercase">Job update</p>
      <h1 className="text-xl font-bold text-ink sm:text-2xl">
        {form.jobRole} at {form.companyName}
      </h1>
      <p className="text-sm text-muted">
        {form.studentName ? `Hi ${form.studentName.split(" ")[0]}, s` : "S"}ome details of this job changed on{" "}
        {formatDateTime(form.updatedAt)}.
      </p>
    </header>
  );
}

function Changes({ form }: { form: JobUpdateForm }) {
  return (
    <section className={cn(cardClass, "p-5 sm:p-6")} aria-labelledby="changes-title">
      <h2 id="changes-title" className="text-base font-semibold text-ink">
        What changed
      </h2>
      <dl className="mt-3 divide-y divide-line">
        {form.changes.map((change) => (
          <div key={change.label} className="grid gap-1 py-3 sm:grid-cols-[160px_1fr] sm:gap-4">
            <dt className="text-sm font-semibold text-muted">{change.label}</dt>
            <dd className="text-sm text-ink">
              <span className="text-muted line-through">{change.oldValue}</span>
              <span className="mx-2 text-muted" aria-hidden>
                →
              </span>
              <span className="sr-only">changed to </span>
              <strong>{change.newValue}</strong>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Saved({ form, onChange }: { form: JobUpdateForm; onChange: () => void }) {
  const response = form.response;
  if (!response) return null;
  return (
    <section role="status" className={cn(cardClass, "flex flex-col gap-3 p-5 sm:p-6")}>
      <p className="flex items-center gap-2 font-semibold text-emerald-700">
        <CircleCheck className="size-5" aria-hidden />
        Thanks, your answer is saved.
      </p>
      <p className="text-sm text-ink">
        {response.interested ? "You are still interested in this job." : "You are not interested in this job any more."}
        {!response.interested && response.reason ? ` Reason: ${INTEREST_REASON_LABELS[response.reason]}.` : ""}
      </p>
      {response.comments && <p className="text-sm text-muted">“{response.comments}”</p>}
      <div>
        <Button variant="secondary" onClick={onChange}>
          Change my answer
        </Button>
      </div>
    </section>
  );
}

function AnswerForm({ form, token, userId, jobId, onSaved }: { form: JobUpdateForm; token: string; userId: string; jobId: string; onSaved: () => void }) {
  const id = useId();
  const submit = useSubmitJobUpdate(token);
  const [interested, setInterested] = useState<boolean | null>(form.response?.interested ?? null);
  const [reason, setReason] = useState<InterestReason | null>(form.response?.reason ?? null);
  const [comments, setComments] = useState(form.response?.comments ?? "");
  const [error, setError] = useState<string | null>(null);

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (interested === null) {
      setError("Choose whether you are still interested.");
      return;
    }
    if (!interested && !reason) {
      setError("Choose the main reason.");
      return;
    }
    setError(null);
    submit.mutate(
      { userId, jobId: jobId || undefined, interested, reason: interested ? null : reason, comments: comments.trim() || undefined },
      {
        onSuccess: onSaved,
        onError: (err) => setError(errorMessage(err, "Your answer could not be saved. Please try again.")),
      },
    );
  };

  const option = (value: boolean, label: string, hint: string) => {
    const selected = interested === value;
    return (
      <label
        className={cn(
          "flex cursor-pointer flex-col gap-0.5 rounded-lg border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
          selected ? "border-primary bg-primary-soft" : "border-line bg-surface hover:border-slate-300",
        )}
      >
        <input
          type="radio"
          name={`${id}-interest`}
          checked={selected}
          onChange={() => setInterested(value)}
          className="sr-only"
        />
        <span className={cn("text-sm font-semibold", selected ? "text-primary" : "text-ink")}>{label}</span>
        <span className="text-xs text-muted">{hint}</span>
      </label>
    );
  };

  return (
    <form onSubmit={send} noValidate className={cn(cardClass, "flex flex-col gap-5 p-5 sm:p-6")}>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-base font-semibold text-ink">Are you still interested in this job?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {option(true, "Yes, still interested", "Keep my application.")}
          {option(false, "No, not interested", "Tell us why below.")}
        </div>
      </fieldset>

      {interested === false && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold text-ink">Main reason</legend>
          {REASONS.map(([value, label]) => (
            <label key={value} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
              <input
                type="radio"
                name={`${id}-reason`}
                checked={reason === value}
                onChange={() => setReason(value)}
                className="size-4 accent-[var(--color-primary)]"
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-comments`} className="text-sm font-semibold text-ink">
          Anything else for the placement team? <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id={`${id}-comments`}
          value={comments}
          onChange={(event) => setComments(event.target.value)}
          maxLength={1000}
          rows={3}
          className={cn(fieldClass, "h-auto py-2")}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" loading={submit.isPending} icon={<Send className="size-4" aria-hidden />}>
          Submit my answer
        </Button>
      </div>
    </form>
  );
}

export function JobUpdateFormPage() {
  const { token = "", jobId = "" } = useParams();
  const [params] = useSearchParams();
  const userId = params.get("user_id") ?? "";
  const form = useJobUpdateForm(token, userId, jobId);
  const [editing, setEditing] = useState(false);

  if (!token || !userId || hasStatus(form.error, 404, 400)) {
    return (
      <Shell>
        <div className={cardClass}>
          <EmptyState
            icon={<Link2Off className="size-5" aria-hidden />}
            message="This link is not valid"
            description="Open the link from your email exactly as it was sent."
          />
        </div>
      </Shell>
    );
  }
  if (form.isError) {
    return (
      <Shell>
        <div className={cardClass}>
          <ErrorState error={form.error} onRetry={() => void form.refetch()} retrying={form.isFetching} />
        </div>
      </Shell>
    );
  }
  if (form.isPending) {
    return (
      <Shell>
        <div className={cn(cardClass, "p-6")}>
          <LoadingSkeleton lines={6} label="Loading" />
        </div>
      </Shell>
    );
  }

  const data = form.data;
  const showForm = editing || !data.response;
  return (
    <Shell>
      <Header form={data} />
      <Changes form={data} />
      {showForm ? (
        <AnswerForm form={data} token={token} userId={userId} jobId={jobId} onSaved={() => setEditing(false)} />
      ) : (
        <Saved form={data} onChange={() => setEditing(true)} />
      )}
    </Shell>
  );
}
