import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "../utils/cn";
import { priorityOptions } from "../utils/format";
import { cellFieldClass } from "./ui/styles";

interface CandidatePrioritySelectProps {
  value: string;
  aiPriority: string;
  count: number;
  onChange: (value: string) => Promise<boolean>;
  label: string;
  disabled?: boolean;
}

export function CandidatePrioritySelect({
  value,
  aiPriority,
  count,
  onChange,
  label,
  disabled,
}: CandidatePrioritySelectProps) {
  const [pending, setPending] = useState<string | null>(null);
  const shown = pending ?? value;
  const changed = shown !== aiPriority;
  const options = priorityOptions(count);
  if (!options.includes(shown)) options.unshift(shown);

  const handleChange = async (next: string) => {
    if (next === value) return;
    setPending(next);
    await onChange(next);
    setPending(null);
  };

  return (
    <div className="relative w-[84px]" title={changed ? `AI priority: ${aiPriority}` : undefined}>
      <select
        aria-label={label}
        value={shown}
        disabled={disabled || pending !== null}
        aria-busy={pending !== null || undefined}
        onChange={(e) => void handleChange(e.target.value)}
        className={cn(
          cellFieldClass,
          "appearance-none pr-6 tabular-nums",
          changed && "border-primary/40 bg-primary-soft font-semibold text-primary",
          pending !== null && "opacity-70",
        )}
      >
        {options.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <ChevronDown
        className={cn(
          "pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2",
          changed ? "text-primary" : "text-slate-400",
        )}
        aria-hidden
      />
    </div>
  );
}
