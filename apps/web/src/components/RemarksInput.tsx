import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../utils/cn";
import { cellFieldClass } from "./ui/styles";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface RemarksInputProps {
  value: string;
  onSave: (value: string) => Promise<boolean>;
  label: string;
  disabled?: boolean;
  maxLength?: number;
}

export function RemarksInput({ value, onSave, label, disabled, maxLength = 1000 }: RemarksInputProps) {
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [editing, setEditing] = useState(false);
  const [syncedValue, setSyncedValue] = useState(value);
  const skipNextSave = useRef(false);

  if (value !== syncedValue && !editing && status !== "saving") {
    setSyncedValue(value);
    setDraft(value);
  }

  useEffect(() => {
    if (status !== "saved") return undefined;
    const timer = window.setTimeout(() => setStatus("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const save = async () => {
    const next = draft.trim();
    if (next === value.trim()) {
      if (status === "error") setStatus("idle");
      return;
    }
    setStatus("saving");
    const ok = await onSave(next);
    setStatus(ok ? "saved" : "error");
    if (ok) {
      setDraft(next);
      setSyncedValue(next);
    }
  };

  return (
    <div className="flex w-[210px] items-center gap-1.5">
      <input
        type="text"
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        disabled={disabled}
        placeholder="Add remarks"
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (skipNextSave.current) {
            skipNextSave.current = false;
            return;
          }
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            skipNextSave.current = true;
            setDraft(value);
            if (status === "error") setStatus("idle");
            e.currentTarget.blur();
          }
        }}
        className={cn(cellFieldClass, "min-w-0 flex-1", status === "error" && "border-red-300")}
      />
      <span className="flex size-4 shrink-0 items-center justify-center" aria-live="polite">
        {status === "saving" && (
          <>
            <LoaderCircle className="size-3.5 animate-spin text-muted" aria-hidden />
            <span className="sr-only">Saving</span>
          </>
        )}
        {status === "saved" && (
          <>
            <Check className="size-3.5 text-emerald-600" aria-hidden />
            <span className="sr-only">Saved</span>
          </>
        )}
        {status === "error" && (
          <button
            type="button"
            onClick={() => void save()}
            className="focus-ring rounded text-red-600"
            aria-label="Remarks not saved. Retry"
            title="Not saved. Click to retry"
          >
            <CircleAlert className="size-3.5" aria-hidden />
          </button>
        )}
      </span>
    </div>
  );
}
