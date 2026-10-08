import { Info, Link2, LoaderCircle, Send } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { errorMessage } from "../api/client";
import { useCrmControls, useHubspotOwners, useProcessDeal, type ProcessDealInput } from "../api/crm";
import type { FlowMode, ProcessDealResponse } from "../types/api";
import { cn } from "../utils/cn";
import { formatNumber } from "../utils/format";
import { ConfirmDialog } from "./ConfirmDialog";
import { DetailList } from "./DetailList";
import { HubspotOwnerSelect } from "./HubspotOwnerSelect";
import { useToast } from "./toast-context";
import { Tooltip } from "./Tooltip";
import { toolbarFieldClass } from "./ui/styles";

interface DealIdSubmitCardProps {
  onSubmitted?: (result: ProcessDealResponse) => void;
}

const FLOW_LABELS: Record<FlowMode, string> = { AUTOMATIC: "Automatic", STEP_BY_STEP: "Step by step" };

type OwnerField = "crm" | "profiling" | "ise";
type FieldErrors = Partial<Record<"dealId" | "expectedPool" | "crm", string>>;

const invalidClass = "border-red-400 focus:border-red-500 focus:ring-red-500/15";

function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-ink">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function DealIdSubmitCard({ onSubmitted }: DealIdSubmitCardProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const ids = {
    pool: `${id}-pool`,
    crm: `${id}-crm`,
    profiling: `${id}-profiling`,
    ise: `${id}-ise`,
  };
  const [value, setValue] = useState("");
  const [expectedPool, setExpectedPool] = useState("");
  const [picks, setPicks] = useState<Partial<Record<OwnerField, string>>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<ProcessDealInput | null>(null);
  const [pickedFlow, setPickedFlow] = useState<FlowMode | null>(null);
  const toast = useToast();
  const mutation = useProcessDeal();
  const ownersQuery = useHubspotOwners();
  const controls = useCrmControls();
  const flow = controls.data?.flow;
  const flowOptions = flow?.options ?? [];
  const onlyFlow = flowOptions.length === 1 ? flowOptions[0] : undefined;
  const flowMode: FlowMode =
    pickedFlow && flowOptions.includes(pickedFlow) ? pickedFlow : (onlyFlow ?? flow?.defaultMode ?? "AUTOMATIC");
  const approvalSteps = (flow?.approvalSteps ?? []).map((step) => step.label).join(", ");
  const flowInfo = (
    <ul className="space-y-1.5">
      {flowOptions.map((mode) => (
        <li key={mode}>
          <span className="font-semibold">{FLOW_LABELS[mode]}:</span>{" "}
          {mode === "STEP_BY_STEP" ? `stops for approval at ${approvalSteps}.` : "every step runs by itself."}
        </li>
      ))}
    </ul>
  );
  const owners = ownersQuery.data?.owners ?? [];
  const defaultOwnerId = ownersQuery.data?.defaultOwnerId ?? "";
  const ownerValue = (field: OwnerField) => picks[field] ?? defaultOwnerId;
  const ownerPlaceholder = ownersQuery.isPending
    ? "Loading owners…"
    : ownersQuery.isError
      ? "Could not load owners"
      : "Select owner";

  const pickOwner = (field: OwnerField) => (next: string) => {
    setPicks((current) => ({ ...current, [field]: next }));
    if (field === "crm" && errors.crm) setErrors((current) => ({ ...current, crm: undefined }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dealId = value.trim();
    const pool = Number(expectedPool);
    const crmOwnerId = ownerValue("crm");
    const nextErrors: FieldErrors = {};
    if (!dealId) nextErrors.dealId = "Enter a HubSpot Deal ID.";
    if (!expectedPool.trim()) nextErrors.expectedPool = "Enter the expected pool.";
    else if (!Number.isInteger(pool) || pool < 1) nextErrors.expectedPool = "Enter a whole number of 1 or more.";
    if (!crmOwnerId) nextErrors.crm = "Choose the CRM owner.";
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length) return;

    mutation.reset();
    setPending({
      dealId,
      ...(flowOptions.length ? { flowMode } : {}),
      expectedPoolCount: pool,
      crmOwnerId,
      profilingPocId: ownerValue("profiling") || undefined,
      iseId: ownerValue("ise") || undefined,
    });
  };

  const ownerName = (ownerId?: string) =>
    ownerId ? (owners.find((owner) => owner.id === ownerId)?.name ?? ownerId) : "Not set";

  const confirmSubmit = () => {
    if (!pending) return;
    mutation.mutate(pending, {
      onSuccess: (result) => {
        setPending(null);
        setFormError(null);
        setValue("");
        setExpectedPool("");
        if (result.duplicate) toast.info("Deal already submitted");
        else
          toast.success(
            pending.flowMode === "STEP_BY_STEP" ? "Deal submitted. It will wait for approval at each step." : "Deal submitted",
          );
        onSubmitted?.(result);
      },
      onError: (err) => setFormError(errorMessage(err, "This Deal ID could not be submitted.")),
    });
  };

  return (
    <section
      aria-labelledby={titleId}
      className="relative overflow-hidden rounded-xl border border-lavender bg-surface shadow-card"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-56 left-[14%] size-[460px] rounded-full bg-[radial-gradient(circle,rgb(91_61_245/0.07),transparent_68%)]" />
        <div className="absolute -top-44 right-[6%] size-[380px] rounded-full bg-[radial-gradient(circle,rgb(147_197_253/0.13),transparent_68%)]" />
        <div className="absolute -right-28 -bottom-52 size-[480px] rounded-full bg-[radial-gradient(circle,rgb(96_71_255/0.09),transparent_68%)]" />
      </div>

      <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-0 lg:px-7 lg:py-6">
        <div className="lg:pr-8">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Link2 className="size-[22px]" strokeWidth={2} aria-hidden />
          </span>
          <h2 id={titleId} className="mt-4 text-[22px] leading-tight font-bold tracking-tight text-ink">
            Add a HubSpot Deal
          </h2>
          <p className="mt-1.5 text-sm text-muted">Enter a HubSpot Deal ID or paste the deal link to get started.</p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col justify-center gap-4 lg:border-l lg:border-line lg:pl-7"
        >
          <div>
            <label htmlFor={id} className="mb-2 block text-sm font-semibold text-ink">
              HubSpot Deal ID
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <div className="relative min-w-0">
              <Link2
                className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted/70"
                aria-hidden
              />
              <input
                id={id}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (errors.dealId) setErrors((current) => ({ ...current, dealId: undefined }));
                }}
                placeholder="Enter Deal ID or deal link"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={errors.dealId ? true : undefined}
                aria-describedby={errors.dealId ? `${id}-error` : undefined}
                className={cn(
                  "h-11 w-full rounded-[10px] border bg-surface pr-3.5 pl-11 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:ring-3",
                  errors.dealId
                    ? invalidClass
                    : "border-field hover:border-slate-300 focus:border-primary focus:ring-primary/15",
                )}
              />
            </div>
            {errors.dealId && (
              <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-red-600">
                {errors.dealId}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Field id={ids.pool} label="Expected Pool" required error={errors.expectedPool}>
              <input
                id={ids.pool}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={expectedPool}
                onChange={(e) => {
                  setExpectedPool(e.target.value);
                  if (errors.expectedPool)
                    setErrors((current) => ({
                      ...current,
                      expectedPool: undefined,
                    }));
                }}
                placeholder="e.g. 70"
                aria-invalid={errors.expectedPool ? true : undefined}
                aria-describedby={errors.expectedPool ? `${ids.pool}-error` : undefined}
                className={cn(toolbarFieldClass, errors.expectedPool && invalidClass)}
              />
            </Field>
            <Field id={ids.crm} label="CRM Owner" required error={errors.crm}>
              <HubspotOwnerSelect
                id={ids.crm}
                value={ownerValue("crm")}
                onChange={pickOwner("crm")}
                owners={owners}
                placeholder={ownerPlaceholder}
                invalid={Boolean(errors.crm)}
              />
            </Field>
            <Field id={ids.profiling} label="Profiling POC">
              <HubspotOwnerSelect
                id={ids.profiling}
                value={ownerValue("profiling")}
                onChange={pickOwner("profiling")}
                owners={owners}
                placeholder={ownersQuery.isPending ? ownerPlaceholder : "Not set"}
              />
            </Field>
            <Field id={ids.ise} label="ISE">
              <HubspotOwnerSelect
                id={ids.ise}
                value={ownerValue("ise")}
                onChange={pickOwner("ise")}
                owners={owners}
                placeholder={ownersQuery.isPending ? ownerPlaceholder : "Not set"}
              />
            </Field>
          </div>

          {formError && pending === null && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}

          <div
            className={cn(
              "flex flex-wrap items-center gap-3",
              flowOptions.length ? "justify-between" : "justify-end",
            )}
          >
            {flowOptions.length > 0 && (
              <fieldset className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2.5">
                <legend className="sr-only">Flow</legend>
                <span aria-hidden className="text-xs font-bold tracking-wider text-primary uppercase">
                  Flow
                </span>
                <div className="inline-flex rounded-[10px] border border-line bg-surface p-0.5">
                  {flowOptions.map((mode) => {
                    const selected = mode === flowMode;
                    return (
                      <label
                        key={mode}
                        className={cn(
                          "cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary",
                          selected ? "bg-brand text-white shadow-glow" : "text-ink hover:bg-slate-50",
                        )}
                      >
                        <input
                          type="radio"
                          name={`${id}-flow`}
                          value={mode}
                          checked={selected}
                          onChange={() => setPickedFlow(mode)}
                          className="sr-only"
                        />
                        {FLOW_LABELS[mode]}
                      </label>
                    );
                  })}
                </div>
                <Tooltip
                  content={flowInfo}
                  triggerLabel="What the flows do"
                  triggerClassName="inline-flex size-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-slate-100 hover:text-primary"
                >
                  <Info className="size-4" aria-hidden />
                </Tooltip>
              </fieldset>
            )}
            <button
              type="submit"
              disabled={mutation.isPending}
              aria-busy={mutation.isPending || undefined}
              className="focus-ring inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-[10px] bg-brand px-5 text-sm font-semibold text-white shadow-glow-lg transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:w-[124px]"
            >
              {mutation.isPending ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" strokeWidth={2.2} aria-hidden />
              )}
              Submit
            </button>
          </div>
        </form>
      </div>
      <ConfirmDialog
        open={pending !== null}
        title="Submit this deal?"
        confirmLabel="Confirm and submit"
        cancelLabel="Edit"
        pending={mutation.isPending}
        error={mutation.isError ? formError : null}
        onCancel={() => {
          setPending(null);
          setFormError(null);
          mutation.reset();
        }}
        onConfirm={confirmSubmit}
        message={
          pending && (
            <>
              <p>Please check the details before submitting.</p>
              <DetailList
                className="mt-4 rounded-lg bg-slate-50 p-4"
                items={[
                  {
                    label: "HubSpot Deal",
                    value: <span className="break-all">{pending.dealId}</span>,
                    wide: true,
                  },
                  {
                    label: "Expected Pool",
                    value: formatNumber(pending.expectedPoolCount ?? null),
                  },
                  {
                    label: "JD Count",
                    value: "Set when the deal is fetched: earlier deals for this company + 1",
                    wide: true,
                  },
                  { label: "CRM Owner", value: ownerName(pending.crmOwnerId) },
                  {
                    label: "Profiling POC",
                    value: ownerName(pending.profilingPocId),
                  },
                  { label: "ISE", value: ownerName(pending.iseId) },
                  ...(pending.flowMode ? [{ label: "Flow", value: FLOW_LABELS[pending.flowMode] }] : []),
                ]}
              />
            </>
          )
        }
      />
    </section>
  );
}
