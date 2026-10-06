import { Search, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useLatest } from "../hooks/useLatest";
import { cn } from "../utils/cn";
import { toolbarFieldClass } from "./ui/styles";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  delay?: number;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder, label, delay = 300, className }: SearchInputProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const onChangeRef = useLatest(onChange);

  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === synced) return undefined;
    const timer = window.setTimeout(() => {
      setSynced(draft);
      onChangeRef.current(draft);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [draft, synced, delay, onChangeRef]);

  const clear = () => {
    setDraft("");
    setSynced("");
    onChangeRef.current("");
  };

  return (
    <div className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        id={id}
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && draft) {
            e.preventDefault();
            clear();
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={cn(toolbarFieldClass, "pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden")}
      />
      {draft && (
        <button
          type="button"
          onClick={clear}
          className="focus-ring absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-ink"
          aria-label="Clear search"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
