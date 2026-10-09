import { Check, ChevronDown, Columns3, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { SharedColumn } from "../../types/api";
import { cn } from "../../utils/cn";
import { Button, IconButton } from "../ui/Button";
import { fieldClass } from "../ui/styles";

export function useFocusOn<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active]);
  return ref;
}

export function EditableCell({
  value,
  label,
  saving,
  onSave,
}: {
  value: string;
  label: string;
  saving: boolean;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const inputRef = useFocusOn<HTMLTextAreaElement>(editing);

  const finish = (save: boolean) => {
    if (save && draft !== null && draft !== value) onSave(draft);
    setDraft(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };

  if (editing) {
    return (
      <textarea
        ref={inputRef}
        aria-label={label}
        value={draft}
        rows={Math.min(6, Math.max(1, draft.split("\n").length))}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => finish(true)}
        className="block w-full min-w-[140px] resize-y rounded-md border border-primary bg-surface px-2 py-1.5 text-sm text-ink outline-none ring-3 ring-primary/15"
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={`${label}: ${value || "empty"}. Edit`}
      onClick={() => setDraft(value)}
      className={cn(
        "block min-h-8 w-full min-w-[120px] max-w-[320px] rounded-md px-2 py-1.5 text-left text-sm whitespace-pre-wrap text-ink transition-colors hover:bg-primary-soft/60 focus-visible:bg-primary-soft focus-visible:outline-none",
        saving && "opacity-60",
      )}
    >
      {value || <span className="text-muted/50">—</span>}
    </button>
  );
}

const OPTION_TONES: Record<string, string> = {
  Selected: "bg-emerald-100 text-emerald-800",
  Rejected: "bg-orange-100 text-orange-800",
  "On Hold": "bg-slate-200 text-slate-700",
  "Yet to Schedule": "bg-slate-100 text-slate-700",
  Scheduled: "bg-violet-100 text-violet-800",
  Hold: "bg-amber-100 text-amber-800",
  "No Show": "bg-slate-800 text-white",
};

export function OptionCell({
  value,
  options,
  label,
  saving,
  onSave,
}: {
  value: string;
  options: string[];
  label: string;
  saving: boolean;
  onSave: (next: string) => void;
}) {
  return (
    <div className="relative inline-flex w-full min-w-[150px]">
      <select
        aria-label={label}
        value={value}
        disabled={saving}
        onChange={(event) => onSave(event.target.value)}
        className={cn(
          "focus-ring h-8 w-full cursor-pointer appearance-none rounded-full border-0 pr-7 pl-3 text-xs font-semibold disabled:cursor-wait",
          value ? (OPTION_TONES[value] ?? "bg-slate-100 text-ink") : "bg-slate-50 text-muted ring-1 ring-line",
          saving && "opacity-60",
        )}
      >
        <option value="" className="bg-surface text-muted">
          Choose…
        </option>
        {options.map((option) => (
          <option key={option} value={option} className="bg-surface text-ink">
            {option}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2" aria-hidden />
    </div>
  );
}

export function TextCell({ value }: { value: string }) {
  return (
    <span className="block max-w-[320px] min-w-[100px] px-2 py-1.5 text-sm break-words text-ink">
      {value || <span className="text-muted/50">—</span>}
    </span>
  );
}

export function ColumnHeader({
  column,
  onRename,
  onDelete,
}: {
  column: SharedColumn;
  onRename: (label: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useFocusOn<HTMLInputElement>(draft !== null);
  if (draft !== null) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim() && draft.trim() !== column.label) onRename(draft.trim());
          setDraft(null);
        }}
      >
        <input
          ref={inputRef}
          aria-label="Column name"
          value={draft}
          maxLength={60}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && setDraft(null)}
          className="h-7 w-32 rounded-md border border-primary px-2 text-xs font-semibold text-ink normal-case outline-none"
        />
        <IconButton label="Save column name" type="submit" className="size-7">
          <Check className="size-3.5" aria-hidden />
        </IconButton>
      </form>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      {column.label}
      {column.custom && (
        <>
          <button
            type="button"
            onClick={() => setDraft(column.label)}
            className="focus-ring rounded p-0.5 text-muted hover:text-ink"
            aria-label={`Rename column ${column.label}`}
          >
            <Pencil className="size-3" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="focus-ring rounded p-0.5 text-muted hover:text-red-600"
            aria-label={`Delete column ${column.label}`}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </>
      )}
    </span>
  );
}

export function AddColumnForm({ onAdd, pending }: { onAdd: (label: string) => void; pending: boolean }) {
  const [label, setLabel] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useFocusOn<HTMLInputElement>(open);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!label.trim()) return;
    onAdd(label.trim());
    setLabel("");
    setOpen(false);
  };
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} icon={<Columns3 className="size-4" aria-hidden />}>
        Add column
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        ref={inputRef}
        aria-label="New column name"
        placeholder="Column name, e.g. Interview slot"
        value={label}
        maxLength={60}
        onChange={(event) => setLabel(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
        className={cn(fieldClass, "w-60")}
      />
      <Button type="submit" loading={pending} disabled={!label.trim()}>
        Add
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}
