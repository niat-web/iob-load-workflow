import { useMutation } from "@tanstack/react-query";
import { BriefcaseBusiness, ChartColumn, LoaderCircle, Sparkles, UsersRound, type LucideIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { devLogin, loginWithGoogle, useAuthConfig } from "../api/auth";
import { errorMessage, hasStatus } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { canAccessPath, homePathFor, isSafeInternalPath } from "../auth/roles";
import { DevLoginForm } from "../components/DevLoginForm";
import { ErrorState } from "../components/ErrorState";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { PageLoader, Skeleton } from "../components/LoadingSkeleton";
import { Button } from "../components/ui/Button";
import type { LoginResponse, User } from "../types/api";
import { AccessDenied } from "./AccessDenied";

type LoginInput = { kind: "google"; credential: string } | { kind: "dev"; email: string };

function login(input: LoginInput): Promise<LoginResponse> {
  return input.kind === "google" ? loginWithGoogle(input.credential) : devLogin(input.email);
}

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: BriefcaseBusiness, title: "Deals to jobs", text: "HubSpot deals loaded to Beta and Prod with one job ID." },
  { icon: UsersRound, title: "Eligible students", text: "Access, emails and reminders handled automatically." },
  { icon: Sparkles, title: "AI-ranked candidates", text: "Resumes scored against each job for PSM review." },
];

function readFrom(state: unknown): string | null {
  if (state && typeof state === "object" && "from" in state) {
    const { from } = state as { from: unknown };
    if (isSafeInternalPath(from)) return from;
  }
  return null;
}

function destinationFor(user: User, from: string | null, redirectTo?: string): string {
  if (from && canAccessPath(user.role, from)) return from;
  if (isSafeInternalPath(redirectTo)) return redirectTo;
  return homePathFor(user.role);
}

export function LoginPage() {
  const { state, signIn } = useAuth();
  const location = useLocation();
  const from = readFrom(location.state);
  const config = useAuthConfig();
  const [destination, setDestination] = useState<string | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: login,
    onMutate: () => {
      setError(null);
      setDenied(null);
    },
    onSuccess: ({ user, redirectTo }) => {
      setDestination(destinationFor(user, from, redirectTo));
      signIn(user);
    },
    onError: (err) => {
      if (hasStatus(err, 403)) {
        setDenied(errorMessage(err, "Your account does not have access to this application."));
      } else {
        setError(errorMessage(err, "Sign-in failed. Please try again."));
      }
    },
  });

  const { mutate } = mutation;
  const handleCredential = useCallback((credential: string) => mutate({ kind: "google", credential }), [mutate]);

  if (state.status === "authenticated") {
    return <Navigate to={destination ?? destinationFor(state.user, from)} replace />;
  }
  if (state.status === "loading") return <PageLoader />;

  const renderContent = () => {
    if (config.isPending) {
      return (
        <div role="status" aria-label="Loading sign-in options" className="flex justify-center">
          <Skeleton className="h-10 w-[280px] rounded-md" />
        </div>
      );
    }
    if (config.isError) {
      return (
        <ErrorState
          className="py-4"
          error={config.error}
          message="Sign-in options could not be loaded."
          onRetry={() => void config.refetch()}
          retrying={config.isFetching}
        />
      );
    }
    if (denied) {
      return (
        <AccessDenied
          className="py-2"
          message={denied}
          action={
            <Button variant="secondary" size="sm" onClick={() => setDenied(null)}>
              Try a different account
            </Button>
          }
        />
      );
    }

    const { googleClientId, devLoginEnabled } = config.data;
    return (
      <div className="space-y-6">
        {devLoginEnabled ? (
          <DevLoginForm
            pending={mutation.isPending && mutation.variables.kind === "dev"}
            onSubmit={(email) => mutate({ kind: "dev", email })}
          />
        ) : (
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-center text-sm text-muted">Email sign-in is turned off.</p>
        )}

        <div className="flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-line" />
          <span className="text-xs font-semibold tracking-wider text-muted uppercase">or</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        {googleClientId ? (
          <GoogleSignInButton clientId={googleClientId} disabled={mutation.isPending} onCredential={handleCredential} />
        ) : (
          <div className="space-y-1.5 text-center">
            <Button variant="secondary" className="h-11 w-full" disabled>
              Sign in with Google
            </Button>
            <p className="text-xs text-muted">Google sign-in is not set up yet.</p>
          </div>
        )}

        {mutation.isPending && (
          <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Signing in…
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-center text-sm font-medium text-red-700">
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <main className="flex min-h-dvh bg-surface">
      <h1 className="sr-only">Sign in</h1>
      <section
        aria-label="About Job Flow Automation"
        className="hidden w-[44%] max-w-[640px] flex-col justify-between bg-ink px-12 py-12 text-white lg:flex"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary">
            <ChartColumn className="size-6" strokeWidth={2.4} aria-hidden />
          </span>
          <span className="text-lg font-bold tracking-tight">Job Flow Automation</span>
        </div>

        <div className="max-w-md">
          <p className="text-[32px] leading-tight font-bold tracking-tight">From HubSpot deal to shortlisted candidates.</p>
          <p className="mt-4 text-base text-slate-300">
            Load jobs to the Learning Portal, reach eligible students, and review AI-ranked applicants in one place.
          </p>
          <ul className="mt-10 space-y-5">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="size-5 text-white" aria-hidden />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="mt-0.5 block text-sm text-slate-300">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-slate-400">Access is limited to people added by an admin.</p>
      </section>

      <section className="flex flex-1 items-center justify-center bg-canvas px-4 py-10 sm:px-8 lg:bg-surface">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-white">
              <ChartColumn className="size-5" strokeWidth={2.4} aria-hidden />
            </span>
            <span className="text-base font-bold text-ink">Job Flow Automation</span>
          </div>
          <div className="rounded-2xl border bg-surface p-6 shadow-card sm:p-8 lg:border-0 lg:p-0 lg:shadow-none">
            <h2 className="text-2xl font-bold tracking-tight text-ink">Sign in</h2>
            <p className="mt-1.5 mb-8 text-sm text-muted">Use your company account to continue.</p>
            {renderContent()}
          </div>
        </div>
      </section>
    </main>
  );
}
