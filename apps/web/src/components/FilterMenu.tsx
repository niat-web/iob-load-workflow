import { Check, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useDismiss } from "../hooks/useDismiss";
import type { FilterOption } from "../types/api";
import { cn } from "../utils/cn";
import { Button } from "./ui/Button";

export interface FilterCategory {
  key: string;
  label: string;
  options: ReadonlyArray<FilterOption | string>;
}

interface FilterMenuProps {
  categories: FilterCategory[];
  values: Record<string, string[]>;
  onChange: (key: string, values: string[]) => void;
  onClear: () => void;
}

const SEARCH_FROM = 8;

const normalise = (options: ReadonlyArray<FilterOption | string>): FilterOption[] =>
  options.map((option) => (typeof option === "string" ? { value: option, label: option } : option));

function OptionsPanel({
  category,
  selected,
  onToggle,
  onClearCategory,
}: {
  category: FilterCategory;
  selected: string[];
  onToggle: (value: string) => void;
  onClearCategory: () => void;
}) {
  const [query, setQuery] = useState("");
  const options = normalise(category.options);
  const term = query.trim().toLowerCase();
  const shown = term ? options.filter((option) => option.label.toLowerCase().includes(term)) : options;

  return (
    <div className="absolute top-0 left-full z-10 pl-2.5">
      <div
        role="group"
        aria-label={category.label}
        className="w-72 animate-pop-in rounded-lg border bg-surface p-1.5 shadow-pop"
      >
        {options.length >= SEARCH_FROM && (
          <div className="relative mb-1.5">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${category.label.toLowerCase()}…`}
              aria-label={`Search ${category.label}`}
              className="h-8 w-full rounded-md border border-field bg-surface pr-2 pl-8 text-sm outline-none focus:border-primary"
            />
          </div>
        )}
        <ul className="max-h-72 overflow-y-auto">
          {shown.length === 0 && <li className="px-2.5 py-2 text-sm text-muted">No matches</li>}
          {shown.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  onClick={() => onToggle(option.value)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-slate-50 focus-visible:bg-slate-100 focus-visible:outline-none",
                    checked ? "font-semibold text-ink" : "text-slate-700",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border",
                      checked ? "border-primary bg-primary text-white" : "border-field bg-surface",
                    )}
                  >
                    {checked && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 truncate" title={option.label}>
                    {option.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClearCategory}
            className="mt-1 w-full rounded-md border-t px-2.5 pt-2 pb-1 text-left text-xs font-semibold text-primary hover:underline"
          >
            Clear {category.label.toLowerCase()}
          </button>
        )}
      </div>
    </div>
  );
}

export function FilterMenu({ categories, values, onChange, onClear }: FilterMenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const total = categories.reduce((sum, category) => sum + (values[category.key]?.length ?? 0), 0);

  const close = () => {
    setOpen(false);
    setActive(null);
  };
  useDismiss(open, close, [buttonRef, menuRef]);

  const toggle = (key: string, value: string) => {
    const current = values[key] ?? [];
    onChange(key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  return (
    <div className="relative">
      <div ref={buttonRef}>
        <Button
          variant="secondary"
          onClick={() => (open ? close() : setOpen(true))}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          icon={<SlidersHorizontal className="size-4" aria-hidden />}
        >
          Filters
          {total > 0 && (
            <span className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
              {total}
            </span>
          )}
        </Button>
      </div>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label="Filters"
          className="absolute top-full left-0 z-40 mt-1.5 w-60 animate-pop-in rounded-lg border bg-surface p-1.5 shadow-pop"
          onMouseLeave={() => setActive(null)}
        >
          {categories.map((category) => {
            const count = values[category.key]?.length ?? 0;
            const isActive = active === category.key;
            return (
              <div key={category.key} className="relative" onMouseEnter={() => setActive(category.key)}>
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="true"
                  aria-expanded={isActive}
                  onClick={() => setActive(isActive ? null : category.key)}
                  onFocus={() => setActive(category.key)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none",
                    isActive ? "bg-primary-soft text-primary" : "text-ink hover:bg-slate-50",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{category.label}</span>
                  {count > 0 && (
                    <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-white">{count}</span>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                </button>
                {isActive && (
                  <OptionsPanel
                    category={category}
                    selected={values[category.key] ?? []}
                    onToggle={(value) => toggle(category.key, value)}
                    onClearCategory={() => onChange(category.key, [])}
                  />
                )}
              </div>
            );
          })}
          <div className="mt-1 border-t pt-1">
            <button
              type="button"
              disabled={total === 0}
              onClick={onClear}
              className="w-full rounded-md px-2.5 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent"
            >
              Clear all filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
