import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminUser,
  AppSettings,
  AppSettingsRecord,
  AuditLogEntry,
  AuditLogFilterOptions,
  AuditLogQuery,
  BigQueryDatasets,
  BigQueryRows,
  BigQueryTables,
  EligiblePoolQuery,
  EligiblePoolStudent,
  EligiblePoolSummary,
  EligiblePoolSync,
  Paginated,
  PoolProduct,
  PoolBulkInput,
  PoolBulkResult,
  PoolStudentInput,
  Role,
} from "../types/api";
import { api, apiUrl, seg } from "./client";
import { crmKeys } from "./crm";

export const adminKeys = {
  users: () => ["admin", "users"] as const,
  pool: () => ["admin", "eligible-pool"] as const,
  poolList: (query: EligiblePoolQuery) => [...adminKeys.pool(), "list", query] as const,
  poolSummary: () => [...adminKeys.pool(), "summary"] as const,
  settings: () => ["admin", "settings"] as const,
  audit: () => ["admin", "audit"] as const,
  auditList: (query: AuditLogQuery) => [...adminKeys.audit(), "list", query] as const,
  auditFilters: () => [...adminKeys.audit(), "filters"] as const,
  bigquery: () => ["admin", "bigquery"] as const,
  bigqueryTables: (dataset: string) => [...adminKeys.bigquery(), "tables", dataset] as const,
  bigqueryRows: (dataset: string, table: string, page: number, limit: number) =>
    [...adminKeys.bigquery(), "rows", dataset, table, page, limit] as const,
};

export interface CreateUserInput {
  email: string;
  name?: string;
  role: Role;
  hubspotOwnerId?: string;
  products?: PoolProduct[];
}

export interface UpdateUserInput {
  email: string;
  name?: string;
  role?: Role;
  isActive?: boolean;
  hubspotOwnerId?: string | null;
  products?: PoolProduct[];
}

export function useAuditLogs(query: AuditLogQuery) {
  return useQuery({
    queryKey: adminKeys.auditList(query),
    queryFn: ({ signal }) => api.get<Paginated<AuditLogEntry>>("/admin/audit-logs", { ...query }, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function useAuditLogFilters() {
  return useQuery({
    queryKey: adminKeys.auditFilters(),
    queryFn: ({ signal }) => api.get<AuditLogFilterOptions>("/admin/audit-logs/filters", undefined, signal),
    staleTime: 60_000,
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: adminKeys.users(),
    queryFn: ({ signal }) => api.get<{ users: AdminUser[] }>("/admin/users", undefined, signal),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.post<{ user: AdminUser }>("/admin/users", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.users() });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, ...changes }: UpdateUserInput) =>
      api.patch<{ user: AdminUser }>(`/admin/users/${seg(email)}`, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.users() });
      void queryClient.invalidateQueries({ queryKey: crmKeys.owners() });
    },
  });
}

export function useEligiblePool(query: EligiblePoolQuery) {
  return useQuery({
    queryKey: adminKeys.poolList(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<EligiblePoolStudent>>("/admin/eligible-pool", { ...query }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useEligiblePoolSummary() {
  return useQuery({
    queryKey: adminKeys.poolSummary(),
    queryFn: ({ signal }) => api.get<EligiblePoolSummary>("/admin/eligible-pool/summary", undefined, signal),
    refetchInterval: (query) => (query.state.data?.sync?.status === "RUNNING" ? 3000 : false),
  });
}

export function useSyncEligiblePool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ sync: EligiblePoolSync }>("/admin/eligible-pool/sync", {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.pool() });
    },
  });
}

export type AppSettingsPatch = { [K in keyof AppSettings]?: Partial<AppSettings[K]> };

export function useAppSettings() {
  return useQuery({
    queryKey: adminKeys.settings(),
    queryFn: ({ signal }) => api.get<AppSettingsRecord>("/admin/settings", undefined, signal),
  });
}

export function useSaveAppSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: AppSettingsPatch) => api.patch<AppSettingsRecord>("/admin/settings", patch),
    onSuccess: (record) => {
      queryClient.setQueryData(adminKeys.settings(), record);
      void queryClient.invalidateQueries({ queryKey: crmKeys.all });
    },
  });
}

const BIGQUERY_STALE_MS = 5 * 60_000;

export function useBigQueryDatasets() {
  return useQuery({
    queryKey: adminKeys.bigquery(),
    queryFn: ({ signal }) => api.get<BigQueryDatasets>("/admin/bigquery/datasets", undefined, signal),
    staleTime: BIGQUERY_STALE_MS,
  });
}

export function useBigQueryTables(dataset: string | null) {
  return useQuery({
    queryKey: adminKeys.bigqueryTables(dataset ?? ""),
    queryFn: ({ signal }) =>
      api.get<BigQueryTables>(`/admin/bigquery/datasets/${seg(dataset ?? "")}/tables`, undefined, signal),
    enabled: Boolean(dataset),
    staleTime: BIGQUERY_STALE_MS,
  });
}

/** Download link for every row of a BigQuery table or view as CSV (streamed by the API). */
export function bigQueryExportUrl(dataset: string, table: string): string {
  return apiUrl(`/admin/bigquery/datasets/${seg(dataset)}/tables/${seg(table)}/export`);
}

export function useBigQueryRows(dataset: string | null, table: string | null, page: number, limit: number) {
  return useQuery({
    queryKey: adminKeys.bigqueryRows(dataset ?? "", table ?? "", page, limit),
    queryFn: ({ signal }) =>
      api.get<BigQueryRows>(
        `/admin/bigquery/datasets/${seg(dataset ?? "")}/tables/${seg(table ?? "")}/rows`,
        { page, limit },
        signal,
      ),
    enabled: Boolean(dataset && table),
    placeholderData: keepPreviousData,
    staleTime: BIGQUERY_STALE_MS,
  });
}

function usePoolMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.pool() });
    },
  });
}

export function useCreatePoolStudent() {
  return usePoolMutation((input: PoolStudentInput) =>
    api.post<{ student: EligiblePoolStudent }>("/admin/eligible-pool", input),
  );
}

export function useUpdatePoolStudent() {
  return usePoolMutation(({ studentId, ...changes }: PoolStudentInput & { studentId: string }) =>
    api.patch<{ student: EligiblePoolStudent }>(`/admin/eligible-pool/${seg(studentId)}`, changes),
  );
}

export function useImportPoolStudents() {
  return usePoolMutation((input: PoolBulkInput) =>
    api.post<{ result: PoolBulkResult }>("/admin/eligible-pool/bulk", input),
  );
}

export function useDeletePoolStudent() {
  return usePoolMutation((studentId: string) => api.delete<void>(`/admin/eligible-pool/${seg(studentId)}`));
}
