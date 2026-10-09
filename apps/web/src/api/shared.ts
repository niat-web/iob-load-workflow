import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SharedProfiles } from "../types/api";
import { api, apiUrl, seg } from "./client";

export const sharedKeys = {
  profiles: (jobId: string) => ["shared", "profiles", jobId] as const,
};

const base = (jobId: string) => `/shared/profiles/${seg(jobId)}`;

export function sharedResumeUrl(jobId: string, ref: string): string {
  return apiUrl(`${base(jobId)}/resumes/${seg(ref)}`);
}

export function useSharedProfiles(jobId: string) {
  return useQuery({
    queryKey: sharedKeys.profiles(jobId),
    queryFn: ({ signal }) => api.get<SharedProfiles>(base(jobId), undefined, signal),
    enabled: jobId.length > 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useUpdateSharedCell(jobId: string) {
  const queryClient = useQueryClient();
  const key = sharedKeys.profiles(jobId);
  return useMutation({
    mutationFn: ({ rowId, key: column, value }: { rowId: string; key: string; value: string }) =>
      api.patch<void>(`${base(jobId)}/rows/${seg(rowId)}`, { key: column, value }),
    onSuccess: (_result, { rowId, key: column, value }) => {
      queryClient.setQueryData<SharedProfiles>(key, (sheet) =>
        sheet
          ? {
              ...sheet,
              rows: sheet.rows.map((row) => (row.id === rowId ? { ...row, values: { ...row.values, [column]: value } } : row)),
            }
          : sheet,
      );
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
