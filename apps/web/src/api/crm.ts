import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApprovalGate,
  ApprovalResponse,
  BoostOverview,
  CheckpointSwitches,
  CompanySummary,
  CrmControls,
  CrmDealDetail,
  DealActionResponse,
  FlowMode,
  HubspotOwnersResponse,
  CrmDealFilters,
  CrmDealRow,
  CrmDealsQuery,
  DealLogsResponse,
  Paginated,
  ProcessDealResponse,
  RetryDealResponse,
} from "../types/api";
import { api, isApiError, seg } from "./client";

const POLL_INTERVAL_MS = 12_000;

export const crmKeys = {
  all: ["crm"] as const,
  deals: () => [...crmKeys.all, "deals"] as const,
  dealList: (query: CrmDealsQuery) => [...crmKeys.deals(), "list", query] as const,
  deal: (jobId: string) => [...crmKeys.deals(), "detail", jobId] as const,
  logs: (jobId: string) => [...crmKeys.deals(), "logs", jobId] as const,
  approval: (jobId: string) => [...crmKeys.deals(), "approval", jobId] as const,
  boost: (jobId: string) => [...crmKeys.deals(), "boost", jobId] as const,
  companies: () => [...crmKeys.deals(), "companies"] as const,
  owners: () => [...crmKeys.all, "hubspot-owners"] as const,
  controls: () => [...crmKeys.all, "controls"] as const,
  filters: () => [...crmKeys.all, "filters"] as const,
};

export function fetchCrmDeals(query: CrmDealsQuery, signal?: AbortSignal) {
  return api.get<Paginated<CrmDealRow>>("/crm/deals", { ...query }, signal);
}

export function fetchCrmDealFilters(signal?: AbortSignal) {
  return api.get<CrmDealFilters>("/crm/deals/filters", undefined, signal);
}

export function fetchCrmCompanies(signal?: AbortSignal) {
  return api.get<{ items: CompanySummary[] }>("/crm/companies", undefined, signal);
}

export function fetchHubspotOwners(signal?: AbortSignal) {
  return api.get<HubspotOwnersResponse>("/crm/hubspot-owners", undefined, signal);
}

export function useHubspotOwners() {
  return useQuery({
    queryKey: crmKeys.owners(),
    queryFn: ({ signal }) => fetchHubspotOwners(signal),
    staleTime: 30 * 60_000,
  });
}

export function useCrmControls() {
  return useQuery({
    queryKey: crmKeys.controls(),
    queryFn: ({ signal }) => api.get<CrmControls>("/crm/controls", undefined, signal),
  });
}

export function useCrmCompanies() {
  return useQuery({
    queryKey: crmKeys.companies(),
    queryFn: ({ signal }) => fetchCrmCompanies(signal),
  });
}

export function useUpdateCompanyControls() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { companyName: string; checkpoints: Partial<CheckpointSwitches> }) =>
      api.patch<{ companyKey: string; checkpoints: CheckpointSwitches }>("/crm/companies/controls", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: crmKeys.companies() });
    },
  });
}

export function fetchCrmDeal(jobId: string, signal?: AbortSignal) {
  return api.get<CrmDealDetail>(`/crm/deals/${seg(jobId)}`, undefined, signal);
}

export function fetchCrmDealLogs(jobId: string, signal?: AbortSignal) {
  return api.get<DealLogsResponse>(`/crm/deals/${seg(jobId)}/logs`, undefined, signal);
}

export interface ProcessDealInput {
  dealId: string;
  flowMode?: FlowMode;
  expectedPoolCount?: number;
  crmOwnerId?: string;
  profilingPocId?: string;
  iseId?: string;
}

export function processDeal(input: ProcessDealInput) {
  return api.post<ProcessDealResponse>("/crm/deals/process", input);
}

export function fetchApproval(jobId: string, signal?: AbortSignal) {
  return api.get<ApprovalResponse>(`/crm/deals/${seg(jobId)}/approval`, undefined, signal);
}

export function approveStep(jobId: string, gate: ApprovalGate) {
  return api.post<DealActionResponse>(`/crm/deals/${seg(jobId)}/approve`, { gate });
}

export function updateApprovalPlans(jobId: string, enrollPlans: string[]) {
  return api.post<ApprovalResponse>(`/crm/deals/${seg(jobId)}/approval/plans`, { enrollPlans });
}

export function stopDeal(jobId: string) {
  return api.post<DealActionResponse>(`/crm/deals/${seg(jobId)}/stop`);
}

export function deleteDeal(jobId: string) {
  return api.delete<void>(`/crm/deals/${seg(jobId)}`);
}

