export const JOB_STATUS = Object.freeze({
  SUBMITTED: "SUBMITTED",
  FETCHING_DEAL: "FETCHING_DEAL",
  DEAL_FETCHED: "DEAL_FETCHED",
  JOB_CREATING: "JOB_CREATING",
  JOB_CREATED: "JOB_CREATED",
  ELIGIBILITY_PROCESSING: "ELIGIBILITY_PROCESSING",
  ELIGIBLE_STUDENTS_IDENTIFIED: "ELIGIBLE_STUDENTS_IDENTIFIED",
  GRANTING_ACCESS: "GRANTING_ACCESS",
  INITIAL_NOTIFICATION_SENDING: "INITIAL_NOTIFICATION_SENDING",
  APPLICATIONS_OPEN: "APPLICATIONS_OPEN",
  REMINDER_10H_PROCESSING: "REMINDER_10H_PROCESSING",
  REMINDER_10H_SENT: "REMINDER_10H_SENT",
  REMINDER_20H_PROCESSING: "REMINDER_20H_PROCESSING",
  REMINDER_20H_SENT: "REMINDER_20H_SENT",
  APPLICATIONS_CLOSED: "APPLICATIONS_CLOSED",
  FETCHING_APPLIED_POOL: "FETCHING_APPLIED_POOL",
  APPLIED_POOL_READY: "APPLIED_POOL_READY",
  AI_ANALYSIS: "AI_ANALYSIS",
  PRIORITY_GENERATING: "PRIORITY_GENERATING",
  PRIORITY_GENERATED: "PRIORITY_GENERATED",
  READY_FOR_PSM: "READY_FOR_PSM",
  PSM_REVIEW_IN_PROGRESS: "PSM_REVIEW_IN_PROGRESS",
  PSM_REVIEW_COMPLETED: "PSM_REVIEW_COMPLETED",
  PUBLIC_LINK_GENERATED: "PUBLIC_LINK_GENERATED",
  CRM_NOTIFICATION_SENT: "CRM_NOTIFICATION_SENT",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
});

const S = JOB_STATUS;

export const STATUS_ORDER = Object.values(S).filter((status) => status !== S.FAILED && status !== S.CANCELLED);

export function statusRank(status) {
  return STATUS_ORDER.indexOf(status);
}

export const WINDOW_STATUSES = [
  S.APPLICATIONS_OPEN,
  S.REMINDER_10H_PROCESSING,
  S.REMINDER_10H_SENT,
  S.REMINDER_20H_PROCESSING,
  S.REMINDER_20H_SENT,
];

export const AI_STAGE_STATUSES = [
  S.APPLICATIONS_CLOSED,
  S.FETCHING_APPLIED_POOL,
  S.APPLIED_POOL_READY,
  S.AI_ANALYSIS,
  S.PRIORITY_GENERATING,
];

export const PSM_VISIBLE_STATUSES = STATUS_ORDER.slice(statusRank(S.APPLICATIONS_CLOSED));

export const SUBMITTED_STATUSES = [
  S.PSM_REVIEW_COMPLETED,
  S.PUBLIC_LINK_GENERATED,
  S.CRM_NOTIFICATION_SENT,
  S.COMPLETED,
];

const IDLE_STATUSES = [S.READY_FOR_PSM, S.PSM_REVIEW_IN_PROGRESS, S.COMPLETED, S.FAILED, S.CANCELLED];

export const FLOW_MODE = Object.freeze({ AUTOMATIC: "AUTOMATIC", STEP_BY_STEP: "STEP_BY_STEP" });

export const APPROVAL_GATE = Object.freeze({
  DEAL_DETAILS: "DEAL_DETAILS",
  LOAD_BETA: "LOAD_BETA",
  LOAD_PROD: "LOAD_PROD",
  ELIGIBLE_STUDENTS: "ELIGIBLE_STUDENTS",
  START_WINDOW: "START_WINDOW",
});

export const APPROVAL_GATE_LABELS = Object.freeze({
  DEAL_DETAILS: "Deal details",
  LOAD_BETA: "Load into Beta",
  LOAD_PROD: "Load into Prod",
  ELIGIBLE_STUDENTS: "Give students access",
  START_WINDOW: "Email students and start window",
});

export const loadGateFor = (environment) => `LOAD_${environment.toUpperCase()}`;

