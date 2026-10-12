import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SharedColumn, SharedProfiles, SharedRow } from "../types/api";
import { api, apiUrl, seg } from "./client";

export const sharedKeys = {
  profiles: (jobId: string) => ["shared", "profiles", jobId] as const,
};

const base = (jobId: string) => `/shared/profiles/${seg(jobId)}`;

export function sharedResumeUrl(jobId: string, ref: string): string {
  return apiUrl(`${base(jobId)}/resumes/${seg(ref)}`);
}

const fetchProfiles = (jobId: string, signal?: AbortSignal) => api.get<SharedProfiles>(base(jobId), undefined, signal);

const SHARED_PATH = /^\/shared\/profiles\/(?:[^/]+\/)?([0-9a-f-]{36})\/?$/i;

export function prefetchSharedProfiles(queryClient: QueryClient, pathname: string) {
  const jobId = SHARED_PATH.exec(pathname)?.[1];
  if (!jobId) return;
  void queryClient.prefetchQuery({ queryKey: sharedKeys.profiles(jobId), queryFn: ({ signal }) => fetchProfiles(jobId, signal), retry: false });
}

export function useSharedProfiles(jobId: string) {
  return useQuery({
    queryKey: sharedKeys.profiles(jobId),
    queryFn: ({ signal }) => fetchProfiles(jobId, signal),
    enabled: jobId.length > 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

function useSheetMutation<TInput, TResult>(
  jobId: string,
  request: (input: TInput) => Promise<TResult>,
  apply: (sheet: SharedProfiles, input: TInput, result: TResult) => SharedProfiles,
) {
  const queryClient = useQueryClient();
  const key = sharedKeys.profiles(jobId);
  return useMutation({
    mutationFn: request,
    onSuccess: (result, input) => {
      queryClient.setQueryData<SharedProfiles>(key, (sheet) => (sheet ? apply(sheet, input, result) : sheet));
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useUpdateSharedCell(jobId: string) {
  return useSheetMutation(
    jobId,
    ({ rowId, key, value }: { rowId: string; key: string; value: string }) =>
      api.patch<void>(`${base(jobId)}/rows/${seg(rowId)}`, { key, value }),
    (sheet, { rowId, key, value }) => ({
      ...sheet,
      rows: sheet.rows.map((row) => (row.id === rowId ? { ...row, values: { ...row.values, [key]: value } } : row)),
    }),
  );
}

export function useAddSharedRow(jobId: string) {
  return useSheetMutation<void, { row: SharedRow }>(
    jobId,
    () => api.post<{ row: SharedRow }>(`${base(jobId)}/rows`, {}),
    (sheet, _input, result) => ({ ...sheet, rows: [...sheet.rows, result.row] }),
  );
}

export function useDeleteSharedRow(jobId: string) {
  return useSheetMutation(
    jobId,
    (rowId: string) => api.delete<void>(`${base(jobId)}/rows/${seg(rowId)}`),
    (sheet, rowId) => ({ ...sheet, rows: sheet.rows.filter((row) => row.id !== rowId) }),
  );
}

export function useAddSharedColumn(jobId: string) {
  return useSheetMutation(
    jobId,
    (label: string) => api.post<{ column: SharedColumn }>(`${base(jobId)}/columns`, { label }),
    (sheet, _label, result) => ({ ...sheet, columns: [...sheet.columns, result.column] }),
  );
}

export function useRenameSharedColumn(jobId: string) {
  return useSheetMutation(
    jobId,
    ({ key, label }: { key: string; label: string }) => api.patch<void>(`${base(jobId)}/columns/${seg(key)}`, { label }),
    (sheet, { key, label }) => ({
      ...sheet,
      columns: sheet.columns.map((column) => (column.key === key ? { ...column, label } : column)),
    }),
  );
}

export function useDeleteSharedColumn(jobId: string) {
  return useSheetMutation(
    jobId,
    (key: string) => api.delete<void>(`${base(jobId)}/columns/${seg(key)}`),
    (sheet, key) => ({
      ...sheet,
      columns: sheet.columns.filter((column) => column.key !== key),
      rows: sheet.rows.map((row) => {
        const values = { ...row.values };
        delete values[key];
        return { ...row, values };
      }),
    }),
  );
}
