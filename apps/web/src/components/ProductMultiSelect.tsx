import { Check, ChevronDown } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition } from "../hooks/useAnchoredPosition";
import { useDismiss } from "../hooks/useDismiss";
import { EDITABLE_PRODUCTS, type PoolProduct } from "../types/api";
import { cn } from "../utils/cn";
import { productTone } from "../utils/poolTones";
import { StatusBadge } from "./StatusBadge";
import { cellFieldClass, toolbarFieldClass } from "./ui/styles";

interface ProductMultiSelectProps {
  id?: string;
  label: string;
  value: readonly PoolProduct[];
  onChange: (products: PoolProduct[]) => void;
  keepOne?: boolean;
  compact?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}

export function ProductMultiSelect({
  id,
  label,
  value,
  onChange,
  keepOne = false,
  compact = false,
  disabled = false,
  invalid = false,
  placeholder = "Select products",
}: ProductMultiSelectProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [width, setWidth] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const position = useAnchoredPosition(open, triggerRef, listRef, "bottom-start");

  useDismiss(open, () => setOpen(false), [triggerRef, listRef]);

  useLayoutEffect(() => {
    if (open) setWidth(Math.max(triggerRef.current?.getBoundingClientRect().width ?? 0, 180));
  }, [open]);

  const locked = (product: PoolProduct) => keepOne && value.length === 1 && value.includes(product);

  const toggle = (product: PoolProduct) => {
    if (locked(product)) return;
    const next = value.includes(product) ? value.filter((item) => item !== product) : [...value, product];
    onChange(EDITABLE_PRODUCTS.filter((item) => next.includes(item)));
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        setActiveIndex(0);
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(EDITABLE_PRODUCTS.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const product = EDITABLE_PRODUCTS[activeIndex];
      if (product) toggle(product);
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
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onKeyDown}
        className={cn(
          compact ? cellFieldClass : toolbarFieldClass,
          "flex items-center justify-between gap-2 pr-2.5 text-left",
          invalid && "border-red-400",
        )}
      >
        {value.length ? (
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {value.map((product) => (
              <StatusBadge key={product} label={product} tone={productTone(product)} />
            ))}
          </span>
        ) : (
          <span className="truncate text-muted">{placeholder}</span>
        )}
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            aria-multiselectable="true"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
            style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, width: width ?? undefined }}
            className="fixed z-[60] animate-pop-in rounded-lg border bg-surface p-1 shadow-pop"
          >
            {EDITABLE_PRODUCTS.map((product, index) => {
              const checked = value.includes(product);
              const fixed = locked(product);
              return (
                <div
                  key={product}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={checked}
                  aria-disabled={fixed || undefined}
                  title={fixed ? "Keep at least one product" : undefined}
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggle(product)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                    index === activeIndex && "bg-slate-50",
                    fixed && "cursor-not-allowed opacity-70",
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
                  <span className={cn("text-ink", checked && "font-semibold")}>{product}</span>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
