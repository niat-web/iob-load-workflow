import { Save, UserPlus, X } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { errorMessage, isApiError } from "../../api/client";
import { useCreatePoolStudent, useUpdatePoolStudent } from "../../api/admin";
import { useModalBehavior } from "../../hooks/useModalBehavior";
import {
  EDITABLE_PRODUCTS,
  ELIGIBILITY_STATUSES,
  type EligiblePoolStudent,
  type PoolStudentInput,
} from "../../types/api";
import { productTone, statusTone } from "../../utils/poolTones";
import { BadgeSelect } from "../BadgeSelect";
import { useToast } from "../toast-context";
import { Button, IconButton } from "../ui/Button";
import { toolbarFieldClass } from "../ui/styles";

const FIELDS = [
  "studentId",
  "niatId",
  "studentName",
  "mobile",
  "email",
  "productGroup",
  "campus",
  "batch",
  "eligibilityStatus",
  "remarks",
] as const;

type FieldName = (typeof FIELDS)[number];
type FormValues = Record<FieldName, string>;

function initialValues(student: EligiblePoolStudent | null): FormValues {
  const values = {} as FormValues;
  for (const field of FIELDS) {
    const value = student?.[field];
    values[field] = value === null || value === undefined ? "" : String(value);
  }
  return values;
}

function toPayload(values: FormValues): PoolStudentInput {
  const payload: Record<string, string> = {};
  for (const field of FIELDS) payload[field] = values[field].trim();
  return payload as PoolStudentInput;
}

function problemText(error: unknown): string {
  if (isApiError(error) && Array.isArray(error.details) && error.details.length) {
    return (error.details as { message?: string }[])
      .map((detail) => detail.message)
      .filter(Boolean)
      .join(" · ");
  }
  return errorMessage(error, "The student could not be saved.");
}

const labelClass = "mb-1.5 block text-[13px] font-semibold text-ink";

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={labelClass}>
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

interface PoolStudentDialogProps {
  open: boolean;
  student: EligiblePoolStudent | null;
  onClose: () => void;
}

export function PoolStudentDialog({ open, student, onClose }: PoolStudentDialogProps) {
  if (!open) return null;
  return <PoolStudentForm key={student?.studentId ?? "new"} student={student} onClose={onClose} />;
}

function PoolStudentForm({ student, onClose }: { student: EligiblePoolStudent | null; onClose: () => void }) {
  const id = useId();
  const editing = student !== null;
  const panelRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<FormValues>(() => initialValues(student));
  const [error, setError] = useState<string | null>(null);
  const create = useCreatePoolStudent();
  const update = useUpdatePoolStudent();
  const toast = useToast();
  const pending = create.isPending || update.isPending;

  const close = () => {
    if (!pending) onClose();
  };
  useModalBehavior(true, panelRef, close, firstRef);

  const set = (field: FieldName) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    if (error) setError(null);
  };
  const fieldId = (field: FieldName) => `${id}-${field}`;
  const input = (
    field: FieldName,
    props: { placeholder?: string; type?: string; inputMode?: "numeric" | "email" | "tel"; disabled?: boolean } = {},
  ) => (
    <input
      ref={field === (editing ? "studentName" : "studentId") ? firstRef : undefined}
      id={fieldId(field)}
      value={values[field]}
      onChange={set(field)}
      autoComplete="off"
      className={toolbarFieldClass}
      {...props}
    />
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing && !values.studentId.trim()) return setError("Enter the student user ID.");
    if (!values.studentName.trim()) return setError("Enter the student name.");
    const payload = toPayload(values);
    const done = (verb: string) => () => {
      toast.success(`${payload.studentName} ${verb}`);
      onClose();
    };
    if (editing) {
      const changes = { ...payload };
      delete changes.studentId;
      update.mutate(
        { ...changes, studentId: student.studentId },
        { onSuccess: done("updated"), onError: (err) => setError(problemText(err)) },
      );
    } else {
      create.mutate(payload, {
        onSuccess: done("added to the eligible pool"),
        onError: (err) => setError(problemText(err)),
      });
    }
    return undefined;
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/30" aria-hidden onMouseDown={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        className="relative flex max-h-[90dvh] w-full max-w-2xl animate-pop-in flex-col rounded-xl border bg-surface shadow-pop outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-lg font-bold text-ink">
              {editing ? "Edit student" : "Add student"}
            </h2>
            {editing && <p className="mt-0.5 font-mono text-xs break-all text-muted">{student.studentId}</p>}
          </div>
          <IconButton label="Close" className="size-8 border-transparent shadow-none" onClick={close}>
            <X className="size-4" aria-hidden />
          </IconButton>
        </div>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-5 sm:grid-cols-2">
            <Field id={fieldId("studentId")} label="User ID" required={!editing}>
              {input("studentId", { placeholder: "Learning Portal user ID", disabled: editing })}
            </Field>
            <Field id={fieldId("niatId")} label="NIAT ID">
              {input("niatId", { placeholder: "e.g. N25P01A0265" })}
            </Field>
            <Field id={fieldId("studentName")} label="Name" required>
              {input("studentName", { placeholder: "Full name" })}
            </Field>
            <Field id={fieldId("mobile")} label="Mobile">
              {input("mobile", { type: "tel", inputMode: "tel", placeholder: "+91 98765 43210" })}
            </Field>
            <Field id={fieldId("email")} label="Email">
              {input("email", { type: "email", inputMode: "email", placeholder: "name@example.com" })}
            </Field>
            <Field id={fieldId("productGroup")} label="Product">
              <BadgeSelect
                id={fieldId("productGroup")}
                value={values.productGroup}
                options={EDITABLE_PRODUCTS}
                toneFor={productTone}
                onChange={(value) => set("productGroup")({ target: { value } })}
              />
            </Field>
            <Field id={fieldId("campus")} label="Campus">
              {input("campus", { placeholder: "College or campus name" })}
            </Field>
            <Field id={fieldId("batch")} label="Batch">
              {input("batch", { inputMode: "numeric", placeholder: "e.g. 2025" })}
            </Field>
            <Field id={fieldId("eligibilityStatus")} label="Eligibility status">
              <BadgeSelect
                id={fieldId("eligibilityStatus")}
                value={values.eligibilityStatus}
                options={ELIGIBILITY_STATUSES}
                toneFor={statusTone}
                onChange={(value) => set("eligibilityStatus")({ target: { value } })}
              />
            </Field>
            <Field id={fieldId("remarks")} label="Remarks">
              {input("remarks", { placeholder: "Optional note" })}
            </Field>

            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={pending}
              icon={editing ? <Save className="size-4" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
            >
              {editing ? "Save changes" : "Add student"}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
