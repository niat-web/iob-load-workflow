import { Check, ChevronDown } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition } from "../hooks/useAnchoredPosition";
import { useDismiss } from "../hooks/useDismiss";
import type { Tone } from "../types/api";
import { cn } from "../utils/cn";
import { StatusBadge } from "./StatusBadge";
import { toolbarFieldClass } from "./ui/styles";

interface BadgeSelectProps {
  id: string;
  value: string;
  options: readonly string[];
  toneFor: (value: string) => Tone;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function BadgeSelect({ id, value, options, toneFor, onChange, placeholder = "Select" }: BadgeSelectProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [width, setWidth] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const position = useAnchoredPosition(open, triggerRef, listRef, "bottom-start");
  const choices = value && !options.includes(value) ? [...options, value] : [...options];

  useDismiss(open, () => setOpen(false), [triggerRef, listRef]);

  useLayoutEffect(() => {
    if (open) setWidth(triggerRef.current?.getBoundingClientRect().width ?? null);
  }, [open]);

  const openList = () => {
    setActiveIndex(Math.max(0, choices.indexOf(value)));
    setOpen(true);
  };

  const choose = (option: string) => {
    onChange(option);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(choices.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = choices[activeIndex];
      if (option) choose(option);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cn(toolbarFieldClass, "flex items-center justify-between gap-2 pr-2.5 text-left")}
      >
        {value ? (
          <StatusBadge label={value} tone={toneFor(value)} />
        ) : (
          <span className="text-muted">{placeholder}</span>
        )}
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={id}
            style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, width: width ?? undefined }}
            className="fixed z-[60] max-h-64 animate-pop-in overflow-y-auto rounded-lg border bg-surface p-1 shadow-pop"
          >
            {choices.map((option, index) => {
              const selected = option === value;
              return (
                <div
                  key={option}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  tabIndex={-1}
                  onClick={() => choose(option)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choose(option);
                    }
                  }}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2",
                    index === activeIndex && "bg-slate-50",
                  )}
                >
                  <StatusBadge label={option} tone={toneFor(option)} />
                  {selected && <Check className="size-4 text-primary" aria-hidden />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
