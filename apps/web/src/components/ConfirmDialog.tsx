import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalBehavior } from "../hooks/useModalBehavior";
import { Button, type ButtonVariant } from "./ui/Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  cancelLabel?: string;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  confirmVariant = "primary",
  cancelLabel = "Cancel",
  pending = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const safeCancel = () => {
    if (!pending) onCancel();
  };
  useModalBehavior(open, panelRef, safeCancel, cancelRef);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/30" aria-hidden onMouseDown={safeCancel} />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        className="relative w-full max-w-md animate-pop-in rounded-xl border bg-surface p-6 shadow-pop outline-none"
      >
        <h2 id={titleId} className="text-lg font-bold text-ink">
          {title}
        </h2>
        <div id={messageId} className="mt-2 text-sm leading-relaxed text-muted">
          {message}
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={safeCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