export const DISPLAY_STATUS = Object.freeze({
  PENDING: { key: "PENDING", label: "Pending", tone: "gray" },
  PROCESSING: { key: "PROCESSING", label: "Processing", tone: "orange" },
  WAITING: { key: "WAITING", label: "Waiting for Approval", tone: "yellow" },
  IN_PROGRESS: { key: "IN_PROGRESS", label: "In Progress", tone: "blue" },
  AI_ANALYSIS: { key: "AI_ANALYSIS", label: "AI Analysis", tone: "blue" },
  PSM_REVIEW: { key: "PSM_REVIEW", label: "PSM Review", tone: "purple" },
  COMPLETED: { key: "COMPLETED", label: "Completed", tone: "green" },
  FAILED: { key: "FAILED", label: "Failed", tone: "red" },
  CANCELLED: { key: "CANCELLED", label: "Stopped", tone: "gray" },
});

const META = {
  [S.SUBMITTED]: ["Submitted", "PENDING"],
  [S.FETCHING_DEAL]: ["Fetching Deal", "PROCESSING"],
  [S.DEAL_FETCHED]: ["Deal Fetched", "PROCESSING"],
  [S.JOB_CREATING]: ["Loading Job (Beta & Prod)", "PROCESSING"],
  [S.JOB_CREATED]: ["Job Loaded (Beta & Prod)", "PROCESSING"],
  [S.ELIGIBILITY_PROCESSING]: ["Finding Eligible Students", "PROCESSING"],
  [S.ELIGIBLE_STUDENTS_IDENTIFIED]: ["Eligible Students Identified", "PROCESSING"],
  [S.GRANTING_ACCESS]: ["Granting Access", "PROCESSING"],
  [S.INITIAL_NOTIFICATION_SENDING]: ["Notifying Students", "PROCESSING"],
  [S.APPLICATIONS_OPEN]: ["Application Window", "IN_PROGRESS"],
  [S.REMINDER_10H_PROCESSING]: ["10h Reminder", "IN_PROGRESS"],
  [S.REMINDER_10H_SENT]: ["Application Window", "IN_PROGRESS"],
  [S.REMINDER_20H_PROCESSING]: ["20h Reminder", "IN_PROGRESS"],
  [S.REMINDER_20H_SENT]: ["Application Window", "IN_PROGRESS"],
  [S.APPLICATIONS_CLOSED]: ["Applications Closed", "IN_PROGRESS"],
  [S.FETCHING_APPLIED_POOL]: ["Fetching Applied Pool", "IN_PROGRESS"],
  [S.APPLIED_POOL_READY]: ["Applied Pool Ready", "IN_PROGRESS"],
  [S.AI_ANALYSIS]: ["AI Analysis", "AI_ANALYSIS"],
  [S.PRIORITY_GENERATING]: ["Generating Priority", "AI_ANALYSIS"],
  [S.PRIORITY_GENERATED]: ["Priority Generated", "AI_ANALYSIS"],
  [S.READY_FOR_PSM]: ["PSM Review", "PSM_REVIEW"],
  [S.PSM_REVIEW_IN_PROGRESS]: ["PSM Review", "PSM_REVIEW"],
  [S.PSM_REVIEW_COMPLETED]: ["PSM Review Completed", "PSM_REVIEW"],
  [S.PUBLIC_LINK_GENERATED]: ["Public Link Created", "IN_PROGRESS"],
  [S.CRM_NOTIFICATION_SENT]: ["CRM Notified", "COMPLETED"],
  [S.COMPLETED]: ["Public Link Created / CRM Notified", "COMPLETED"],
  [S.CANCELLED]: ["Stopped", "CANCELLED"],
};

export function stepLabel(status) {
  return META[status]?.[0] ?? status;
}

export function effectiveStatus(job) {
  return job.status === S.FAILED ? job.failedStep ?? S.SUBMITTED : job.status;
}

export function crmDisplay(job) {
  if (job.awaitingApproval?.gate && job.status !== S.FAILED && job.status !== S.CANCELLED) {
    return {
      displayStatus: DISPLAY_STATUS.WAITING,
      currentStep: `Approve: ${APPROVAL_GATE_LABELS[job.awaitingApproval.gate] ?? job.awaitingApproval.gate}`,
    };
  }
  if (job.status === S.FAILED) {
    return {
      displayStatus: DISPLAY_STATUS.FAILED,
      currentStep: `${stepLabel(effectiveStatus(job))} (failed)`,
    };
  }
  const [step, display] = META[job.status] ?? [job.status, "PROCESSING"];
  return { displayStatus: DISPLAY_STATUS[display], currentStep: step };
}

export function isActiveStatus(status) {
  return !IDLE_STATUSES.includes(status);
}

