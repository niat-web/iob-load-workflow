import { useLayoutEffect, useState, type RefObject } from "react";

export type Placement = "bottom-end" | "bottom-start" | "top";

interface Position {
  top: number;
  left: number;
}

const GAP = 6;
const MARGIN = 8;

export function useAnchoredPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  placement: Placement,
): Position | null {
  const [position, setPosition] = useState<Position | null>(null);

  useLayoutEffect(() => {
    if (!open) return undefined;

    const update = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const floating = floatingRef.current;
      if (!anchor || !floating) return;

      const width = floating.offsetWidth;
      const height = floating.offsetHeight;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let top: number;
      let left: number;
      if (placement === "top") {
        top = anchor.top - height - GAP;
        if (top < MARGIN) top = anchor.bottom + GAP;
        left = anchor.left + anchor.width / 2 - width / 2;
      } else {
        top = anchor.bottom + GAP;
        const above = anchor.top - height - GAP;
        if (top + height > viewportHeight - MARGIN && above >= MARGIN) top = above;
        left = placement === "bottom-end" ? anchor.right - width : anchor.left;
      }
      left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, viewportWidth - width - MARGIN));

      setPosition((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, placement, anchorRef, floatingRef]);

  return open ? position : null;
}
