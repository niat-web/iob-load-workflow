import { ChevronDown } from "lucide-react";
import { useId } from "react";
import type { FilterOption } from "../types/api";
import { cn } from "../utils/cn";
import { toolbarFieldClass } from "./ui/styles";

interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<FilterOption | string>;
  placeholder: string;
  label: string;
  disabled?: boolean;
  className?: string;
}

export function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  label,
  disabled,
  className,
}: FilterSelectProps) {
  const id = useId();
  const normalized = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const hasValue = value === "" || normalized.some((o) => o.value === value);

  return (
    <div className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          toolbarFieldClass,
          "appearance-none truncate pr-8 text-ink [&>option]:text-ink",
        )}
      >
        <option value="">{placeholder}</option>
        {!hasValue && <option value={value}>{value}</option>}
        {normalized.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
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
