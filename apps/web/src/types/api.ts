export type Tone = "green" | "blue" | "purple" | "orange" | "yellow" | "gray" | "red";

export interface Chip {
  key: string;
  label: string;
  tone: Tone;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: Pagination;
}

export interface FilterOption {
  value: string;
  label: string;
}

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_DEAL_ID"
  | "UNAUTHENTICATED"
  | "INVALID_GOOGLE_TOKEN"
  | "ACCESS_DENIED"
  | "FORBIDDEN"
  | "CSRF_REJECTED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "REVIEW_FROZEN"
  | "NOT_RETRYABLE"
  | "LINK_EXPIRED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "GOOGLE_NOT_CONFIGURED"
  | "GOOGLE_UNAVAILABLE";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type Role = "CRM" | "PSM" | "ADMIN" | "POOL_MANAGER";

export interface HubspotOwner {
  id: string;
  name: string;
  email: string | null;
}

export interface HubspotOwnersResponse {
  owners: HubspotOwner[];
  defaultOwnerId: string | null;
}

export interface AdminUser {
  email: string;
  name: string;
  role: Role;
  products: PoolProduct[];
  isActive: boolean;
  hubspotOwner: HubspotOwner | null;
  lastLoginAt: string | null;
  createdAt: string | null;
}

export interface User {
  email: string;
  name: string;
  role: Role;
  products: PoolProduct[];
  picture: string | null;
  hubspotOwner: HubspotOwner | null;
}

export interface AuthConfig {
  googleClientId: string | null;
  devLoginEnabled: boolean;
  emailCodeEnabled: boolean;
}

export interface EmailCodeSent {
  sent: boolean;
  expiresInMinutes: number;
  resendAfterSeconds: number;
}

export interface LoginResponse {
  user: User;
  redirectTo: string;
}

export interface MeResponse {
  user: User;
}

export type CrmDisplayStatusKey =
  | "PENDING"
  | "PROCESSING"
  | "IN_PROGRESS"
  | "AI_ANALYSIS"
  | "PSM_REVIEW"
  | "COMPLETED"
  | "FAILED";

export type FlowMode = "AUTOMATIC" | "STEP_BY_STEP";

export type ApprovalGate = "DEAL_DETAILS" | "LOAD_BETA" | "LOAD_PROD" | "ELIGIBLE_STUDENTS" | "START_WINDOW";

export interface AwaitingApproval {
  gate: ApprovalGate;
  label: string;
  requestedAt: string | null;
}

export interface CheckpointSwitches {
  firstEmails: boolean;
  secondEmails: boolean;
  secondCalls: boolean;
}

export interface CompanySummary {
  name: string;
  companyKey: string;
  checkpoints: CheckpointSwitches;
  deals: number;
  inProgress: number;
  waiting: number;
  completed: number;
  failed: number;
  stopped: number;
  lastUpdated: string | null;
}

export interface CrmDealRow {
  id: string;
  hubspotDealId: string;
  companyName: string | null;
  jobRole: string | null;
  expectedPoolCount: number | null;
  appliedCount: number;
  progressPercent: number;
  status: string;
  displayStatus: Chip;
  currentStep: string;
  publicLinkUrl: string | null;
  flowMode: FlowMode;
  awaitingApproval: AwaitingApproval | null;
  isActive: boolean;
  canRetry: boolean;
  canStop: boolean;
  canDelete: boolean;
  lastError: string | null;
  updatedAt: string;
}

export type ReminderStatus = "SENT" | "SKIPPED" | "FAILED";

export interface ReminderInfo {
  status: ReminderStatus;
  at: string;
  emailCount: number;
  callCount: number;
  reason: string | null;
}

export interface TimelineEntry {
  status: string;
  label: string;
  at: string;
}

export type HubspotWriteBack = "PENDING" | "DONE" | "FAILED" | "SKIPPED";

export interface LearningPortalInfo {
  jobId: string | null;
  organisationId: string | null;
  order: number | null;
  environments: { name: string; loadedAt: string | null }[];
  hubspotWriteBack: HubspotWriteBack;
}

