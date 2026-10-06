import { useEffect, type RefObject } from "react";
import { useLatest } from "./useLatest";

export function useDismiss(
  open: boolean,
  onDismiss: () => void,
  refs: ReadonlyArray<RefObject<HTMLElement | null>>,
) {
  const dismissRef = useLatest(onDismiss);
  const refsRef = useLatest(refs);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const inside = refsRef.current.some((ref) => ref.current?.contains(target));
      if (!inside) dismissRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        dismissRef.current();
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, dismissRef, refsRef]);
}
