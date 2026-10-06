import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { AppShell } from "../components/AppShell";
import { ErrorState } from "../components/ErrorState";
import { PageLoader } from "../components/LoadingSkeleton";
import { buttonClass } from "../components/ui/Button";
import { cardClass } from "../components/ui/styles";
import { AccessDenied } from "../pages/AccessDenied";
import type { Role } from "../types/api";
import { useAuth } from "./AuthContext";
import { homePathFor } from "./roles";

interface RequireRoleProps {
  roles: readonly Role[];
  children: ReactNode;
}

export function RequireRole({ roles, children }: RequireRoleProps) {
  const { state, reload } = useAuth();
  const location = useLocation();

  if (state.status === "loading") return <PageLoader />;

  if (state.status === "error") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
        <ErrorState
          error={state.error}
          message="Unable to verify your session. Check your connection and try again."
          onRetry={reload}
        />
      </div>
    );
  }

  if (state.status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  const { user } = state;
  if (!roles.includes(user.role)) {
    const home = homePathFor(user.role);
    return (
      <AppShell user={user}>
        <div className={cardClass}>
          <AccessDenied
            message={`${user.email} does not have access to this page.`}
            action={
              home !== location.pathname ? (
                <Link to={home} className={buttonClass("secondary", "sm")}>
                  Go to my dashboard
                </Link>
              ) : undefined
            }
          />
        </div>
      </AppShell>
    );
  }

  return <AppShell user={user}>{children}</AppShell>;
}
