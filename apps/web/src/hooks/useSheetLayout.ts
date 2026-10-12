import { useCallback, useEffect, useState } from "react";

export interface SheetLayoutState {
  widths: Record<string, number>;
  heights: Record<string, number>;
  freezeColumns: number;
  freezeRows: number;
}

export interface SheetLayout extends SheetLayoutState {
  setWidth: (id: string, width: number | null) => void;
  setHeight: (id: string, height: number | null) => void;
  setFreezeColumns: (count: number) => void;
  setFreezeRows: (count: number) => void;
}

export const MIN_COLUMN_WIDTH = 60;
export const MIN_ROW_HEIGHT = 28;

const EMPTY: SheetLayoutState = { widths: {}, heights: {}, freezeColumns: 0, freezeRows: 0 };

function read(key: string, defaults: Partial<SheetLayoutState>): SheetLayoutState {
  const base = { ...EMPTY, ...defaults };
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<SheetLayoutState> | null;
    return stored ? { ...base, ...stored } : base;
  } catch {
    return base;
  }
}

function without(map: Record<string, number>, id: string) {
  const next = { ...map };
  delete next[id];
  return next;
}

export function useSheetLayout(storageKey: string, defaults: Partial<SheetLayoutState> = {}): SheetLayout {
  const [state, setState] = useState<SheetLayoutState>(() => read(storageKey, defaults));

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      return;
    }
  }, [storageKey, state]);

  const setWidth = useCallback((id: string, width: number | null) => {
    setState((current) => ({
      ...current,
      widths: width === null ? without(current.widths, id) : { ...current.widths, [id]: Math.max(MIN_COLUMN_WIDTH, Math.round(width)) },
    }));
  }, []);
  const setHeight = useCallback((id: string, height: number | null) => {
    setState((current) => ({
      ...current,
      heights: height === null ? without(current.heights, id) : { ...current.heights, [id]: Math.max(MIN_ROW_HEIGHT, Math.round(height)) },
    }));
  }, []);
  const setFreezeColumns = useCallback((count: number) => setState((current) => ({ ...current, freezeColumns: count })), []);
  const setFreezeRows = useCallback((count: number) => setState((current) => ({ ...current, freezeRows: count })), []);

  return { ...state, setWidth, setHeight, setFreezeColumns, setFreezeRows };
}
