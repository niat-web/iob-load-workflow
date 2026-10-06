# API Contract

The contract between `apps/web` and `apps/api`. Both sides must match this document.

## Conventions

- Base path: `${VITE_API_BASE_URL}/api`. When `VITE_API_BASE_URL` is empty, requests go to the same
  origin (Vite dev proxy locally, Vercel rewrite in production).
- Every request sends cookies: `fetch(url, { credentials: "include" })`.
- Every `POST`, `PATCH` and `DELETE` must send the header `X-Requested-With: XMLHttpRequest`
  and `Content-Type: application/json`. Requests without it are rejected with `403 CSRF_REJECTED`.
- Timestamps are ISO-8601 strings (UTC). The UI formats them in the viewer's locale,
  for example `Apr 24, 2026 10:14 AM`.
- Error body (any non-2xx):

  ```json
  { "error": { "code": "ACCESS_DENIED", "message": "Human readable message", "details": {} } }
  ```

  Codes used: `VALIDATION_ERROR` (400), `INVALID_DEAL_ID` (400), `UNAUTHENTICATED` (401),
  `INVALID_MICROSOFT_TOKEN` (401), `ACCESS_DENIED` (403), `FORBIDDEN` (403), `CSRF_REJECTED` (403),
  `NOT_FOUND` (404), `CONFLICT` (409), `REVIEW_FROZEN` (409), `NOT_RETRYABLE` (409),
  `LINK_EXPIRED` (410), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500),
  `MICROSOFT_NOT_CONFIGURED` (503), `MICROSOFT_UNAVAILABLE` (503).

- Paginated list response:

  ```json
  { "items": [], "pagination": { "page": 1, "limit": 20, "total": 150, "totalPages": 8 } }
  ```

  Query params `page` (default 1) and `limit` (default 20, max 100).

### Chip

Every status the UI shows as a coloured chip is sent pre-labelled by the API:

```ts
type Tone = "green" | "blue" | "purple" | "orange" | "yellow" | "gray" | "red";
type Chip = { key: string; label: string; tone: Tone };
```

The UI only maps `tone` to colours; it never derives labels from raw statuses.

---

## Auth

### `GET /api/auth/config`

```json
{
  "microsoftClientId": "11111111-2222-4333-8444-555555555555",
  "microsoftTenantId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  "devLoginEnabled": false
}
```

`microsoftClientId` and `microsoftTenantId` are `null` when Microsoft sign-in is not configured.
`devLoginEnabled` is only ever `true` outside production, for local testing without Microsoft.

### `POST /api/auth/microsoft`

Body `{ "idToken": "<ID token from the Microsoft sign-in popup (MSAL)>" }`

The API checks the token's signature against Microsoft's published keys, that it was issued for
this app (`aud` = client ID) by the company tenant (`iss` and `tid`), and that it is at most 10
minutes old. The email is the `email` claim, or `preferred_username` when there is none.

- `200` → `{ "user": User, "redirectTo": "/crm" }` and sets the HttpOnly session cookie.
- `401 INVALID_MICROSOFT_TOKEN`, `403 ACCESS_DENIED` (email unknown or inactive).
- `503 MICROSOFT_UNAVAILABLE` (Microsoft's keys could not be fetched; try again) or
  `503 MICROSOFT_NOT_CONFIGURED`.

### `POST /api/auth/dev-login`

Body `{ "email": "crm@example.com" }`. Same responses as `/microsoft`. `404` when dev login is disabled.

### `GET /api/auth/me`

- `200` → `{ "user": User }`
- `401 UNAUTHENTICATED`

### `POST /api/auth/logout`

`204`, clears the cookie.

```ts
type Role = "CRM" | "PSM" | "ADMIN";
type HubspotOwner = { id: string; name: string; email: string | null };
type User = { email: string; name: string; role: Role; picture: string | null; hubspotOwner: HubspotOwner | null };
```

Redirect rule after login: `CRM → /crm`, `PSM → /psm`, `ADMIN → /crm` (configurable server-side,
always returned in `redirectTo`). ADMIN may open both `/crm` and `/psm`.

---

## CRM (roles: CRM, ADMIN)

### `POST /api/crm/deals/process`

Body:

```json
{ "dealId": "1234567890", "flowMode": "AUTOMATIC", "expectedPoolCount": 70,
  "crmOwnerId": "1000001", "profilingPocId": "1000002", "iseId": "1000003" }
```

`flowMode` is `AUTOMATIC` (default) or `STEP_BY_STEP`. The API also accepts a pasted HubSpot deal URL
and extracts the ID. `expectedPoolCount` (whole number ≥ 1) is stored only in the app (HubSpot never
sets or changes it); `crmOwnerId` overrides the HubSpot deal owner; `profilingPocId` and `iseId` are optional. Owner IDs must come from
`GET /api/crm/hubspot-owners`. The CRM owner, Profiling POC and ISE go into the portal job
(`job_extra_details.crm / profiling_poc / ise`, "NA" when empty), the tracker sheet, and the HubSpot deal's `crm`, `profiling_poc` and `ise` properties (written
through the deal webhook).

