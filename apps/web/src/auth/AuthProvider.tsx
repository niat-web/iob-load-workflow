import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchMe, logout } from "../api/auth";
import { hasStatus, onUnauthorized } from "../api/client";
import type { User } from "../types/api";
import { AuthContext, type AuthContextValue, type AuthState } from "./AuthContext";

const LOADING: AuthState = { status: "loading", user: null, error: null };
const SIGNED_OUT: AuthState = { status: "unauthenticated", user: null, error: null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(LOADING);

  const checkSession = useCallback((signal?: AbortSignal) => {
    fetchMe(signal)
      .then(({ user }) => setState({ status: "authenticated", user, error: null }))
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        if (hasStatus(error, 401)) setState(SIGNED_OUT);
        else setState({ status: "error", user: null, error });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    checkSession(controller.signal);
    return () => controller.abort();
  }, [checkSession]);

  useEffect(
    () =>
      onUnauthorized(() => {
        setState((current) => (current.status === "unauthenticated" ? current : SIGNED_OUT));
      }),
    [],
  );

  const signIn = useCallback((user: User) => {
    setState({ status: "authenticated", user, error: null });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
    }
    queryClient.clear();
    setState(SIGNED_OUT);
  }, [queryClient]);

  const reload = useCallback(() => {
    setState(LOADING);
    checkSession();
  }, [checkSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, signOut, reload }),
    [state, signIn, signOut, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
