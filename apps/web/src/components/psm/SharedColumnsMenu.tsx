import { Check, Columns3 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { errorMessage } from "../../api/client";
import { useSaveSharedColumns, useSharedColumns } from "../../api/psm";
import { useDismiss } from "../../hooks/useDismiss";
import { cn } from "../../utils/cn";
import { useToast } from "../toast-context";
import { Button } from "../ui/Button";

export function SharedColumnsMenu({ jobId }: { jobId: string }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[] | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const choice = useSharedColumns(jobId);
  const save = useSaveSharedColumns(jobId);
  const toast = useToast();
  const selected = draft ?? choice.data?.selected ?? [];

  const close = () => {
    setOpen(false);
    setDraft(null);
  };
  useDismiss(open, close, [buttonRef, panelRef]);

  const toggle = (key: string) =>
    setDraft(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]);

  const submit = () =>
    save.mutate(selected, {
      onSuccess: () => {
        toast.success("Company page columns saved. New companies use them too.");
        close();
      },
      onError: (err) => toast.error(errorMessage(err, "The columns could not be saved.")),
    });

  return (
    <div className="relative">
      <div ref={buttonRef}>
        <Button
          variant="secondary"
          onClick={() => (open ? close() : setOpen(true))}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          icon={<Columns3 className="size-4" aria-hidden />}
        >
          Company page columns
        </Button>
      </div>
      {open && (
        <div
          ref={panelRef}
          id={menuId}
          role="dialog"
          aria-label="Columns on the company page"
          className="absolute top-full right-0 z-40 mt-1.5 w-72 animate-pop-in rounded-lg border bg-surface p-3 shadow-pop"
        >
          <p className="text-sm font-semibold text-ink">Columns on the company page</p>
          <p className="mt-0.5 text-xs text-muted">Your choice is also used for the next companies.</p>
          <ul className="mt-2 max-h-72 overflow-y-auto">
            {(choice.data?.columns ?? []).map((column) => {
              const checked = selected.includes(column.key);
              return (
                <li key={column.key}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    onClick={() => toggle(column.key)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50",
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
                    {column.label}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex justify-end gap-2 border-t pt-3">
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" loading={save.isPending} disabled={selected.length === 0} onClick={submit}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
