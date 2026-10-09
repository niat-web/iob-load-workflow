import { BellRing, Bot, Clock3, Mail, PhoneCall, Save, UsersRound, Video, Workflow } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { errorMessage } from "../../api/client";
import { useAppSettings, useSaveAppSettings } from "../../api/admin";
import type { AppSettings, AppSettingsRecord, ApprovalGate, FlowMode } from "../../types/api";
import { cn } from "../../utils/cn";
import { formatDateTime } from "../../utils/format";
import { ErrorState } from "../ErrorState";
import { LoadingSkeleton } from "../LoadingSkeleton";
import { useToast } from "../toast-context";
import { Button } from "../ui/Button";
import { SwitchRow } from "../ui/Switch";
import { cardClass, fieldClass } from "../ui/styles";

type TimingKey = keyof AppSettings["timing"];
type TimingText = Record<TimingKey, string>;
type SwitchGroup = "studentEmails" | "checkpoints" | "crmEmails" | "aiCalls" | "interviews" | "automation";

interface SwitchSpec {
  key: string;
  label: string;
  description: string;
}

interface TimingSpec {
  key: TimingKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
}

const FLOW_MODES: { value: FlowMode; label: string; description: string }[] = [
  { value: "AUTOMATIC", label: "Automatic", description: "Every step runs by itself." },
  {
    value: "STEP_BY_STEP",
    label: "Step by step",
    description: "The deal stops at the steps below until a CRM or admin approves.",
  },
];

const flowLabel = (mode: FlowMode) => FLOW_MODES.find((option) => option.value === mode)?.label ?? mode;

const APPROVAL_STEPS: { gate: ApprovalGate; label: string; description: string }[] = [
  { gate: "DEAL_DETAILS", label: "Deal details", description: "Check the deal fetched from HubSpot before the job is prepared." },
  { gate: "LOAD_BETA", label: "Load into Beta", description: "Check the job text and course plans before the job goes to Beta." },
  { gate: "LOAD_PROD", label: "Load into Prod", description: "Check the Beta job before it goes to Prod." },
  {
    gate: "ELIGIBLE_STUDENTS",
    label: "Give students access",
    description: "Check the eligible students before they get access in Prod.",
  },
  {
    gate: "START_WINDOW",
    label: "Start application window",
    description: "Check everything before the application window starts.",
  },
];

const STUDENT_EMAILS: SwitchSpec[] = [
  {
    key: "jobUpdates",
    label: "Job update emails",
    description: "Sent when a student-facing detail of the deal changes in HubSpot during the window.",
  },
  {
    key: "boostReminder",
    label: "Reminder emails from the Boost page",
    description: "Lets the CRM email the NIAT students who have not applied. Academy students are not reminded.",
  },
];

const CRM_EMAILS: SwitchSpec[] = [
  {
    key: "poolReached",
    label: "Expected pool reached",
    description: "Emails the CRM when applications reach the expected pool.",
  },
  {
    key: "candidatePool",
    label: "Candidate pool ready",
    description: "Emails the CRM the public candidate pool link after the PSM review. When off, the deal completes without it.",
  },
];

const CHECKPOINTS: SwitchSpec[] = [
  {
    key: "firstEmails",
    label: "First checkpoint: reminder emails",
    description: "Emails the NIAT students who have not applied. Academy students and the CRM get nothing.",
  },
  {
    key: "secondEmails",
    label: "Second checkpoint: reminder emails",
    description: "A final reminder to the NIAT students who still have not applied.",
  },
  {
    key: "secondCalls",
    label: "Second checkpoint: AI calls",
    description: "Starts NxtDial AI calls to the NIAT students who still have not applied and have a mobile number.",
  },
];

const AI_CALLS: SwitchSpec[] = [
  {
    key: "enabled",
    label: "AI calls from the Boost page",
    description: "Lets the CRM start NxtDial AI calls to the NIAT students who have not applied. Call length and voice are set on the agent in NxtDial.",
  },
];

