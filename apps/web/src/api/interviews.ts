import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GoogleConnectionStatus,
  InterviewColumn,
  InterviewCompany,
  InterviewSheet,
  MeetRequest,
  MeetResponse,
  SharedRow,
} from "../types/api";
import { api, apiUrl, seg } from "./client";

export const interviewKeys = {
  all: ["interviews"] as const,
  companies: () => [...interviewKeys.all, "companies"] as const,
  sheet: (jobId: string) => [...interviewKeys.all, "sheet", jobId] as const,
  google: () => [...interviewKeys.all, "google"] as const,
};

export function googleConnectUrl(returnTo: string): string {
  return apiUrl("/interviews/google/connect", { returnTo });
}

export function useGoogleConnection() {
  return useQuery({
    queryKey: interviewKeys.google(),
    queryFn: ({ signal }) => api.get<GoogleConnectionStatus>("/interviews/google", undefined, signal),
  });
}

export function useDisconnectGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>("/interviews/google"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: interviewKeys.all });
    },
  });
}

const base = (jobId: string) => `/interviews/jobs/${seg(jobId)}`;

export function useInterviewCompanies() {
  return useQuery({
    queryKey: interviewKeys.companies(),
    queryFn: ({ signal }) => api.get<{ items: InterviewCompany[] }>("/interviews/companies", undefined, signal),
  });
}

export function useInterviewSheet(jobId: string) {
  return useQuery({
    queryKey: interviewKeys.sheet(jobId),
    queryFn: ({ signal }) => api.get<InterviewSheet>(base(jobId), undefined, signal),
    enabled: jobId.length > 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

function useSheetMutation<TInput, TResult>(
  jobId: string,
  request: (input: TInput) => Promise<TResult>,
  apply: (sheet: InterviewSheet, input: TInput, result: TResult) => InterviewSheet,
) {
  const queryClient = useQueryClient();
  const key = interviewKeys.sheet(jobId);
  return useMutation({
    mutationFn: request,
    onSuccess: (result, input) => {
      queryClient.setQueryData<InterviewSheet>(key, (sheet) => (sheet ? apply(sheet, input, result) : sheet));
      void queryClient.invalidateQueries({ queryKey: interviewKeys.companies() });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useUpdateInterviewCell(jobId: string) {
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

export function useAddInterviewRow(jobId: string) {
  return useSheetMutation(
    jobId,
    () => api.post<{ row: SharedRow }>(`${base(jobId)}/rows`, { values: {} }),
    (sheet, _input, result) => ({
      ...sheet,
      rows: [
        ...sheet.rows,
        {
          ...result.row,
          studentName: "",
          meet: null,
          values: Object.fromEntries(sheet.columns.map((column) => [column.key, result.row.values[column.key] ?? ""])),
        },
      ],
    }),
  );
}

export function useDeleteInterviewRow(jobId: string) {
  return useSheetMutation(
    jobId,
    (rowId: string) => api.delete<void>(`${base(jobId)}/rows/${seg(rowId)}`),
    (sheet, rowId) => ({ ...sheet, rows: sheet.rows.filter((row) => row.id !== rowId) }),
  );
}

export function useAddInterviewColumn(jobId: string) {
  return useSheetMutation(
    jobId,
    (label: string) => api.post<{ column: InterviewColumn }>(`${base(jobId)}/columns`, { label }),
    (sheet, _label, result) => ({ ...sheet, columns: [...sheet.columns, result.column] }),
  );
}

export function useRenameInterviewColumn(jobId: string) {
  return useSheetMutation(
    jobId,
    ({ key, label }: { key: string; label: string }) => api.patch<void>(`${base(jobId)}/columns/${seg(key)}`, { label }),
    (sheet, { key, label }) => ({
      ...sheet,
      columns: sheet.columns.map((column) => (column.key === key ? { ...column, label } : column)),
    }),
  );
}

export function useDeleteInterviewColumn(jobId: string) {
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

export function useSaveInterviewers(jobId: string) {
  return useSheetMutation(
    jobId,
    (emails: string[]) => api.patch<{ interviewerEmails: string[] }>(`${base(jobId)}/interviewers`, { emails }),
    (sheet, _emails, result) => ({ ...sheet, interviewerEmails: result.interviewerEmails }),
  );
}

export function useCreateMeet(jobId: string) {
  return useSheetMutation(
    jobId,
    ({ rowId, body }: { rowId: string; body: MeetRequest }) =>
      api.post<MeetResponse>(`${base(jobId)}/rows/${seg(rowId)}/meet`, body),
    (sheet, { rowId, body }, result) => ({
      ...sheet,
      interviewerEmails: body.saveInterviewers ? body.interviewerEmails : sheet.interviewerEmails,
      rows: sheet.rows.map((row) =>
        row.id === rowId ? { ...row, meet: result.meet, values: { ...row.values, ...result.values } } : row,
      ),
    }),
  );
}