export interface ApprovalRecord {
  gate: ApprovalGate;
  label: string;
  by: string | null;
  at: string | null;
}

export interface CrmDealDetail extends CrmDealRow {
  hubspotRecordUrl: string | null;
  ingestedAt: string | null;
  companyWebsite: string | null;
  companyLinkedin: string | null;
  companyLogoUrl: string | null;
  jdCount: number | null;
  jobType: string | null;
  experienceType: string | null;
  jobSource: string | null;
  applicationMode: string | null;
  internshipDuration: string | null;
  enrollPlans: string[];
  eligibility: string | null;
  compensationDescription: string | null;
  deadline: string | null;
  approvals: ApprovalRecord[];
  cancelledBy: string | null;
  cancelledAt: string | null;
  learningPortal: LearningPortalInfo;
  learningPortalJobUrl: string | null;
  location: string | null;
  ctc: string | null;
  employmentType: string | null;
  openings: number | null;
  skills: string[];
  batch: string | null;
  campus: string | null;
  program: string | null;
  crmOwnerId: string | null;
  crmOwnerName: string | null;
  crmOwnerEmail: string | null;
  profilingPoc: HubspotOwner | null;
  ise: HubspotOwner | null;
  eligibleCount: number;
  applicationStartAt: string | null;
  applicationEndAt: string | null;
  poolTargetReached: boolean;
  reminders: {
    r10h: ReminderInfo | null;
    r20h: ReminderInfo | null;
  };
  timeline: TimelineEntry[];
  createdAt: string;
}

export type CrmSort =
  | "updatedAt:desc"
  | "updatedAt:asc"
  | "companyName:asc"
  | "companyName:desc"
  | "progressPercent:desc";

export interface CrmDealsQuery {
  search?: string;
  status?: string;
  company?: string;
  page?: number;
  limit?: number;
  sort?: CrmSort;
}

export interface CrmDealFilters {
  companies: string[];
  statuses: FilterOption[];
}

export interface PreviewItem {
  label: string;
  value: string | null;
  href?: string;
  wide?: boolean;
  image?: boolean;
}

export interface LoadPreview {
  environment: string;
  canEditPlans: boolean;
  planOptions: string[];
  enrollPlans: string[];
  jobId: string | null;
  organisation: { id: string | null; name: string | null; existsInPortal: boolean; source: string | null };
  applyLink: string | null;
  testAccounts: number;
  loadedIn: { name: string; loadedAt: string | null }[];
  details: PreviewItem[];
  eligibility: { plans: string[]; text: string }[];
  disclaimer: string;
  organisationDescription: string;
}

export interface ApprovalPreview {
  gate: ApprovalGate;
  label: string;
  description: string;
  requestedAt: string | null;
  deal?: PreviewItem[];
  load?: LoadPreview;
  students?: { total: number; withEmail: number; withPhone: number; accessEnvironment: string };
  window?: {
    granted: number;
    rejected: number;
    emails: number;
    windowHours: number;
    reminderHours: number[];
    closesAt: string | null;
    studentEmailsOn: boolean;
  };
}

export interface ApprovalResponse {
  approval: ApprovalPreview;
}

export interface DealActionResponse {
  job: CrmDealRow;
}

export interface ProcessDealResponse {
  job: CrmDealRow;
  duplicate: boolean;
}

export interface RetryDealResponse {
  job: CrmDealRow;
}

export type LogLevel = "info" | "warn" | "error";
export type LogType = "status" | "task" | "notification" | "call" | "audit";

export interface DealLogEntry {
  at: string;
  level: LogLevel;
  type: LogType;
  message: string;
}

export interface DealLogsResponse {
  items: DealLogEntry[];
}

export type PsmAction = "OPEN_REVIEW" | "CONTINUE_REVIEW" | "VIEW_POOL" | "NONE";
export type PsmStatusFilter = "READY" | "UNDER_REVIEW" | "COMPLETED";
export type PriorityStatusFilter = "PENDING" | "GENERATED";
export type AiStatusFilter = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface PsmJobRow {
  id: string;
  hubspotDealId: string;
  companyName: string;
  jobRole: string;
  expectedPoolCount: number | null;
  appliedCount: number;
  applicationWindow: Chip;
  aiStatus: Chip;
  priorityStatus: Chip;
  psmStatus: Chip;
  crmShareStatus: Chip;
  action: PsmAction;
  updatedAt: string;
}

