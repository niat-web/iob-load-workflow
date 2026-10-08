import { useQuery } from "@tanstack/react-query";
import type { AuthConfig, LoginResponse, MeResponse } from "../types/api";
import { api } from "./client";

export const authKeys = {
  config: ["auth", "config"] as const,
};

export function fetchAuthConfig(signal?: AbortSignal): Promise<AuthConfig> {
  return api.get<AuthConfig>("/auth/config", undefined, signal);
}

export function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  return api.get<MeResponse>("/auth/me", undefined, signal);
}

export function loginWithGoogle(credential: string): Promise<LoginResponse> {
  return api.post<LoginResponse>("/auth/google", { credential });
}

export function devLogin(email: string): Promise<LoginResponse> {
  return api.post<LoginResponse>("/auth/dev-login", { email });
}

export function logout(): Promise<void> {
  return api.post<void>("/auth/logout");
}

export function useAuthConfig() {
  return useQuery({
    queryKey: authKeys.config,
    queryFn: ({ signal }) => fetchAuthConfig(signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
