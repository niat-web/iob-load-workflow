import { useId } from "react";
import { cn } from "../../utils/cn";

interface SwitchRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function SwitchRow({ label, description, checked, onChange, disabled }: SwitchRowProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-sm font-semibold text-ink">
          {label}
        </p>
        {description && (
          <p id={`${id}-description`} className="mt-0.5 text-xs text-muted">
            {description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span aria-hidden className={cn("w-6 text-right text-xs font-semibold", checked ? "text-primary" : "text-muted")}>
          {checked ? "On" : "Off"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${id}-label`}
          aria-describedby={description ? `${id}-description` : undefined}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={cn(
            "focus-ring relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            checked ? "bg-primary" : "bg-slate-300",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-5 rounded-full bg-white shadow transition-transform",
              checked ? "translate-x-[22px]" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
}

export function Switch({ checked, onChange, label, disabled, title }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "focus-ring relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-slate-300",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block size-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
