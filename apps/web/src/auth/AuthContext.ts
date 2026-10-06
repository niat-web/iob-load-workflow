import { createContext, useContext } from "react";
import type { User } from "../types/api";

export type AuthState =
  | { status: "loading"; user: null; error: null }
  | { status: "authenticated"; user: User; error: null }
  | { status: "unauthenticated"; user: null; error: null }
  | { status: "error"; user: null; error: unknown };

export interface AuthContextValue {
  state: AuthState;
  signIn: (user: User) => void;
  signOut: () => Promise<void>;
  reload: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
