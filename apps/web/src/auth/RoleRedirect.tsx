import { Navigate } from "react-router";
import { ErrorState } from "../components/ErrorState";
import { PageLoader } from "../components/LoadingSkeleton";
import { useAuth } from "./AuthContext";
import { homePathFor } from "./roles";

export function RoleRedirect() {
  const { state, reload } = useAuth();

  if (state.status === "loading") return <PageLoader />;
  if (state.status === "error") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
        <ErrorState error={state.error} message="Unable to verify your session." onRetry={reload} />
      </div>
    );
  }
  if (state.status === "unauthenticated") return <Navigate to="/login" replace />;
  return <Navigate to={homePathFor(state.user.role)} replace />;
}
