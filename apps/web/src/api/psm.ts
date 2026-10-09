import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type {
  Candidate,
  CandidateExtraColumn,
  CandidatePatch,
  CandidatePatchResponse,
  CandidatesQuery,
  Paginated,
  PsmApplicantsQuery,
  PsmApplicantsResponse,
  PsmColumnsResponse,
  PsmJobDetail,
  PsmJobFilters,
  PsmJobResponse,
  PsmJobRow,
  PsmJobsQuery,
  SubmitPoolResponse,
} from "../types/api";
import { api, apiUrl, seg } from "./client";

const APPLICANTS_POLL_MS = 60_000;

export const psmKeys = {
  all: ["psm"] as const,
  jobs: () => [...psmKeys.all, "jobs"] as const,
  jobList: (query: PsmJobsQuery) => [...psmKeys.jobs(), "list", query] as const,
  filters: () => [...psmKeys.all, "filters"] as const,
  job: (jobId: string) => [...psmKeys.all, "job", jobId] as const,
  candidates: (jobId: string) => [...psmKeys.job(jobId), "candidates"] as const,
  candidateList: (jobId: string, query: CandidatesQuery) => [...psmKeys.candidates(jobId), query] as const,
  applicants: (jobId: string, query: PsmApplicantsQuery) => [...psmKeys.job(jobId), "applicants", query] as const,
};

export function useSavePsmColumns(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (columns: CandidateExtraColumn[]) =>
      api.patch<PsmColumnsResponse>(`/psm/jobs/${seg(jobId)}/columns`, { columns }),
    onSuccess: ({ psmColumns }) => {
      queryClient.setQueryData<PsmJobDetail>(psmKeys.job(jobId), (job) => (job ? { ...job, psmColumns } : job));
    },
  });
}

export function useApplicants(jobId: string, query: PsmApplicantsQuery) {
  return useQuery({
    queryKey: psmKeys.applicants(jobId, query),
    queryFn: ({ signal }) =>
      api.get<PsmApplicantsResponse>(`/psm/jobs/${seg(jobId)}/applicants`, { ...query }, signal),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.windowOpen ? APPLICANTS_POLL_MS : false),
    refetchOnWindowFocus: true,
  });
}

export function applicantResumeUrl(jobId: string, studentId: string): string {
  return apiUrl(`/psm/jobs/${seg(jobId)}/applicants/${seg(studentId)}/resume`);
}

export function fetchPsmJobs(query: PsmJobsQuery, signal?: AbortSignal) {
  return api.get<Paginated<PsmJobRow>>("/psm/jobs", { ...query }, signal);
}

export function fetchPsmJobFilters(signal?: AbortSignal) {
  return api.get<PsmJobFilters>("/psm/jobs/filters", undefined, signal);
}

export function fetchPsmJob(jobId: string, signal?: AbortSignal) {
  return api.get<PsmJobDetail>(`/psm/jobs/${seg(jobId)}`, undefined, signal);
}

export function startReview(jobId: string) {
  return api.post<PsmJobResponse>(`/psm/jobs/${seg(jobId)}/start-review`);
}

export function fetchCandidates(jobId: string, query: CandidatesQuery, signal?: AbortSignal) {
  return api.get<Paginated<Candidate>>(`/psm/jobs/${seg(jobId)}/candidates`, { ...query }, signal);
}

export function updateCandidate(jobId: string, studentId: string, patch: CandidatePatch) {
  return api.patch<CandidatePatchResponse>(`/psm/jobs/${seg(jobId)}/candidates/${seg(studentId)}`, patch);
}

export function submitPool(jobId: string) {
  return api.post<SubmitPoolResponse>(`/psm/jobs/${seg(jobId)}/submit`);
}

export function candidateResumeUrl(jobId: string, studentId: string): string {
  return apiUrl(`/psm/jobs/${seg(jobId)}/candidates/${seg(studentId)}/resume`);
}

export function usePsmJobs(query: PsmJobsQuery) {
  return useQuery({
    queryKey: psmKeys.jobList(query),
    queryFn: ({ signal }) => fetchPsmJobs(query, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: "always",
    refetchInterval: (q) =>
      q.state.data?.items.some((row) => row.applicationWindow.key === "OPEN") ? APPLICANTS_POLL_MS : false,
  });
}

export function usePsmJobFilters() {
  return useQuery({
    queryKey: psmKeys.filters(),
    queryFn: ({ signal }) => fetchPsmJobFilters(signal),
    staleTime: 60_000,
  });
}

export function usePsmJob(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: psmKeys.job(jobId),
    queryFn: ({ signal }) => fetchPsmJob(jobId, signal),
    enabled,
    refetchOnWindowFocus: true,
  });
}

export function useCandidates(jobId: string, query: CandidatesQuery, enabled: boolean) {
  return useQuery({
    queryKey: psmKeys.candidateList(jobId, query),
    queryFn: ({ signal }) => fetchCandidates(jobId, query, signal),
    enabled,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });
}

export function useStartReview(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => startReview(jobId),
    onSuccess: ({ job }) => {
      queryClient.setQueryData(psmKeys.job(jobId), job);
      void queryClient.invalidateQueries({ queryKey: psmKeys.jobs() });
    },
  });
}

export interface UpdateCandidateVariables {
  studentId: string;
  patch: CandidatePatch;
}

export function useUpdateCandidate(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, patch }: UpdateCandidateVariables) => updateCandidate(jobId, studentId, patch),
    onSuccess: ({ candidate }) => {
      queryClient.setQueriesData<Paginated<Candidate>>({ queryKey: psmKeys.candidates(jobId) }, (old) =>
        old
          ? { ...old, items: old.items.map((c) => (c.studentId === candidate.studentId ? candidate : c)) }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: psmKeys.candidates(jobId) });
      void queryClient.invalidateQueries({ queryKey: psmKeys.jobs() });
    },
  });
}

export function useSubmitPool(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => submitPool(jobId),
    onSuccess: ({ job, publicLinkUrl }) => {
      queryClient.setQueryData<PsmJobDetail>(psmKeys.job(jobId), {
        ...job,
        publicLinkUrl: publicLinkUrl || job.publicLinkUrl,
      });
      void queryClient.invalidateQueries({ queryKey: psmKeys.candidates(jobId) });
      void queryClient.invalidateQueries({ queryKey: psmKeys.jobs() });
    },
  });
}

export function useRefreshReview(jobId: string) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: psmKeys.job(jobId) });
  }, [queryClient, jobId]);
}
