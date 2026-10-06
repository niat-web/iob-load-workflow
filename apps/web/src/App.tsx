import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { createBrowserRouter, Outlet, RouterProvider, ScrollRestoration } from "react-router";
import { createQueryClient } from "./api/queryClient";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireRole } from "./auth/RequireRole";
import { RoleRedirect } from "./auth/RoleRedirect";
import { ALL_ROLES, CRM_ROLES, PSM_ROLES } from "./auth/roles";
import { LoadingSkeleton, PageLoader } from "./components/LoadingSkeleton";
import { ToastProvider } from "./components/Toast";
import { cardClass } from "./components/ui/styles";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RouteErrorPage } from "./pages/RouteErrorPage";

const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const CRMPage = lazy(() => import("./pages/CRMPage").then((m) => ({ default: m.CRMPage })));
const CRMDealsPage = lazy(() => import("./pages/CRMDealsPage").then((m) => ({ default: m.CRMDealsPage })));
const CRMCompaniesPage = lazy(() => import("./pages/CRMCompaniesPage").then((m) => ({ default: m.CRMCompaniesPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const PSMJobsPage = lazy(() => import("./pages/PSMJobsPage").then((m) => ({ default: m.PSMJobsPage })));
const PSMReviewPage = lazy(() => import("./pages/PSMReviewPage").then((m) => ({ default: m.PSMReviewPage })));
const PublicCandidatePoolPage = lazy(() =>
  import("./pages/PublicCandidatePoolPage").then((m) => ({ default: m.PublicCandidatePoolPage })),
);

function ContentFallback() {
  return (
    <div className={`${cardClass} p-6`}>
      <LoadingSkeleton lines={6} />
    </div>
  );
}

function internal(roles: typeof CRM_ROLES, page: ReactNode) {
  return (
    <RequireRole roles={roles}>
      <Suspense fallback={<ContentFallback />}>{page}</Suspense>
    </RequireRole>
  );
}

function standalone(page: ReactNode) {
  return <Suspense fallback={<PageLoader />}>{page}</Suspense>;
}

function RootLayout() {
  return (
    <>
      <ScrollRestoration getKey={(location) => location.pathname} />
      <Outlet />
    </>
  );
}

function AuthLayout() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: "/public/candidate-pool/:token", element: standalone(<PublicCandidatePoolPage />) },
      {
        element: <AuthLayout />,
        children: [
          { path: "/", element: <RoleRedirect /> },
          { path: "/login", element: standalone(<LoginPage />) },
          { path: "/crm", element: internal(CRM_ROLES, <CRMPage />) },
          { path: "/crm/deals", element: internal(CRM_ROLES, <CRMDealsPage />) },
          { path: "/crm/companies", element: internal(CRM_ROLES, <CRMCompaniesPage />) },
          { path: "/settings", element: internal(ALL_ROLES, <SettingsPage />) },
          { path: "/psm", element: internal(PSM_ROLES, <PSMJobsPage />) },
          { path: "/psm/jobs/:jobId/review", element: internal(PSM_ROLES, <PSMReviewPage />) },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
