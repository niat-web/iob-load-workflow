import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition } from "../hooks/useAnchoredPosition";
import { cn } from "../utils/cn";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  triggerClassName?: string;
  triggerLabel?: string;
  className?: string;
}

const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 100;

export function Tooltip({ content, children, triggerClassName, triggerLabel, className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const position = useAnchoredPosition(open, triggerRef, tooltipRef, "top");

  const schedule = (next: boolean, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delay);
  };
  const show = () => schedule(true, OPEN_DELAY_MS);
  const hide = () => schedule(false, CLOSE_DELAY_MS);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label={triggerLabel}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={() => {
          window.clearTimeout(timer.current);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        className={cn("focus-ring max-w-full cursor-default rounded-sm text-left", triggerClassName)}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            onMouseEnter={() => window.clearTimeout(timer.current)}
            onMouseLeave={hide}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              visibility: position ? "visible" : "hidden",
            }}
            className="fixed z-[80] max-w-xs animate-fade-in"
          >
            <div
              id={id}
              role="tooltip"
              className={cn(
                "rounded-lg bg-slate-900 px-3 py-2 text-xs leading-relaxed whitespace-normal text-white shadow-pop",
                className,
              )}
            >
              {content}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
