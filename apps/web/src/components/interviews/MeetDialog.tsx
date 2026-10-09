import { CalendarClock, Video } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalBehavior } from "../../hooks/useModalBehavior";
import type { InterviewRow, InterviewSheet, MeetRequest } from "../../types/api";
import { cn } from "../../utils/cn";
import { Button } from "../ui/Button";
import { fieldClass } from "../ui/styles";

const DURATIONS = [15, 30, 45, 60, 90, 120];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const textAreaClass = cn(fieldClass, "h-auto min-h-[72px] resize-y py-2");

const pad = (value: number) => String(value).padStart(2, "0");

function toLocalInput(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultStart(row: InterviewRow) {
  if (row.meet?.startAt) return toLocalInput(new Date(row.meet.startAt));
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(11, 0, 0, 0);
  return toLocalInput(next);
}

export function parseEmails(text: string) {
  const items = text
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return { emails: [...new Set(items)], invalid: items.filter((item) => !EMAIL.test(item)) };
}

function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

interface MeetDialogProps {
  sheet: InterviewSheet;
  row: InterviewRow;
  crmEmail: string;
  pending: boolean;
  error: string | null;
  onSubmit: (body: MeetRequest) => void;
  onClose: () => void;
}

export function MeetDialog({ sheet, row, crmEmail, pending, error, onSubmit, onClose }: MeetDialogProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const meet = row.meet;
  const studentName = row.studentName || row.values.fullName || "";
  const [eventName, setEventName] = useState(
    meet?.eventName || `${sheet.companyName} interview${studentName ? ` – ${studentName}` : ""}`,
  );
  const [startAt, setStartAt] = useState(() => defaultStart(row));
  const [duration, setDuration] = useState(meet?.durationMinutes ?? 30);
  const [studentEmail, setStudentEmail] = useState(row.values.studentEmail || meet?.studentEmail || "");
  const [interviewers, setInterviewers] = useState((meet?.interviewerEmails.length ? meet.interviewerEmails : sheet.interviewerEmails).join(", "));
  const [others, setOthers] = useState((meet?.otherEmails ?? []).join(", "));
  const [description, setDescription] = useState(
    meet?.description ?? `Interview for the ${sheet.jobRole || "open"} role at ${sheet.companyName}${studentName ? ` with ${studentName}` : ""}.`,
  );
  const [saveInterviewers, setSaveInterviewers] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  const organizer = sheet.organizerEmail ?? meet?.organizerEmail ?? crmEmail;
  const close = () => {
    if (!pending) onClose();
  };
  useModalBehavior(true, panelRef, close);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const student = studentEmail.trim().toLowerCase();
    const panel = parseEmails(interviewers);
    const extra = parseEmails(others);
    const start = new Date(startAt);
    const invalid = [...panel.invalid, ...extra.invalid];
    let problem: string | null = null;
    if (!eventName.trim()) problem = "Enter an event name.";
    else if (Number.isNaN(start.getTime())) problem = "Pick a date and time.";
    else if (!EMAIL.test(student)) problem = "Enter the student's email address.";
    else if (invalid.length) problem = `These are not valid email addresses: ${invalid.join(", ")}`;
    setFormError(problem);
    if (problem) return;
    onSubmit({
      eventName: eventName.trim(),
      description: description.trim(),
      startAt: start.toISOString(),
      durationMinutes: duration,
      timeZone,
      studentEmail: student,
      interviewerEmails: panel.emails,
      otherEmails: extra.emails,
      saveInterviewers,
    });
  };

  const message = formError ?? error;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/30" aria-hidden onMouseDown={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg animate-pop-in flex-col rounded-xl border bg-surface shadow-pop outline-none"
      >
        <div className="flex items-start gap-3 border-b border-line px-6 py-4">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Video className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-lg font-bold text-ink">
              {meet ? "Update Google Meet" : "Create Google Meet"}
            </h2>
            <p className="text-sm text-muted">
              {sheet.companyName}
              {studentName ? ` · ${studentName}` : ""}
            </p>
          </div>
        </div>

        <form id={`${id}-form`} onSubmit={submit} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <Field label="Event name" htmlFor={`${id}-name`}>
            <input id={`${id}-name`} value={eventName} maxLength={200} onChange={(e) => setEventName(e.target.value)} className={fieldClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <Field label="Date and time" htmlFor={`${id}-start`} hint={`Time zone: ${timeZone}`}>
              <input
                id={`${id}-start`}
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className={fieldClass}
              />
            </Field>
            <Field label="Length" htmlFor={`${id}-duration`}>
              <select id={`${id}-duration`} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={fieldClass}>
                {[...new Set([...DURATIONS, duration])].toSorted((a, b) => a - b).map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} min
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="Organizer (Google account)"
            htmlFor={`${id}-organizer`}
            hint="Invites come from this account. Recording starts automatically when this account, or a teammate allowed to record, joins."
          >
            <input id={`${id}-organizer`} value={organizer} readOnly className={cn(fieldClass, "bg-slate-50 text-muted")} />
          </Field>
          {organizer !== crmEmail && (
            <Field label="CRM (you)" htmlFor={`${id}-crm`} hint="Added as a guest and gets the invite.">
              <input id={`${id}-crm`} value={crmEmail} readOnly className={cn(fieldClass, "bg-slate-50 text-muted")} />
            </Field>
          )}
          <Field label="Student email" htmlFor={`${id}-student`}>
            <input
              id={`${id}-student`}
              type="email"
              value={studentEmail}
              onChange={(e) => setStudentEmail(e.target.value)}
              placeholder="student@example.com"
              className={fieldClass}
            />
          </Field>
          <Field label="Company interviewer emails" htmlFor={`${id}-panel`} hint="Separate with commas. Never shown on the company's shared profiles page.">
            <textarea id={`${id}-panel`} value={interviewers} onChange={(e) => setInterviewers(e.target.value)} className={textAreaClass} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={saveInterviewers} onChange={(e) => setSaveInterviewers(e.target.checked)} className="size-4 accent-primary" />
            Save these interviewer emails for {sheet.companyName}
          </label>
          <Field label="Other guests (optional)" htmlFor={`${id}-others`}>
            <textarea id={`${id}-others`} value={others} onChange={(e) => setOthers(e.target.value)} className={textAreaClass} />
          </Field>
          <Field label="Description" htmlFor={`${id}-description`}>
            <textarea
              id={`${id}-description`}
              value={description}
              maxLength={4000}
              onChange={(e) => setDescription(e.target.value)}
              className={textAreaClass}
            />
          </Field>
          <p className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-muted">
            <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
            {meet
              ? "Google Calendar sends the new time to every guest. The Meet link stays the same."
              : "Google Calendar sends the invite to every guest. Auto-recording is turned on for this Meet."}
          </p>
        </form>

        <div className="border-t border-line px-6 py-4">
          {message && (
            <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={`${id}-form`} loading={pending} icon={<Video className="size-4" aria-hidden />}>
              {meet ? "Update Meet" : "Create Meet"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