- `202` → `{ "job": CrmDealRow, "duplicate": false }` for a new deal.
- `200` → `{ "job": CrmDealRow, "duplicate": true }` when the deal was already submitted
  (no new job is created).
- `400 INVALID_DEAL_ID`, `400 VALIDATION_ERROR` (unknown owner, expected pool below 1).

### `GET /api/crm/hubspot-owners`

`{ owners: HubspotOwner[], defaultOwnerId: string | null }`. The list comes from the HubSpot owner
map (`HUBSPOT_OWNER_MAP_JSON` or the git-ignored `apps/api/src/data/hubspotOwnerMap.json`), sorted by name.
`defaultOwnerId` is the signed-in user's HubSpot owner (linked on the account, or matched by email);
the form preselects it for CRM owner, Profiling POC and ISE.

### Admin users (`ADMIN` only)

- `GET /api/admin/users` → `{ users: AdminUser[] }` where
  `AdminUser = { email, name, role, isActive, hubspotOwner: HubspotOwner | null, lastLoginAt, createdAt }`.
- `POST /api/admin/users` body `{ email, name?, role, hubspotOwnerId? }` → `201 { user }`. Without
  `hubspotOwnerId` the owner is matched by email; without `name` the owner name is used.
  `409 USER_EXISTS`, `400` for an unknown owner or an email outside `ALLOWED_EMAIL_DOMAINS`.
- `PATCH /api/admin/users/:email` body `{ name?, role?, isActive?, hubspotOwnerId?: string | null }` →
  `{ user }`. An admin cannot remove their own admin role or deactivate themselves
  (`409 SELF_LOCKOUT`). Every add and change is audited (`USER_ADDED`, `USER_UPDATED`).

### `GET /api/crm/deals`

Query: `search` (company, deal ID or role), `status` (a `displayStatus.key`), `company`,
`page`, `limit`, `sort` (`updatedAt:desc` default; also `updatedAt:asc`, `companyName:asc`,
`companyName:desc`, `progressPercent:desc`).

Response: paginated `CrmDealRow`.

```ts
type CrmDealRow = {
  id: string;                    // internal job id (opaque)
  hubspotDealId: string;
  companyName: string | null;    // null until the deal is fetched
  jobRole: string | null;
  expectedPoolCount: number | null;
  appliedCount: number;
  progressPercent: number;       // 0..100, integer
  status: string;                // raw workflow status, e.g. "APPLICATIONS_OPEN"
  displayStatus: Chip;           // keys: PENDING, PROCESSING, IN_PROGRESS, AI_ANALYSIS,
                                 //       PSM_REVIEW, COMPLETED, FAILED
  currentStep: string;           // e.g. "Application Window", "Public Link Created"
  publicLinkUrl: string | null;
  isActive: boolean;             // true while background work is still running → poll
  flowMode: "AUTOMATIC" | "STEP_BY_STEP";
  awaitingApproval: { gate: ApprovalGate; label: string; requestedAt: string | null } | null;
  canRetry: boolean;
  canStop: boolean;              // not stopped and the PSM has not submitted the pool
  canDelete: boolean;            // Stopped or Failed, and the PSM has not submitted the pool
  lastError: string | null;
  updatedAt: string;
};
```

### `GET /api/crm/deals/filters`

```json
{
  "companies": ["TCS", "Zoho"],
  "statuses": [{ "value": "COMPLETED", "label": "Completed" }]
}
```

### `GET /api/crm/companies`

One row per company that has at least one fetched deal, sorted by name. `inProgress`, `waiting`,
`completed`, `failed` and `stopped` always add up to `deals`.

```json
{
  "items": [
    {
      "name": "Infosys",
      "deals": 4,
      "inProgress": 1,
      "waiting": 1,
      "completed": 1,
      "failed": 0,
      "stopped": 1,
      "lastUpdated": "2026-10-05T06:12:00.000Z"
    }
  ]
}
```

### `GET /api/crm/deals/:jobId`

`CrmDealDetail = CrmDealRow & {...}`:

