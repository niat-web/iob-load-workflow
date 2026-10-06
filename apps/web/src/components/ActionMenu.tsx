import { Ellipsis } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition } from "../hooks/useAnchoredPosition";
import { useDismiss } from "../hooks/useDismiss";
import { cn } from "../utils/cn";

export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

interface ActionMenuProps {
  label: string;
  items: ActionMenuItem[];
}

export function ActionMenu({ label, items }: ActionMenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const position = useAnchoredPosition(open, triggerRef, menuRef, "bottom-end");

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useDismiss(open, () => close(false), [triggerRef, menuRef]);

  useEffect(() => {
    if (open && position) {
      menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus({ preventScroll: true });
    }
  }, [open, position]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    } else if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      buttons[next]?.focus();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "focus-ring inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-slate-100 hover:text-ink",
          open && "bg-slate-100 text-ink",
        )}
      >
        <Ellipsis className="size-4" aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            tabIndex={-1}
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              visibility: position ? "visible" : "hidden",
            }}
            className="fixed z-[60] min-w-44 animate-pop-in rounded-lg border bg-surface p-1 shadow-pop"
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium outline-none",
                  item.danger
                    ? "text-red-600 hover:bg-red-50 focus-visible:bg-red-50"
                    : "text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-100",
                )}
              >
                {item.icon && <span className={item.danger ? "text-red-500" : "text-muted"}>{item.icon}</span>}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
