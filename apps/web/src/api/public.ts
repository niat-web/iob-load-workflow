import { useQuery } from "@tanstack/react-query";
import type { PublicPool } from "../types/api";
import { api, apiUrl, seg } from "./client";

export const publicKeys = {
  pool: (token: string) => ["public", "pool", token] as const,
};

export function fetchPublicPool(token: string, signal?: AbortSignal) {
  return api.get<PublicPool>(`/public/candidate-pools/${seg(token)}`, undefined, signal);
}

export function publicResumeUrl(token: string, ref: string): string {
  return apiUrl(`/public/candidate-pools/${seg(token)}/candidates/${seg(ref)}/resume`);
}

export function usePublicPool(token: string) {
  return useQuery({
    queryKey: publicKeys.pool(token),
    queryFn: ({ signal }) => fetchPublicPool(token, signal),
    enabled: token.length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
