import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { createBrowserRouter, Outlet, RouterProvider, ScrollRestoration } from "react-router";
import { createQueryClient } from "./api/queryClient";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireRole } from "./auth/RequireRole";
import { RoleRedirect } from "./auth/RoleRedirect";
import { ALL_ROLES, CRM_ROLES, POOL_ROLES, PSM_ROLES } from "./auth/roles";
import { LoadingSkeleton, PageLoader } from "./components/LoadingSkeleton";
import { ToastProvider } from "./components/Toast";
import { cardClass } from "./components/ui/styles";
import { NotFoundPage } from "./pages/NotFoundPage";
import { pageLoaders } from "./pages/pageLoaders";
import { RouteErrorPage } from "./pages/RouteErrorPage";

const LoginPage = lazy(() => pageLoaders.login().then((m) => ({ default: m.LoginPage })));
const CRMPage = lazy(() => pageLoaders.crm().then((m) => ({ default: m.CRMPage })));
const CRMDealsPage = lazy(() => pageLoaders.crmDeals().then((m) => ({ default: m.CRMDealsPage })));
const InterviewsPage = lazy(() => pageLoaders.interviews().then((m) => ({ default: m.InterviewsPage })));
const InterviewSheetPage = lazy(() => pageLoaders.interviewSheet().then((m) => ({ default: m.InterviewSheetPage })));
const BoostPage = lazy(() => pageLoaders.boost().then((m) => ({ default: m.BoostPage })));
const DealPage = lazy(() => pageLoaders.deal().then((m) => ({ default: m.DealPage })));
const EligiblePoolPage = lazy(() => pageLoaders.eligiblePool().then((m) => ({ default: m.EligiblePoolPage })));
const SettingsPage = lazy(() => pageLoaders.settings().then((m) => ({ default: m.SettingsPage })));
const PSMJobsPage = lazy(() => pageLoaders.psmJobs().then((m) => ({ default: m.PSMJobsPage })));
const PSMReviewPage = lazy(() => pageLoaders.psmReview().then((m) => ({ default: m.PSMReviewPage })));
const PSMApplicantsPage = lazy(() => pageLoaders.psmApplicants().then((m) => ({ default: m.PSMApplicantsPage })));
const PrivacyPage = lazy(() => pageLoaders.privacy().then((m) => ({ default: m.PrivacyPage })));
const JobUpdateFormPage = lazy(() => pageLoaders.jobUpdate().then((m) => ({ default: m.JobUpdateFormPage })));
const SharedProfilesPage = lazy(() => pageLoaders.sharedProfiles().then((m) => ({ default: m.SharedProfilesPage })));

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
      { path: "/shared/profiles/:jobId", element: standalone(<SharedProfilesPage />) },
      { path: "/shared/profiles/:company/:jobId", element: standalone(<SharedProfilesPage />) },
      { path: "/job-update/:jobId/:token", element: standalone(<JobUpdateFormPage />) },
      { path: "/privacy", element: standalone(<PrivacyPage />) },
      {
        element: <AuthLayout />,
        children: [
          { path: "/", element: <RoleRedirect /> },
          { path: "/login", element: standalone(<LoginPage />) },
          { path: "/crm", element: internal(CRM_ROLES, <CRMPage />) },
          { path: "/crm/deals", element: internal(CRM_ROLES, <CRMDealsPage />) },
          { path: "/crm/deals/:jobId/boost", element: internal(CRM_ROLES, <BoostPage />) },
          { path: "/crm/deals/:jobId", element: internal(CRM_ROLES, <DealPage />) },
          { path: "/crm/deals/:jobId/:tab", element: internal(CRM_ROLES, <DealPage />) },
          { path: "/crm/interviews", element: internal(CRM_ROLES, <InterviewsPage />) },
          { path: "/crm/interviews/:jobId", element: internal(CRM_ROLES, <InterviewSheetPage />) },
          { path: "/admin/eligible-pool", element: internal(POOL_ROLES, <EligiblePoolPage />) },
          { path: "/settings", element: internal(ALL_ROLES, <SettingsPage />) },
          { path: "/settings/:section", element: internal(ALL_ROLES, <SettingsPage />) },
          { path: "/psm", element: internal(PSM_ROLES, <PSMJobsPage />) },
          { path: "/psm/jobs/:jobId/review", element: internal(PSM_ROLES, <PSMReviewPage />) },
          { path: "/psm/jobs/:jobId/applicants", element: internal(PSM_ROLES, <PSMApplicantsPage />) },
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