export function statusesForDisplayKey(key) {
  if (key === "FAILED") return [S.FAILED];
  if (key === "WAITING") return [];
  return Object.entries(META)
    .filter(([, [, display]]) => display === key)
    .map(([status]) => status);
}

export const CRM_STATUS_FILTERS = Object.values(DISPLAY_STATUS).map(({ key, label }) => ({ value: key, label }));

const chip = (key, label, tone) => ({ key, label, tone });

export const PSM_CHIPS = {
  window: {
    OPEN: chip("OPEN", "Open", "blue"),
    COMPLETED: chip("COMPLETED", "Completed", "green"),
  },
  ai: {
    PENDING: chip("PENDING", "AI Pending", "gray"),
    IN_PROGRESS: chip("IN_PROGRESS", "AI In Progress", "blue"),
    COMPLETED: chip("COMPLETED", "AI Completed", "green"),
    FAILED: chip("FAILED", "AI Failed", "red"),
  },
  priority: {
    PENDING: chip("PENDING", "Pending", "gray"),
    GENERATED: chip("GENERATED", "Priority Generated", "purple"),
  },
  psm: {
    NOT_READY: chip("NOT_READY", "Not Ready", "gray"),
    READY: chip("READY", "Ready for Review", "blue"),
    UNDER_REVIEW: chip("UNDER_REVIEW", "Under Review", "orange"),
    COMPLETED: chip("COMPLETED", "Completed", "green"),
  },
  crm: {
    PENDING: chip("PENDING", "CRM Pending", "gray"),
    LINK_GENERATED: chip("LINK_GENERATED", "Link Generated", "purple"),
    SHARED: chip("SHARED", "Shared to CRM", "green"),
    FAILED: chip("FAILED", "Failed", "red"),
  },
};

const rankOf = (status) => statusRank(status);

export function aiStatusKey(job) {
  const current = effectiveStatus(job);
  if (job.status === S.FAILED && [S.AI_ANALYSIS, S.PRIORITY_GENERATING].includes(current)) return "FAILED";
  if (rankOf(current) >= rankOf(S.PRIORITY_GENERATED)) return "COMPLETED";
  if ([S.AI_ANALYSIS, S.PRIORITY_GENERATING].includes(current)) return "IN_PROGRESS";
  return "PENDING";
}

export function psmStatusKey(job) {
  const current = effectiveStatus(job);
  if (rankOf(current) >= rankOf(S.PSM_REVIEW_COMPLETED)) return "COMPLETED";
  if (current === S.PSM_REVIEW_IN_PROGRESS) return "UNDER_REVIEW";
  if (current === S.READY_FOR_PSM) return "READY";
  return "NOT_READY";
}

export function psmChips(job) {
  const current = effectiveStatus(job);
  const psmKey = psmStatusKey(job);
  const actionByPsm = {
    READY: "OPEN_REVIEW",
    UNDER_REVIEW: "CONTINUE_REVIEW",
    COMPLETED: "VIEW_POOL",
    NOT_READY: "NONE",
  };
  return {
    applicationWindow: WINDOW_STATUSES.includes(current) ? PSM_CHIPS.window.OPEN : PSM_CHIPS.window.COMPLETED,
    aiStatus: PSM_CHIPS.ai[aiStatusKey(job)],
    priorityStatus:
      rankOf(current) >= rankOf(S.PRIORITY_GENERATED) ? PSM_CHIPS.priority.GENERATED : PSM_CHIPS.priority.PENDING,
    psmStatus: PSM_CHIPS.psm[psmKey],
    crmShareStatus: PSM_CHIPS.crm[job.crmShare?.status ?? "PENDING"] ?? PSM_CHIPS.crm.PENDING,
    action: actionByPsm[psmKey],
  };
}

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);

