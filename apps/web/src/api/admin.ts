import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminUser, Role } from "../types/api";
import { api, seg } from "./client";
import { crmKeys } from "./crm";

export const adminKeys = {
  users: () => ["admin", "users"] as const,
};

export interface CreateUserInput {
  email: string;
  name?: string;
  role: Role;
  hubspotOwnerId?: string;
}

export interface UpdateUserInput {
  email: string;
  name?: string;
  role?: Role;
  isActive?: boolean;
  hubspotOwnerId?: string | null;
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
