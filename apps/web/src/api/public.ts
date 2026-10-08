import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JobUpdateAnswer, JobUpdateForm } from "../types/api";
import { api, seg } from "./client";

export const publicKeys = {
  jobUpdate: (token: string, userId: string) => ["public", "job-update", token, userId] as const,
};

export function useJobUpdateForm(token: string, userId: string, jobId: string) {
  return useQuery({
    queryKey: publicKeys.jobUpdate(token, userId),
    queryFn: ({ signal }) =>
      api.get<JobUpdateForm>(`/public/job-updates/${seg(token)}`, { user_id: userId, job_id: jobId || undefined }, signal),
    enabled: token.length > 0 && userId.length > 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useSubmitJobUpdate(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answer: JobUpdateAnswer) =>
      api.post<{ response: JobUpdateForm["response"] }>(`/public/job-updates/${seg(token)}`, answer),
    onSuccess: (result, answer) => {
      queryClient.setQueryData<JobUpdateForm>(publicKeys.jobUpdate(token, answer.userId), (current) =>
        current ? { ...current, response: result.response } : current,
      );
    },
  });
}