```ts
type CrmDealDetail = CrmDealRow & {
  learningPortal: {
    jobId: string | null;              // same job id in every environment
    organisationId: string | null;
    order: number | null;              // portal "Order" (null without the tracker sheet)
    environments: { name: "beta" | "prod"; loadedAt: string | null }[];
    hubspotWriteBack: "PENDING" | "DONE" | "FAILED" | "SKIPPED";
  };
  learningPortalJobUrl: string | null;  // student apply link (prod)
  location: string | null;
  ctc: string | null;
  employmentType: string | null;
  openings: number | null;
  skills: string[];
  batch: string | null;
  campus: string | null;
  program: string | null;
  crmOwnerName: string | null;
  crmOwnerEmail: string | null;
  eligibleCount: number;
  applicationStartAt: string | null;
  applicationEndAt: string | null;
  poolTargetReached: boolean;
  reminders: {
    r10h: ReminderInfo | null;
    r20h: ReminderInfo | null;
  };
  timeline: { status: string; label: string; at: string }[];
  createdAt: string;
};
type ReminderInfo = {
  status: "SENT" | "SKIPPED" | "FAILED";
  at: string;
  emailCount: number;
  callCount: number;
  reason: string | null;
};
```

### `GET /api/crm/deals/:jobId/logs`

```json
{ "items": [{ "at": "2026-04-24T10:14:00Z", "level": "info", "type": "status", "message": "Job created in Learning Portal" }] }
```

`level`: `info | warn | error`. `type`: `status | task | notification | call | audit`. Newest first,
at most 200.

### `POST /api/crm/deals/:jobId/retry`

Retries the failed workflow step. `200` → `{ "job": CrmDealRow }`. `409 NOT_RETRYABLE` if the job
is not in a failed state.

### `POST /api/crm/deals/:jobId/stop`

Stops the deal at whatever step it is on (`displayStatus` becomes `CANCELLED`, label "Stopped").
No further steps run. `200` → `{ "job": CrmDealRow }`. `409 NOT_STOPPABLE` when it is already
stopped or finished.

### `DELETE /api/crm/deals/:jobId`

Permanently removes a Stopped or Failed deal and all its records (tasks, snapshots, students,
applications, analyses, notifications, public link). An audit entry `DEAL_DELETED` is kept. `204`.
`409 NOT_DELETABLE` when the deal is still running (stop it first), finished, or one of its steps
is still finishing. `404` when it does not exist.

### Step-by-step approvals

`ApprovalGate` = `DEAL_DETAILS | LOAD_BETA | LOAD_PROD | ELIGIBLE_STUDENTS | START_WINDOW`. A deal
waiting at a gate has `displayStatus.key = "WAITING"` (filter `status=WAITING`); a stopped deal has
`CANCELLED`. `CrmDealDetail` adds `approvals: { gate, label, by, at }[]`, `cancelledBy`, `cancelledAt`.

- `GET /api/crm/deals/:jobId/approval` → `{ approval: { gate, label, description, requestedAt, deal? | load? | students? | window? } }`
- `POST /api/crm/deals/:jobId/approve` body `{ "gate": "LOAD_BETA" }` → `{ job: CrmDealRow }`
- `POST /api/crm/deals/:jobId/approval/plans` body `{ "enrollPlans": ["CCBP_INTENSIVE"] }` → `{ approval }`
  (only at the first load gate, before anything is loaded; else `409 PLANS_LOCKED`)
Stopping at a gate uses `POST /api/crm/deals/:jobId/stop` (above).

All three return `409 NOT_WAITING` when the deal is not waiting at that gate.

---

## PSM (roles: PSM, ADMIN)

### `GET /api/psm/jobs`

Query: `search`, `company`, `psmStatus` (`READY | UNDER_REVIEW | COMPLETED`),
`priorityStatus` (`PENDING | GENERATED`), `aiStatus` (`PENDING | IN_PROGRESS | COMPLETED | FAILED`),
`page`, `limit`, `sort` (`updatedAt:desc` default).

Only jobs whose application window has closed are listed.

```ts
type PsmAction = "OPEN_REVIEW" | "CONTINUE_REVIEW" | "VIEW_POOL" | "NONE";
type PsmJobRow = {
  id: string;
  hubspotDealId: string;
  companyName: string;
  jobRole: string;
  expectedPoolCount: number | null;
  appliedCount: number;
  applicationWindow: Chip;   // Open (blue) / Completed (green)
  aiStatus: Chip;            // AI Pending (gray) / AI In Progress (blue) / AI Completed (green) / AI Failed (red)
  priorityStatus: Chip;      // Pending (gray) / Priority Generated (purple)
  psmStatus: Chip;           // Not Ready (gray) / Ready for Review (blue) / Under Review (orange) / Completed (green)
  crmShareStatus: Chip;      // CRM Pending (gray) / Link Generated (purple) / Shared to CRM (green) / Failed (red)
  action: PsmAction;         // NONE while AI analysis is still running
  updatedAt: string;
};
```

