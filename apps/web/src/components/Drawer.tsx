import { X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalBehavior } from "../hooks/useModalBehavior";
import { IconButton } from "./ui/Button";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
}

export function Drawer({ open, onClose, title, headerExtra, children }: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalBehavior(open, panelRef, onClose);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/25" aria-hidden onMouseDown={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-[560px] animate-drawer-in flex-col border-l bg-surface shadow-pop outline-none"
      >
        <div className="flex h-15 shrink-0 items-center gap-3 border-b px-5">
          <h2 id={titleId} className="min-w-0 truncate text-lg font-bold text-ink">
            {title}
          </h2>
          <div className="flex min-w-0 flex-1 items-center gap-2">{headerExtra}</div>
          <IconButton label="Close panel" onClick={onClose} className="size-8 border-transparent shadow-none">
            <X className="size-4" aria-hidden />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