export function psmFilterQuery({ psmStatus, priorityStatus, aiStatus }) {
  const afterPriority = STATUS_ORDER.slice(rankOf(S.PRIORITY_GENERATED));
  const failedIn = (steps) => ({ status: S.FAILED, failedStep: { $in: steps } });
  const inStatuses = (steps) => ({ $or: [{ status: { $in: steps } }, failedIn(steps)] });
  const conditions = {
    psm: {
      READY: () => inStatuses([S.READY_FOR_PSM]),
      UNDER_REVIEW: () => inStatuses([S.PSM_REVIEW_IN_PROGRESS]),
      COMPLETED: () => inStatuses(SUBMITTED_STATUSES),
    },
    priority: {
      GENERATED: () => inStatuses(afterPriority),
      PENDING: () => inStatuses(STATUS_ORDER.slice(0, rankOf(S.PRIORITY_GENERATED))),
    },
    ai: {
      COMPLETED: () => inStatuses(afterPriority),
      IN_PROGRESS: () => ({ status: { $in: [S.AI_ANALYSIS, S.PRIORITY_GENERATING] } }),
      FAILED: () => failedIn([S.AI_ANALYSIS, S.PRIORITY_GENERATING]),
      PENDING: () => inStatuses([S.APPLICATIONS_CLOSED, S.FETCHING_APPLIED_POOL, S.APPLIED_POOL_READY]),
    },
  };
  const and = [];
  for (const [group, values] of [
    ["psm", asList(psmStatus)],
    ["priority", asList(priorityStatus)],
    ["ai", asList(aiStatus)],
  ]) {
    const any = values.map((value) => conditions[group][value]?.()).filter(Boolean);
    if (any.length === 1) and.push(any[0]);
    else if (any.length > 1) and.push({ $or: any });
  }
  return and.length ? { $and: and } : {};
}

export const PSM_FILTER_OPTIONS = {
  psmStatuses: ["READY", "UNDER_REVIEW", "COMPLETED"].map((key) => ({
    value: key,
    label: PSM_CHIPS.psm[key].label,
  })),
  priorityStatuses: ["PENDING", "GENERATED"].map((key) => ({
    value: key,
    label: PSM_CHIPS.priority[key].label,
  })),
  aiStatuses: ["PENDING", "IN_PROGRESS", "COMPLETED", "FAILED"].map((key) => ({
    value: key,
    label: PSM_CHIPS.ai[key].label,
  })),
};

export const TASK_TYPE = Object.freeze({
  FETCH_DEAL: "FETCH_DEAL",
  CREATE_JOB: "CREATE_JOB",
  IDENTIFY_ELIGIBLE: "IDENTIFY_ELIGIBLE",
  GRANT_ACCESS: "GRANT_ACCESS",
  SEND_INITIAL_NOTIFICATIONS: "SEND_INITIAL_NOTIFICATIONS",
  APPLICATION_COUNT_SYNC: "APPLICATION_COUNT_SYNC",
  REMINDER_10H: "REMINDER_10H",
  REMINDER_20H: "REMINDER_20H",
  APPLICATION_CLOSE_21H: "APPLICATION_CLOSE_21H",
  FETCH_FINAL_POOL: "FETCH_FINAL_POOL",
  AI_ANALYSIS: "AI_ANALYSIS",
  PRIORITY_GENERATION: "PRIORITY_GENERATION",
  CRM_NOTIFICATION: "CRM_NOTIFICATION",
  RETRY_NOTIFICATION: "RETRY_NOTIFICATION",
  CALL_RESULTS_SYNC: "CALL_RESULTS_SYNC",
  HUBSPOT_DEAL_UPDATE: "HUBSPOT_DEAL_UPDATE",
  HUBSPOT_WRITE_BACK: "HUBSPOT_WRITE_BACK",
  POOL_TARGET_EMAIL: "POOL_TARGET_EMAIL",
});

export const CRITICAL_TASKS = new Set([
  TASK_TYPE.FETCH_DEAL,
  TASK_TYPE.CREATE_JOB,
  TASK_TYPE.IDENTIFY_ELIGIBLE,
  TASK_TYPE.GRANT_ACCESS,
  TASK_TYPE.SEND_INITIAL_NOTIFICATIONS,
  TASK_TYPE.APPLICATION_CLOSE_21H,
  TASK_TYPE.FETCH_FINAL_POOL,
  TASK_TYPE.AI_ANALYSIS,
  TASK_TYPE.PRIORITY_GENERATION,
  TASK_TYPE.CRM_NOTIFICATION,
]);

export const NOTIFICATION_TYPE = Object.freeze({
  INITIAL_JOB_EMAIL: "INITIAL_JOB_EMAIL",
  REMINDER_10H: "REMINDER_10H",
  REMINDER_20H: "REMINDER_20H",
  JOB_UPDATED: "JOB_UPDATED",
  CRM_POOL_READY: "CRM_POOL_READY",
  POOL_TARGET_REACHED: "POOL_TARGET_REACHED",
  BOOST_REMINDER: "BOOST_REMINDER",
});

export const CANDIDATE_STATUS = ["RECOMMENDED", "CONSIDER", "NOT_RECOMMENDED"];
export const ROLES = ["CRM", "PSM", "ADMIN"];
