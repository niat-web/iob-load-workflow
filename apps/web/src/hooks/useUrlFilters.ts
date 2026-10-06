import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";

function parsePage(raw: string | null): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => {
    const result = {} as Record<K, string>;
    for (const key of keys) result[key] = searchParams.get(key) ?? "";
    return result;
  }, [searchParams, keys]);

  const page = parsePage(searchParams.get("page"));
  const hasFilters = keys.some((key) => filters[key].trim() !== "");

  const setFilter = useCallback(
    (key: K, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setPage = useCallback(
    (nextPage: number, options?: { replace?: boolean }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nextPage <= 1) next.delete("page");
          else next.set("page", String(nextPage));
          return next;
        },
        { replace: options?.replace ?? false },
      );
    },
    [setSearchParams],
  );

  const clearFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of keys) next.delete(key);
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams, keys]);

  return { filters, page, hasFilters, setFilter, setPage, clearFilters };
}

export function useClampPage(
  page: number,
  totalPages: number | undefined,
  setPage: (page: number, options?: { replace?: boolean }) => void,
) {
  useEffect(() => {
    if (totalPages !== undefined && totalPages > 0 && page > totalPages) setPage(totalPages, { replace: true });
  }, [page, totalPages, setPage]);
}