const INTERVIEWS: SwitchSpec[] = [
  {
    key: "googleMeet",
    label: "Google Meet from the Interviews page",
    description: "Lets the CRM create a Google Meet for a shortlisted student, with auto-recording on and invites sent to the CRM, the student and the company interviewers.",
  },
];

const AUTOMATION: SwitchSpec[] = [
  {
    key: "aiJobContent",
    label: "AI-written job text",
    description: "Gemini writes the job description, eligibility and disclaimer. When off, the rule-based text is used.",
  },
  {
    key: "aiResumeAnalysis",
    label: "AI resume analysis",
    description: "Gemini scores each applicant's resume. When off, candidates are ranked without a resume score.",
  },
  {
    key: "hubspotWriteBack",
    label: "Write the job ID to HubSpot",
    description: "Saves the Learning Portal job ID, JD count and the owners on the HubSpot deal.",
  },
];

const TIMING: TimingSpec[] = [
  { key: "applicationWindowHours", label: "Application window", unit: "hours", min: 1, max: 240, step: 0.5 },
  { key: "reminderOneHours", label: "First CRM checkpoint", unit: "hours after the window starts", min: 0.5, max: 240, step: 0.5 },
  { key: "reminderTwoHours", label: "Second CRM checkpoint", unit: "hours after the window starts", min: 0.5, max: 240, step: 0.5 },
  {
    key: "boostEmailCooldownMinutes",
    label: "Gap between reminder emails",
    unit: "minutes, on the Boost page",
    min: 0,
    max: 1440,
    step: 1,
    integer: true,
  },
];

function toText(timing: AppSettings["timing"]): TimingText {
  return Object.fromEntries(TIMING.map((spec) => [spec.key, String(timing[spec.key])])) as TimingText;
}

function parseTiming(text: TimingText) {
  const values = {} as AppSettings["timing"];
  const errors: Partial<Record<TimingKey, string>> = {};
  for (const spec of TIMING) {
    const raw = text[spec.key].trim();
    const value = Number(raw);
    values[spec.key] = value;
    if (!raw || !Number.isFinite(value)) errors[spec.key] = "Enter a number.";
    else if (value < spec.min || value > spec.max) errors[spec.key] = `Enter ${spec.min} to ${spec.max}.`;
    else if (spec.integer && !Number.isInteger(value)) errors[spec.key] = "Enter a whole number.";
  }
  if (!errors.reminderOneHours && !errors.reminderTwoHours && values.reminderOneHours >= values.reminderTwoHours) {
    errors.reminderTwoHours = "Must be after the first checkpoint.";
  }
  if (!errors.reminderTwoHours && !errors.applicationWindowHours && values.reminderTwoHours >= values.applicationWindowHours) {
    errors.reminderTwoHours = "Must be before the window closes.";
  }
  return { values, errors };
}

function shownFlows(flow: AppSettings["flow"]) {
  return FLOW_MODES.map((option) => option.value).filter((mode) => flow.crmOptions[mode]);
}

function ControlCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className={cn(cardClass, "flex flex-col p-5")}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
      </div>
      <div className="mt-2 divide-y divide-line">{children}</div>
    </section>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <p className="pt-4 pb-1 text-xs font-bold tracking-wider text-muted uppercase">{children}</p>;
}