export interface PsmJobDetail extends PsmJobRow {
  status: string;
  applicationStatus: string;
  candidateCount: number;
  isSubmitted: boolean;
  submittedAt: string | null;
  reviewedBy: string | null;
  publicLinkUrl: string | null;
}

export interface PsmJobsQuery {
  search?: string;
  company?: string;
  psmStatus?: string;
  priorityStatus?: string;
  aiStatus?: string;
  page?: number;
  limit?: number;
  sort?: "updatedAt:desc";
}

export interface PsmJobFilters {
  companies: string[];
  psmStatuses: FilterOption[];
  priorityStatuses: FilterOption[];
  aiStatuses: FilterOption[];
}

export interface PsmJobResponse {
  job: PsmJobDetail;
}

export type CandidateStatus = "RECOMMENDED" | "CONSIDER" | "NOT_RECOMMENDED";
export type CandidateAnalysisStatus = "COMPLETED" | "FAILED" | "NO_RESUME" | "PENDING" | "QUEUED" | "SKIPPED";

export interface Candidate {
  studentId: string;
  studentName: string;
  campus: string | null;
  hasResume: boolean;
  resumeScore: number | null;
  gritScore: number | null;
  assessmentScore: number | null;
  interviewScore: number | null;
  overallScore: number | null;
  aiPriority: string;
  aiRank: number;
  finalPriority: string;
  finalRank: number;
  resumeReason: string | null;
  matchedSkills: string[];
  missingSkills: string[];
  candidateStatus: CandidateStatus | null;
  psmRemarks: string;
  analysisStatus: CandidateAnalysisStatus;
  interest?: CandidateInterest | null;
}

export type CandidateSort = "finalRank:asc" | "aiRank:asc" | "overallScore:desc";

export interface CandidatesQuery {
  search?: string;
  aiPriority?: string;
  finalPriority?: string;
  status?: string;
  page?: number;
  limit?: number;
  sort?: CandidateSort;
}

export interface CandidatePatch {
  finalPriority?: string;
  psmRemarks?: string;
  candidateStatus?: CandidateStatus;
}

export interface CandidatePatchResponse {
  candidate: Candidate;
  swappedWith: { studentId: string; finalPriority: string } | null;
}

export interface SubmitPoolResponse {
  job: PsmJobDetail;
  publicLinkUrl: string;
}

export interface SharedColumn {
  key: string;
  label: string;
  custom: boolean;
  editable: boolean;
}

export interface SharedRow {
  id: string;
  source: "PSM" | "ADDED";
  resumeRef: string | null;
  values: Record<string, string>;
}

export interface SharedProfiles {
  companyName: string;
  jobRole: string;
  jobId: string | null;
  totalApplied: number;
  columns: SharedColumn[];
  rows: SharedRow[];
  updatedAt: string | null;
}

export interface SharedColumnChoice {
  columns: { key: string; label: string }[];
  selected: string[];
}

export type SharedLinkStatus = "ACTIVE" | "EXPIRED" | "INACTIVE";

export interface InterviewCompany {
  jobId: string;
  learningPortalJobId: string;
  companyName: string;
  jobRole: string;
  companyLogoUrl: string | null;
  crmEmail: string | null;
  url: string;
  linkStatus: SharedLinkStatus;
  createdAt: string | null;
  expiresAt: string | null;
  profiles: number;
  meets: number;
  interviewers: number;
}

export interface InterviewColumn extends SharedColumn {
  internal: boolean;
}

export type MeetRecordingStatus = "PENDING" | "ON" | "FAILED";

export interface InterviewMeetInfo {
  meetUrl: string;
  eventLink: string | null;
  eventName: string;
  description: string;
  startAt: string | null;
  durationMinutes: number | null;
  timeZone: string | null;
  organizerEmail: string | null;
  crmEmail: string | null;
  studentEmail: string | null;
  interviewerEmails: string[];
  otherEmails: string[];
  recording: { status: MeetRecordingStatus; transcript: boolean; error: string | null };
  scheduledBy: string | null;
  updatedAt: string | null;
}

