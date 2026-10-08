import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchMe, logout } from "../api/auth";
import { hasStatus, onUnauthorized } from "../api/client";
import type { User } from "../types/api";
import { AuthContext, type AuthContextValue, type AuthState } from "./AuthContext";

const LOADING: AuthState = { status: "loading", user: null, error: null };
const SIGNED_OUT: AuthState = { status: "unauthenticated", user: null, error: null };
const SESSION_RETRIES = 10;
const SESSION_RETRY_MS = 3000;

const serverStarting = (error: unknown) =>
  !hasStatus(error, 400, 401, 403, 404, 409, 410, 429) && !(error instanceof DOMException && error.name === "AbortError");

function loadSession(setState: (state: AuthState) => void, signal?: AbortSignal, attempt = 0) {
  fetchMe(signal)
    .then(({ user }) => setState({ status: "authenticated", user, error: null }))
    .catch((error: unknown) => {
      if (signal?.aborted) return;
      if (hasStatus(error, 401)) {
        setState(SIGNED_OUT);
        return;
      }
      if (attempt < SESSION_RETRIES && serverStarting(error)) {
        const timer = window.setTimeout(() => loadSession(setState, signal, attempt + 1), SESSION_RETRY_MS);
        signal?.addEventListener("abort", () => window.clearTimeout(timer), { once: true });
        return;
      }
      setState({ status: "error", user: null, error });
    });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(LOADING);

  const checkSession = useCallback((signal?: AbortSignal) => loadSession(setState, signal), []);

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
