export const pageLoaders = {
  login: () => import("./LoginPage"),
  crm: () => import("./CRMPage"),
  crmDeals: () => import("./CRMDealsPage"),
  interviews: () => import("./InterviewsPage"),
  interviewSheet: () => import("./InterviewSheetPage"),
  boost: () => import("./BoostPage"),
  deal: () => import("./DealPage"),
  eligiblePool: () => import("./EligiblePoolPage"),
  settings: () => import("./SettingsPage"),
  psmJobs: () => import("./PSMJobsPage"),
  psmReview: () => import("./PSMReviewPage"),
  psmApplicants: () => import("./PSMApplicantsPage"),
  sharedProfiles: () => import("./SharedProfilesPage"),
  jobUpdate: () => import("./JobUpdateFormPage"),
  privacy: () => import("./PrivacyPage"),
};

const NAV_PRELOADERS: Record<string, () => Promise<unknown>> = {
  "/crm": () => Promise.all([pageLoaders.crm(), pageLoaders.deal()]),
  "/crm/deals": () => Promise.all([pageLoaders.crmDeals(), pageLoaders.deal()]),
  "/crm/interviews": () => Promise.all([pageLoaders.interviews(), pageLoaders.interviewSheet()]),
  "/psm": () => Promise.all([pageLoaders.psmJobs(), pageLoaders.psmReview(), pageLoaders.psmApplicants()]),
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
