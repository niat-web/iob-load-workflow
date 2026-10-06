import { useMutation } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { devLogin, loginWithMicrosoft, useAuthConfig } from "../api/auth";
import { errorMessage, hasStatus } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { canAccessPath, homePathFor, isSafeInternalPath } from "../auth/roles";
import { DevLoginForm } from "../components/DevLoginForm";
import { ErrorState } from "../components/ErrorState";
import { MicrosoftSignInButton } from "../components/MicrosoftSignInButton";
import { PageLoader, Skeleton } from "../components/LoadingSkeleton";
import { Button } from "../components/ui/Button";
import { cardClass } from "../components/ui/styles";
import type { LoginResponse, User } from "../types/api";
import { cn } from "../utils/cn";
import { AccessDenied } from "./AccessDenied";

type LoginInput = { kind: "microsoft"; idToken: string } | { kind: "dev"; email: string };

function login(input: LoginInput): Promise<LoginResponse> {
  return input.kind === "microsoft" ? loginWithMicrosoft(input.idToken) : devLogin(input.email);
}

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
  const handleIdToken = useCallback((idToken: string) => mutate({ kind: "microsoft", idToken }), [mutate]);

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

    const { microsoftClientId, microsoftTenantId, devLoginEnabled } = config.data;
    return (
      <div className="space-y-5">
        {microsoftClientId && microsoftTenantId ? (
          <MicrosoftSignInButton
            clientId={microsoftClientId}
            tenantId={microsoftTenantId}
            disabled={mutation.isPending}
            onIdToken={handleIdToken}
          />
        ) : (
          <div className="space-y-1.5 text-center">
            <Button variant="secondary" className="w-full" disabled>
              Sign in with Microsoft
            </Button>
            <p className="text-xs text-muted">Microsoft sign-in is not set up yet.</p>
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
        <div className="border-t pt-5">
          {devLoginEnabled ? (
            <DevLoginForm
              pending={mutation.isPending && mutation.variables.kind === "dev"}
              onSubmit={(email) => mutate({ kind: "dev", email })}
            />
          ) : (
            <p className="text-center text-xs text-muted">Email sign-in is turned off.</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <h1 className="sr-only">Sign in</h1>
      <div className={cn(cardClass, "w-full max-w-sm p-8")}>{renderContent()}</div>
    </main>
  );
}
