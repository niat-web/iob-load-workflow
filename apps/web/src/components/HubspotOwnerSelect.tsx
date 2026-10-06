import { ChevronDown } from "lucide-react";
import type { HubspotOwner } from "../types/api";
import { cn } from "../utils/cn";
import { cellFieldClass, toolbarFieldClass } from "./ui/styles";

interface HubspotOwnerSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  owners: HubspotOwner[];
  placeholder: string;
  label?: string;
  invalid?: boolean;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}

export function HubspotOwnerSelect({
  id,
  value,
  onChange,
  owners,
  placeholder,
  label,
  invalid,
  disabled,
  compact,
  className,
}: HubspotOwnerSelectProps) {
  return (
    <div className={cn("relative", className)}>
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && id ? `${id}-error` : undefined}
        className={cn(
          compact ? cellFieldClass : toolbarFieldClass,
          "appearance-none truncate pr-8",
          !value && "text-muted",
          invalid && "border-red-400 focus:border-red-500 focus:ring-red-500/15",
        )}
      >
        <option value="">{placeholder}</option>
        {owners.map((owner) => (
          <option key={owner.id} value={owner.id} className="text-ink">
            {owner.name}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted"
        aria-hidden
      />
    </div>
  );
}