function TimingRow({
  spec,
  value,
  error,
  onChange,
}: {
  spec: TimingSpec;
  value: string;
  error?: string;
  onChange: (next: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 py-3">
      <label htmlFor={id} className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{spec.label}</span>
        <span className="text-xs text-muted">{spec.unit}</span>
      </label>
      <div className="w-32">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(fieldClass, error && "border-red-400 focus:border-red-500 focus:ring-red-500/15")}
        />
        {error && (
          <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function ControlsForm({ record }: { record: AppSettingsRecord }) {
  const toast = useToast();
  const save = useSaveAppSettings();
  const flowId = useId();
  const [draft, setDraft] = useState<AppSettings>(record.settings);
  const [timing, setTiming] = useState<TimingText>(() => toText(record.settings.timing));
  const [formError, setFormError] = useState<string | null>(null);
  const parsed = parseTiming(timing);
  const hasErrors = Object.keys(parsed.errors).length > 0;
  const dirty = hasErrors || JSON.stringify({ ...draft, timing: parsed.values }) !== JSON.stringify(record.settings);
  const shown = shownFlows(draft.flow);
  const usedFlow = (shown.length === 1 ? shown[0] : undefined) ?? draft.flow.mode;
  const stepByStepUsed = shown.length ? shown.includes("STEP_BY_STEP") : draft.flow.mode === "STEP_BY_STEP";
  const noSteps = stepByStepUsed && !APPROVAL_STEPS.some((step) => draft.flow.approvals[step.gate]);

  const setGroup = <G extends keyof AppSettings>(group: G, patch: Partial<AppSettings[G]>) =>
    setDraft((current) => ({ ...current, [group]: { ...current[group], ...patch } }) as AppSettings);

  const switches = (group: SwitchGroup, specs: SwitchSpec[]) =>
    specs.map((spec) => (
      <SwitchRow
        key={spec.key}
        label={spec.label}
        description={spec.description}
        checked={(draft[group] as Record<string, boolean>)[spec.key] === true}
        onChange={(next) => setGroup(group, { [spec.key]: next } as Partial<AppSettings[typeof group]>)}
      />
    ));

  const discard = () => {
    setDraft(record.settings);
    setTiming(toText(record.settings.timing));
    setFormError(null);
    save.reset();
  };

  const submit = () => {
    if (hasErrors || noSteps) return;
    setFormError(null);
    save.mutate(
      { ...draft, timing: parsed.values },
      {
        onSuccess: (result) =>
          toast.success(
            result.released
              ? `Settings saved. ${result.released} waiting deal${result.released === 1 ? "" : "s"} continued.`
              : "Settings saved",
          ),
        onError: (err) => setFormError(errorMessage(err, "The settings could not be saved.")),
      },
    );
  };

  let defaultHint = "Selected first when CRMs submit a deal; they can switch to the other flow.";
  if (shown.length === 0) defaultHint = "CRMs do not see a flow choice, so every deal uses this flow.";

  return (
    <div className="flex flex-col gap-4">
      <ControlCard
        icon={<Workflow className="size-[18px]" aria-hidden />}
        title="Deal flow"
        description="Choose which flows CRMs can pick when they submit a deal, and where Step by step deals stop for approval."
      >
        <SubHeading>Flows CRMs can choose</SubHeading>
        {FLOW_MODES.map((mode) => (
          <SwitchRow
            key={mode.value}
            label={mode.label}
            description={mode.description}
            checked={draft.flow.crmOptions[mode.value]}
            onChange={(next) => setGroup("flow", { crmOptions: { ...draft.flow.crmOptions, [mode.value]: next } })}
          />
        ))}

        <SubHeading>Flow used when the CRM does not choose</SubHeading>
        {shown.length === 1 ? (
          <p className="py-3 text-sm text-ink">
            Every deal uses <span className="font-semibold">{flowLabel(usedFlow)}</span>, the only flow CRMs see.
          </p>
        ) : (
          <fieldset className="flex flex-col gap-2 py-3">
            <legend className="sr-only">Flow used when the CRM does not choose</legend>
            <div className="inline-flex w-fit rounded-[10px] border border-line bg-surface p-0.5">
              {FLOW_MODES.map((mode) => {
                const selected = mode.value === draft.flow.mode;
                return (
                  <label
                    key={mode.value}
                    className={cn(
                      "cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary",
                      selected ? "bg-brand text-white shadow-glow" : "text-ink hover:bg-slate-50",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${flowId}-default`}
                      value={mode.value}
                      checked={selected}
                      onChange={() => setGroup("flow", { mode: mode.value })}
                      className="sr-only"
                    />
                    {mode.label}
                  </label>
                );
              })}
            </div>
            <span className="text-xs text-muted">{defaultHint}</span>
          </fieldset>
        )}

        {stepByStepUsed && (
          <div>
            <SubHeading>Steps that need approval</SubHeading>
            {APPROVAL_STEPS.map((step) => (
              <SwitchRow
                key={step.gate}
                label={step.label}
                description={step.description}
                checked={draft.flow.approvals[step.gate]}
                onChange={(next) => setGroup("flow", { approvals: { ...draft.flow.approvals, [step.gate]: next } })}
              />
            ))}
            {noSteps && (
              <p role="alert" className="mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                Turn on at least one step, or stop using the Step by step flow.
              </p>
            )}
            <p className="py-3 text-xs text-muted">
              A deal waiting at a step that no longer needs approval continues on its own when you save.
            </p>
          </div>
        )}
      </ControlCard>

      <ControlCard
        icon={<Mail className="size-[18px]" aria-hidden />}
        title="Emails to students"
        description="When an email is off, nothing is sent and the deal carries on."
      >
        {switches("studentEmails", STUDENT_EMAILS)}
      </ControlCard>

      <ControlCard
        icon={<BellRing className="size-[18px]" aria-hidden />}
        title="Checkpoints"
        description="What happens at the first and second checkpoint for every deal. CRMs can also turn these off for one deal on its Reminders tab."
      >
        {switches("checkpoints", CHECKPOINTS)}
      </ControlCard>

      <ControlCard
        icon={<UsersRound className="size-[18px]" aria-hidden />}
        title="Emails to CRMs"
        description="Emails sent to the CRM who submitted the deal or owns it. The checkpoints never email the CRM."
      >
        {switches("crmEmails", CRM_EMAILS)}
      </ControlCard>

      <ControlCard
        icon={<PhoneCall className="size-[18px]" aria-hidden />}
        title="AI calls"
        description="Calls are only placed when a CRM starts them on the Boost page."
      >
        {switches("aiCalls", AI_CALLS)}
      </ControlCard>

      <ControlCard
        icon={<Video className="size-[18px]" aria-hidden />}
        title="Interviews"
        description="Meets are created from the Google account connected on the Interviews page. Recording starts when that account joins."
      >
        {switches("interviews", INTERVIEWS)}
      </ControlCard>

      <ControlCard
        icon={<Bot className="size-[18px]" aria-hidden />}
        title="Automation"
        description="AI steps and updates to other tools."
      >
        {switches("automation", AUTOMATION)}
      </ControlCard>

      <ControlCard
        icon={<Clock3 className="size-[18px]" aria-hidden />}
        title="Timing"
        description="Applies to deals whose application window starts after you save."
      >
        {TIMING.map((spec) => (
          <TimingRow
            key={spec.key}
            spec={spec}
            value={timing[spec.key]}
            error={parsed.errors[spec.key]}
            onChange={(next) => setTiming((current) => ({ ...current, [spec.key]: next }))}
          />
        ))}
      </ControlCard>

      {(dirty || formError) && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-surface p-3 shadow-card">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">You have unsaved changes</p>
            {formError && (
              <p role="alert" className="mt-0.5 text-xs text-red-600">
                {formError}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={discard} disabled={save.isPending}>
              Discard
            </Button>
            <Button
              onClick={submit}
              loading={save.isPending}
              disabled={hasErrors || noSteps}
              icon={<Save className="size-4" aria-hidden />}
            >
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminControls() {
  const query = useAppSettings();
  if (query.isPending) {
    return (
      <div className={cn(cardClass, "p-5")}>
        <LoadingSkeleton lines={6} label="Loading settings" />
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  const record = query.data;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        {record.updatedBy
          ? `Last changed by ${record.updatedBy} on ${formatDateTime(record.updatedAt)}`
          : "Using the default settings. Nothing has been changed yet."}
      </p>
      <ControlsForm key={record.updatedAt ?? "defaults"} record={record} />
    </div>
  );
}