export interface InterviewRow extends SharedRow {
  studentName: string;
  meet: InterviewMeetInfo | null;
}

export interface InterviewSheet {
  jobId: string;
  learningPortalJobId: string;
  companyName: string;
  jobRole: string;
  companyLogoUrl: string | null;
  url: string;
  linkStatus: SharedLinkStatus;
  totalApplied: number;
  interviewerEmails: string[];
  meetEnabled: boolean;
  meetProblem: string | null;
  organizerEmail: string | null;
  columns: InterviewColumn[];
  rows: InterviewRow[];
  updatedAt: string | null;
}

export interface GoogleConnectionStatus {
  mode: "oauth" | "delegation" | "mock";
  configured: boolean;
  connected: boolean;
  status: "ACTIVE" | "REVOKED" | null;
  email: string | null;
  expectedEmail: string | null;
  connectedBy: string | null;
  connectedAt: string | null;
  lastError: string | null;
  problem: string | null;
}

export interface MeetRequest {
  eventName: string;
  description: string;
  startAt: string;
  durationMinutes: number;
  timeZone: string;
  studentEmail: string;
  interviewerEmails: string[];
  otherEmails: string[];
  saveInterviewers: boolean;
}

export interface MeetResponse {
  meet: InterviewMeetInfo;
  values: Record<string, string>;
}

export const ELIGIBILITY_STATUSES = ["Eligible", "Placed", "Mint", "Do not Provided", "Not Interested"] as const;

export const EDITABLE_PRODUCTS = ["NIAT", "Academy"] as const;

export type PoolProduct = "NIAT" | "Academy";

export interface EligiblePoolStudent {
  studentId: string;
  niatId: string | null;
  studentName: string;
  mobile: string | null;
  email: string | null;
  productGroup: PoolProduct | null;
  campus: string | null;
  batch: string | null;
  eligibilityStatus: string | null;
  remarks: string | null;
  syncedAt: string | null;
  updatedAt: string | null;
  manual: boolean;
  updatedBy: string | null;
}

export type PoolStudentInput = Partial<
  Omit<EligiblePoolStudent, "productGroup" | "syncedAt" | "updatedAt" | "manual" | "updatedBy">
>;

export interface EligiblePoolSync {
  status: "IDLE" | "RUNNING" | "DONE" | "FAILED";
  startedAt: string | null;
  finishedAt: string | null;
  startedBy: string | null;
  rowsRead: number;
  removed: number;
  error: string | null;
}

export interface EligiblePoolSummary {
  total: number;
  products: { product: PoolProduct; count: number }[];
  statuses: { status: string; count: number }[];
  campuses: { campus: string; count: number }[];
  sync: EligiblePoolSync | null;
  syncConfigured: boolean;
  allowedProducts: PoolProduct[];
}

export interface AuditLogEntry {
  id: string;
  at: string;
  actor: { email: string | null; name: string; role: string; roleLabel: string };
  action: string;
  label: string;
  text: string;
  entityType: string;
  entityId: string;
  deal: {
    jobId: string;
    hubspotDealId: string | null;
    companyName: string | null;
    jobRole: string | null;
    learningPortalJobId: string | null;
    deleted: boolean;
  } | null;
  metadata: Record<string, unknown>;
  ip: string | null;
}

