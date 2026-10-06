import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ToastContext, type ToastApi, type ToastTone } from "./toast-context";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const DURATION_MS = 4000;
const MAX_TOASTS = 3;

const ICONS = {
  success: <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-hidden />,
  error: <CircleAlert className="size-4 shrink-0 text-red-600" aria-hidden />,
  info: <Info className="size-4 shrink-0 text-primary" aria-hidden />,
} satisfies Record<ToastTone, ReactNode>;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((items) => items.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message: string, tone: ToastTone = "info") => {
    const id = nextId.current++;
    setToasts((items) => {
      const withoutDup = items.filter((t) => !(t.message === message && t.tone === tone));
      return [...withoutDup, { id, message, tone }].slice(-MAX_TOASTS);
    });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show(m, "success"),
      error: (m) => show(m, "error"),
      info: (m) => show(m, "info"),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          aria-atomic="false"
          className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
        >
          {toasts.map((toast) => (
            <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className="pointer-events-auto flex animate-toast-in items-start gap-2.5 rounded-lg border bg-surface px-3.5 py-3 text-sm font-semibold text-ink shadow-pop"
    >
      <span className="mt-px">{ICONS[toast.tone]}</span>
      <p className="min-w-0 flex-1 break-words">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="focus-ring -m-1 rounded p-1 text-muted hover:text-ink"
        aria-label="Dismiss notification"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