### `GET /api/psm/jobs/filters`

```json
{
  "companies": ["TCS"],
  "psmStatuses": [{ "value": "READY", "label": "Ready for Review" }],
  "priorityStatuses": [{ "value": "GENERATED", "label": "Priority Generated" }],
  "aiStatuses": [{ "value": "COMPLETED", "label": "AI Completed" }]
}
```

### `GET /api/psm/jobs/:jobId`

```ts
type PsmJobDetail = PsmJobRow & {
  status: string;
  applicationStatus: string;      // "Open" | "Closed"
  candidateCount: number;         // candidates in the pool (= max priority number)
  isSubmitted: boolean;
  submittedAt: string | null;
  reviewedBy: string | null;
  publicLinkUrl: string | null;
};
```

### `POST /api/psm/jobs/:jobId/start-review`

Called when the review page opens. Moves `READY_FOR_PSM → PSM_REVIEW_IN_PROGRESS`. Idempotent.
`200` → `{ "job": PsmJobDetail }`.

### `GET /api/psm/jobs/:jobId/candidates`

Query: `search` (name or student ID), `aiPriority` (e.g. `P3`), `finalPriority`,
`status` (`RECOMMENDED | CONSIDER | NOT_RECOMMENDED`), `page`, `limit`,
`sort` (`finalRank:asc` default; also `aiRank:asc`, `overallScore:desc`).

```ts
type CandidateStatus = "RECOMMENDED" | "CONSIDER" | "NOT_RECOMMENDED";
type Candidate = {
  studentId: string;
  studentName: string;
  campus: string | null;
  hasResume: boolean;
  resumeScore: number | null;       // null → show "N/A"
  gritScore: number | null;         // null → show "GRIT Data Not Available" (short: "N/A" with tooltip)
  assessmentScore: number | null;
  interviewScore: number | null;
  overallScore: number | null;
  aiPriority: string;               // "P3" (read only)
  aiRank: number;
  finalPriority: string;            // "P1" (editable)
  finalRank: number;
  resumeReason: string | null;      // AI reason
  matchedSkills: string[];
  missingSkills: string[];
  candidateStatus: CandidateStatus | null;
  psmRemarks: string;
  analysisStatus: "COMPLETED" | "FAILED" | "NO_RESUME" | "PENDING";
};
```

Resume link: `GET /api/psm/jobs/:jobId/candidates/:studentId/resume` (opens the file in a new tab,
streamed through the API with the session cookie).

### `PATCH /api/psm/jobs/:jobId/candidates/:studentId`

Body (any subset):

```json
{ "finalPriority": "P1", "psmRemarks": "Strong interview", "candidateStatus": "RECOMMENDED" }
```

- `finalPriority` must be `P1..P{candidateCount}`. Setting a priority that another candidate holds
  swaps the two candidates' priorities so each priority stays unique.
- `200` → `{ "candidate": Candidate, "swappedWith": { "studentId": "S2", "finalPriority": "P3" } | null }`
- `409 REVIEW_FROZEN` after the pool is submitted.

### `POST /api/psm/jobs/:jobId/submit`

Freezes the review, generates the public link and triggers the CRM email.
`200` → `{ "job": PsmJobDetail, "publicLinkUrl": "https://.../public/candidate-pool/<token>" }`.
Submitting twice returns the same result (idempotent).

---

## Public (no auth)

### `GET /api/public/candidate-pools/:token`

```ts
type PublicPool = {
  companyName: string;
  jobRole: string;
  totalApplied: number;
  submittedAt: string;
  expiresAt: string;
  candidates: {
    ref: string;                 // opaque per-candidate reference
    finalPriority: string;
    studentName: string;
    hasResume: boolean;
    relevantSkills: string[];
    resumeScore: number | null;
    gritScore: number | null;
    assessmentScore: number | null;
    interviewScore: number | null;
    overallScore: number | null;
    candidateStatus: CandidateStatus | null;
  }[];                           // sorted by final priority
};
```

- `404 NOT_FOUND` for unknown or deactivated links, `410 LINK_EXPIRED` for expired links.
- Resume: `GET /api/public/candidate-pools/:token/candidates/:ref/resume`.

---

## HubSpot webhook

`POST /api/webhooks/hubspot`: HubSpot signature v3 verified; not called by the UI.

## Health

- `GET /health` → `{ "status": "ok" }`
- `GET /ready` → `{ "status": "ready", "checks": { "mongo": "ok" } }` or `503`.
