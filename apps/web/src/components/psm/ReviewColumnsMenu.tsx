import { Check, Columns3 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { errorMessage } from "../../api/client";
import { useSavePsmColumns } from "../../api/psm";
import { useDismiss } from "../../hooks/useDismiss";
import type { CandidateExtraColumn } from "../../types/api";
import { cn } from "../../utils/cn";
import { useToast } from "../toast-context";
import { Button } from "../ui/Button";
import { EXTRA_COLUMNS } from "./candidateColumns";

export function ReviewColumnsMenu({ jobId, selected }: { jobId: string; selected: CandidateExtraColumn[] }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CandidateExtraColumn[] | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const save = useSavePsmColumns(jobId);
  const toast = useToast();
  const chosen = draft ?? selected;

  const close = () => {
    setOpen(false);
    setDraft(null);
  };
  useDismiss(open, close, [buttonRef, panelRef]);

  const toggle = (key: CandidateExtraColumn) =>
    setDraft(chosen.includes(key) ? chosen.filter((item) => item !== key) : [...chosen, key]);

  const submit = () =>
    save.mutate(chosen, {
      onSuccess: () => {
        toast.success("Columns saved for this deal");
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
          Columns{selected.length ? ` (${selected.length})` : ""}
        </Button>
      </div>
      {open && (
        <div
          ref={panelRef}
          id={menuId}
          role="dialog"
          aria-label="More columns for this deal"
          className="absolute top-full right-0 z-40 mt-1.5 w-80 animate-pop-in rounded-lg border bg-surface p-3 shadow-pop"
        >
          <p className="text-sm font-semibold text-ink">More columns</p>
          <p className="mt-0.5 text-xs text-muted">
            Extra applicant details from the applied pool. Your choice is saved for this deal and only shows on this page.
          </p>
          <div className="mt-2 flex gap-3 text-xs font-semibold">
            <button type="button" className="focus-ring rounded text-primary hover:underline" onClick={() => setDraft(EXTRA_COLUMNS.map((column) => column.key))}>
              Show all
            </button>
            <button type="button" className="focus-ring rounded text-primary hover:underline" onClick={() => setDraft([])}>
              Hide all
            </button>
          </div>
          <ul className="mt-2 max-h-72 overflow-y-auto">
            {EXTRA_COLUMNS.map((column) => {
              const checked = chosen.includes(column.key);
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
            <Button size="sm" loading={save.isPending} onClick={submit}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
