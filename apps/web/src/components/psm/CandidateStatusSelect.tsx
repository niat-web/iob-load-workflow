import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { CandidateStatus } from "../../types/api";
import { CANDIDATE_STATUS_OPTIONS, isCandidateStatus } from "../../utils/candidate";
import { cn } from "../../utils/cn";
import { cellFieldClass } from "../ui/styles";

interface CandidateStatusSelectProps {
  value: CandidateStatus | null;
  onChange: (value: CandidateStatus) => Promise<boolean>;
  label: string;
  disabled?: boolean;
}

export function CandidateStatusSelect({ value, onChange, label, disabled }: CandidateStatusSelectProps) {
  const [pending, setPending] = useState<CandidateStatus | null>(null);
  const shown = pending ?? value ?? "";

  const handleChange = async (next: string) => {
    if (!isCandidateStatus(next) || next === value) return;
    setPending(next);
    await onChange(next);
    setPending(null);
  };

  return (
    <div className="relative w-[160px]">
      <select
        aria-label={label}
        value={shown}
        disabled={disabled || pending !== null}
        aria-busy={pending !== null || undefined}
        onChange={(e) => void handleChange(e.target.value)}
        className={cn(cellFieldClass, "appearance-none pr-6", !shown && "text-muted", pending !== null && "opacity-70")}
      >
        {value === null && (
          <option value="" disabled>
            Select status
          </option>
        )}
        {CANDIDATE_STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
    </div>
  );
}
