import { Check, ChevronDown, Columns3, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "../../hooks/useDismiss";
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
  Selected: "bg-[#d4edbc] text-[#11734b]",
  Rejected: "bg-[#ffcfc9] text-[#b10202]",
  "On Hold": "bg-[#e6e6e6] text-[#3d3d3d]",
  "Yet to Schedule": "bg-[#e6e6e6] text-[#3d3d3d]",
  Scheduled: "bg-[#e6cff2] text-[#5a3286]",
  Hold: "bg-[#ffe5a0] text-[#473821]",
  "No Show": "bg-[#3d3d3d] text-white",
};

const MENU_WIDTH = 200;

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
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => setMenu(null);
  useDismiss(menu !== null, close, [buttonRef, menuRef]);

  useEffect(() => {
    if (!menu) return undefined;
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menu]);

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const height = (options.length + (value ? 2 : 0)) * 36 + 16;
    const below = rect.bottom + 4;
    const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - 4) : below;
    setMenu({ top, left: Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)) });
  };

  const pick = (next: string) => {
    setMenu(null);
    buttonRef.current?.focus();
    if (next !== value) onSave(next);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label}: ${value || "not set"}`}
        aria-haspopup="listbox"
        aria-expanded={menu !== null}
        disabled={saving}
        onClick={() => (menu ? close() : open())}
        onKeyDown={(event) => event.key === "Escape" && close()}
        className={cn(
          "focus-ring inline-flex h-7 w-full min-w-[140px] items-center justify-between gap-2 rounded-full px-3 text-xs font-semibold transition-[filter] hover:brightness-95 disabled:cursor-wait",
          value ? (OPTION_TONES[value] ?? "bg-slate-100 text-ink") : "bg-[#eef0f2] text-slate-500",
          saving && "opacity-60",
        )}
      >
        <span className="truncate">{value}</span>
        <ChevronDown className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
      </button>
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={label}
            style={{ top: menu.top, left: menu.left, width: MENU_WIDTH }}
            className="fixed z-50 animate-pop-in rounded-lg border border-line bg-white p-1.5 shadow-pop"
          >
            {options.map((option) => (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={option === value}
                onClick={() => pick(option)}
                className={cn(
                  "flex h-9 w-full items-center rounded-md px-2 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none",
                  option === value && "bg-slate-100",
                )}
              >
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", OPTION_TONES[option] ?? "bg-slate-100 text-ink")}>
                  {option}
                </span>
              </button>
            ))}
            {value && (
              <>
                <div className="my-1 border-t border-line" />
                <button
                  type="button"
                  onClick={() => pick("")}
                  className="flex h-9 w-full items-center rounded-md px-2 text-xs font-semibold text-muted hover:bg-slate-100"
                >
                  Clear
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
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