export function retryDeal(jobId: string) {
  return api.post<RetryDealResponse>(`/crm/deals/${seg(jobId)}/retry`);
}

export function useCrmDeals(query: CrmDealsQuery) {
  return useQuery({
    queryKey: crmKeys.dealList(query),
    queryFn: ({ signal }) => fetchCrmDeals(query, signal),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((row) => row.isActive) ? POLL_INTERVAL_MS : false),
  });
}

export function useCrmDealFilters() {
  return useQuery({
    queryKey: crmKeys.filters(),
    queryFn: ({ signal }) => fetchCrmDealFilters(signal),
    staleTime: 60_000,
  });
}

export function useCrmDeal(jobId: string | null) {
  return useQuery({
    queryKey: crmKeys.deal(jobId ?? ""),
    queryFn: ({ signal }) => fetchCrmDeal(jobId ?? "", signal),
    enabled: jobId !== null,
    refetchInterval: (q) => (q.state.data?.isActive ? POLL_INTERVAL_MS : false),
  });
}

export function useCrmDealLogs(jobId: string | null) {
  return useQuery({
    queryKey: crmKeys.logs(jobId ?? ""),
    queryFn: ({ signal }) => fetchCrmDealLogs(jobId ?? "", signal),
    enabled: jobId !== null,
  });
}

const SUBMIT_RETRY_MS = 2000;
const SUBMIT_ATTEMPTS = 5;

const isTransient = (error: unknown) => isApiError(error) && (error.status === 0 || error.status >= 500);

async function submitDeal(input: ProcessDealInput, attempt = 1): Promise<ProcessDealResponse> {
  try {
    const result = await processDeal(input);
    return attempt > 1 ? { ...result, duplicate: false } : result;
  } catch (error) {
    if (!isTransient(error) || attempt >= SUBMIT_ATTEMPTS) throw error;
    await new Promise((resolve) => setTimeout(resolve, SUBMIT_RETRY_MS));
    return submitDeal(input, attempt + 1);
  }
}

export function useProcessDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProcessDealInput) => submitDeal(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: crmKeys.deals() });
      void queryClient.invalidateQueries({ queryKey: crmKeys.filters() });
    },
  });
}

export function useRetryDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: retryDeal,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: crmKeys.deals() });
    },
  });
}

export function useApproval(jobId: string | null) {
  return useQuery({
    queryKey: crmKeys.approval(jobId ?? ""),
    queryFn: ({ signal }) => fetchApproval(jobId ?? "", signal),
    enabled: jobId !== null,
    staleTime: 0,
  });
}

export function useApproveStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, gate }: { jobId: string; gate: ApprovalGate }) => approveStep(jobId, gate),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: crmKeys.deals() });
    },
  });
}

export function useUpdateApprovalPlans(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enrollPlans: string[]) => updateApprovalPlans(jobId, enrollPlans),
    onSuccess: (data) => {
      queryClient.setQueryData(crmKeys.approval(jobId), data);
    },
  });
}

export function useStopDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => stopDeal(jobId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: crmKeys.deals() });
    },
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => deleteDeal(jobId),
    onSuccess: (_data, jobId) => {
      for (const key of [crmKeys.deal(jobId), crmKeys.logs(jobId), crmKeys.approval(jobId)]) {
        queryClient.removeQueries({ queryKey: key });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: crmKeys.deals() });
      void queryClient.invalidateQueries({ queryKey: crmKeys.filters() });
    },
  });
}

const BOOST_POLL_MS = 15_000;

export function useBoost(jobId: string) {
  return useQuery({
    queryKey: crmKeys.boost(jobId),
    queryFn: ({ signal }) => api.get<BoostOverview>(`/crm/deals/${seg(jobId)}/boost`, undefined, signal),
    refetchInterval: (q) => (q.state.data?.calls.active ? BOOST_POLL_MS : false),
  });
}

function useBoostAction(jobId: string, path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ boost: BoostOverview }>(`/crm/deals/${seg(jobId)}/boost/${path}`),
    onSuccess: ({ boost }) => {
      queryClient.setQueryData(crmKeys.boost(jobId), boost);
      void queryClient.invalidateQueries({ queryKey: crmKeys.deal(jobId) });
    },
  });
}

export const useBoostEmails = (jobId: string) => useBoostAction(jobId, "emails");
export const useBoostCalls = (jobId: string) => useBoostAction(jobId, "calls");
export const useBoostSync = (jobId: string) => useBoostAction(jobId, "calls/sync");