export interface AuditLogQuery {
  search?: string;
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

export interface AuditLogFilterOptions {
  actors: { value: string; label: string }[];
  actions: { value: string; label: string }[];
}

export interface EligiblePoolQuery {
  search?: string;
  product?: string;
  status?: string;
  campus?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

export interface BigQueryColumn {
  name: string;
  type: string;
  mode: string;
}

export interface BigQueryDatasets {
  projectId: string;
  datasets: { id: string; location: string | null }[];
}

export interface BigQueryTableInfo {
  id: string;
  type: string | null;
  rowCount: number | null;
  columns: BigQueryColumn[];
  updatedAt: string | null;
}

export interface BigQueryTables {
  datasetId: string;
  tables: BigQueryTableInfo[];
}

export type BigQueryCell = string | number | boolean | null;

export interface BigQueryRows {
  datasetId: string;
  tableId: string;
  type: string | null;
  columns: BigQueryColumn[];
  rows: Record<string, BigQueryCell>[];
  pagination: Pagination;
}

export type AiCallStatus = "QUEUED" | "CALLING" | "COMPLETED" | "NO_ANSWER" | "BUSY" | "FAILED" | "CANCELLED";

export interface BoostCallRow {
  id: string;
  batchId: string;
  studentId: string;
  name: string;
  phone: string;
  status: AiCallStatus;
  durationSeconds: number | null;
  interested: string | null;
  willApply: string | null;
  reason: string | null;
  questions: string | null;
  callBack: string | null;
  overallRating: number | null;
  remarks: string | null;
  summary: string | null;
  recordingUrl: string | null;
  error: string | null;
  calledAt: string | null;
  endedAt: string | null;
}

export interface BoostEmailRun {
  at: string;
  by: string | null;
  recipients: number;
  sent: number;
  skipped: number;
  failed: number;
}

export interface BoostCallRun {
  batchId: string;
  at: string;
  by: string | null;
  agentId: string | null;
  queued: number;
  skippedNoPhone: number;
}

export interface BoostOverview {
  deal: {
    id: string;
    hubspotDealId: string;
    companyName: string | null;
    jobRole: string | null;
    expectedPoolCount: number | null;
    appliedCount: number;
    eligibleCount: number;
    applicationEndAt: string | null;
    windowOpen: boolean;
    poolTargetReached: boolean;
  };
  notApplied: {
    product: string;
    total: number;
    withEmail: number;
    withPhone: number;
    niatWithAccess: number;
    othersWithAccess: number;
  };
  emails: { availableAt: string | null; runs: BoostEmailRun[] };
  calls: {
    setupProblem: string | null;
    agentId: string | null;
    agentCreatedAt: string | null;
    spokenJd: string | null;
    active: boolean;
    counts: Record<AiCallStatus, number>;
    interested: number;
    willApply: number;
    runs: BoostCallRun[];
    lastSyncedAt: string | null;
    items: BoostCallRow[];
  };
  controls: { reminderEmails: boolean; aiCalls: boolean };
}

export interface AppSettings {
  flow: { mode: FlowMode; crmOptions: Record<FlowMode, boolean>; approvals: Record<ApprovalGate, boolean> };
  studentEmails: { jobEmail: boolean; jobUpdates: boolean; boostReminder: boolean };
  checkpoints: CheckpointSwitches;
  crmEmails: { poolReached: boolean; candidatePool: boolean };
  aiCalls: { enabled: boolean };
  interviews: { googleMeet: boolean };
  automation: { aiJobContent: boolean; aiResumeAnalysis: boolean; hubspotWriteBack: boolean };
  timing: {
    applicationWindowHours: number;
    reminderOneHours: number;
    reminderTwoHours: number;
    boostEmailCooldownMinutes: number;
  };
}

export interface AppSettingsRecord {
  settings: AppSettings;
  updatedBy: string | null;
  updatedAt: string | null;
  released?: number;
}

export interface CrmControls {
  flow: { options: FlowMode[]; defaultMode: FlowMode; approvalSteps: { gate: ApprovalGate; label: string }[] };
  reminderEmails: boolean;
  aiCalls: boolean;
  checkpoints: CheckpointSwitches;
}

export type InterestReason = "LOCATION" | "PAY" | "ROLE" | "TIMING" | "OTHER";

export interface CandidateInterest {
  interested: boolean;
  reason: InterestReason | null;
  comments: string;
  submittedAt: string | null;
}

export interface JobUpdateForm {
  companyName: string;
  jobRole: string;
  jobId: string | null;
  updatedAt: string;
  studentName: string;
  changes: { label: string; oldValue: string; newValue: string }[];
  response: CandidateInterest | null;
}

export interface JobUpdateAnswer {
  userId: string;
  jobId?: string;
  interested: boolean;
  reason?: InterestReason | null;
  comments?: string;
}
