import { useEffect, type RefObject } from "react";

const LINE_HEIGHT = 16;

const canScroll = (element: HTMLElement) => element.scrollHeight > element.clientHeight + 1;

function scrollableAncestor(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  let node = target instanceof Element ? target : null;
  while (node && node !== root) {
    if (node instanceof HTMLElement && /(auto|scroll)/.test(getComputedStyle(node).overflowY) && canScroll(node)) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function useWheelScroll(rootRef: RefObject<HTMLElement | null>, mainRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (scrollableAncestor(event.target, root)) return;
      const main = mainRef.current;
      if (!main) return;
      const region = canScroll(main) ? main : main.querySelector<HTMLElement>("[data-scroll-region]");
      if (!region || !canScroll(region)) return;
      region.scrollTop += event.deltaMode === 1 ? event.deltaY * LINE_HEIGHT : event.deltaY;
      event.preventDefault();
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [rootRef, mainRef]);
}
