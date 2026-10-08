export const pageLoaders = {
  login: () => import("./LoginPage"),
  crm: () => import("./CRMPage"),
  crmDeals: () => import("./CRMDealsPage"),
  crmCompanies: () => import("./CRMCompaniesPage"),
  boost: () => import("./BoostPage"),
  eligiblePool: () => import("./EligiblePoolPage"),
  settings: () => import("./SettingsPage"),
  psmJobs: () => import("./PSMJobsPage"),
  psmReview: () => import("./PSMReviewPage"),
  publicPool: () => import("./PublicCandidatePoolPage"),
};

const NAV_PRELOADERS: Record<string, () => Promise<unknown>> = {
  "/crm": pageLoaders.crm,
  "/crm/deals": pageLoaders.crmDeals,
  "/crm/companies": pageLoaders.crmCompanies,
  "/psm": () => Promise.all([pageLoaders.psmJobs(), pageLoaders.psmReview()]),
  "/admin/eligible-pool": pageLoaders.eligiblePool,
  "/settings": pageLoaders.settings,
};

const started = new Set<string>();

export function preloadPage(path: string) {
  const load = NAV_PRELOADERS[path];
  if (!load || started.has(path)) return;
  started.add(path);
  load().catch(() => started.delete(path));
}

export function preloadPagesWhenIdle(paths: string[]) {
  const run = () => {
    for (const path of paths) preloadPage(path);
  };
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: 3000 });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(run, 1500);
  return () => window.clearTimeout(timer);
}
