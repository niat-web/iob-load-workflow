# Job Flow Automation

The CRM enters a HubSpot Deal ID or deal link. The rest runs on its own: the job is loaded into the
Learning Portal (beta, then prod, exactly as the CRM_Job_Loading tool does), eligible students get access and an email, the 21-hour application window runs with 10h and
20h reminders (email + NxtDial AI call), HubSpot changes are pushed to students, and at 21h the
applied pool is analysed (Gemini resume scoring + GRIT + assessment + interview scores) and ranked
P1…Pn. A PSM reviews and submits the pool, and the deal's CRM owner is emailed a secure,
read-only candidate-pool link to share with the company.

```
CRM  ──Deal ID──▶  API ──▶ workflow_tasks (MongoDB) ◀── Worker
                                                         │
     HubSpot ◀─fetch/webhook/job ID─┐                    ├─▶ Learning Portal beta + prod (org, job, access)
                                    └────────────────────┤─▶ AWS SES (initial / reminder / update / CRM emails)
                                                         ├─▶ NxtDial (reminder AI calls)
                                                         ├─▶ BigQuery (applications, GRIT, assessments, interviews)
                                                         ├─▶ Gemini (resume analysis, portal job text)
                                                         └─▶ Google Sheet (org IDs, Order, tracker; optional)
PSM  ──review / submit──▶ API ──▶ public link ──▶ CRM email ──▶ company (read-only page)
```

## Contents

- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Configuration and integrations](#configuration-and-integrations)
- [Deployment](#deployment-northflank--vercel--mongodb-atlas)
- [Running and testing](#running-and-testing)
- [Troubleshooting](#troubleshooting)
- [Assumptions to confirm before go-live](#assumptions-to-confirm-before-go-live)

---

## Architecture

| Part | Stack | Where |
|---|---|---|
| `apps/web` | React 19, TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query + Table, lucide-react, Zod | Vercel |
| `apps/api` (API) | Node.js 24, Express 4 (ES modules), Mongoose, Zod, helmet, cors, express-rate-limit, pino | Northflank service 1 |
| `apps/api` (worker) | same image, `node src/worker.js` | Northflank service 2 |
| Database | MongoDB Atlas | — |
| CI | GitHub Actions (lint, typecheck, tests, audit, gitleaks, Docker build) | — |

### Background processing

Every step of a deal is a **persisted task** in `workflow_tasks`, never a timer in memory or in the
browser. The worker:

- claims due tasks atomically (`findOneAndUpdate` → `PROCESSING`, `lockedBy`, `lockedAt`), so a task
  never runs twice at the same time;
- extends the lock every minute for long tasks, and re-claims tasks whose lock went stale (a crashed
  worker) after `WORKER_LOCK_TIMEOUT_MINUTES`;
- retries transient failures with backoff (`TASK_BACKOFF_MINUTES`, default 1, 5, 15, 30 min, or the
  provider's `Retry-After`), stops after `TASK_MAX_ATTEMPTS`, and marks permanent failures
  immediately;
- marks the deal **Failed** when a critical step gives up; CRM/ADMIN can press **Retry Failed Step**.
- **Stop** (any deal not yet finished) halts it: queued and scheduled steps are dropped and a step
  that finishes afterwards cannot move it on. **Delete** (Stopped or Failed deals) removes the deal and
  all its records so the Deal ID can be submitted again; an audit entry is kept. Neither undoes work
  already done outside the app (portal job, emails).

Because all state is in MongoDB, restarts, deploys and crashes lose nothing. The 10h, 20h and 21h
tasks are scheduled the moment the window opens.

### Workflow

| Step | Task | Status after |
|---|---|---|
| CRM submits Deal ID | — | `SUBMITTED` |
| Fetch deal, map fields, validate required fields | `FETCH_DEAL` | `DEAL_FETCHED` |
| Load the job into beta, then prod (same org and job IDs; test accounts get access) | `CREATE_JOB` | `JOB_CREATED` |
| Write the job ID to the HubSpot deal(s); add a tracker-sheet row | `HUBSPOT_WRITE_BACK`, `TRACK_LOADED_JOB` | — |
| Find eligible students (eligible-users API on beta) | `IDENTIFY_ELIGIBLE` | `ELIGIBLE_STUDENTS_IDENTIFIED` |
| Grant eligible students apply access (prod) | `GRANT_ACCESS` | `GRANTING_ACCESS` |
| Open the 21h window, schedule 10h/20h/21h, send initial emails | `SEND_INITIAL_NOTIFICATIONS` | `APPLICATIONS_OPEN` |
| Refresh the applied count every `APPLICATION_COUNT_SYNC_MINUTES` | `APPLICATION_COUNT_SYNC` | — |
| 10h / 20h: if the target is not reached, email + call non-applicants | `REMINDER_10H` / `REMINDER_20H` | `REMINDER_xxH_SENT` |
| HubSpot change: update the same job in beta and prod, email changes | `HUBSPOT_DEAL_UPDATE` | — |
| 21h: close (never earlier, even if the target is reached) | `APPLICATION_CLOSE_21H` | `APPLICATIONS_CLOSED` |
| Final applicant list from BigQuery (snapshot) | `FETCH_FINAL_POOL` | `APPLIED_POOL_READY` |
| Resume download + Gemini analysis, one candidate at a time | `AI_ANALYSIS` | `AI_ANALYSIS` |
| GRIT/assessment/interview scores, ranking P1…Pn | `PRIORITY_GENERATION` | `READY_FOR_PSM` |
| PSM opens review | — | `PSM_REVIEW_IN_PROGRESS` |
| PSM submits: freeze, public link | — | `PUBLIC_LINK_GENERATED` |
| Email the deal's CRM owner | `CRM_NOTIFICATION` | `COMPLETED` |

### Flow modes: Automatic and Step by step

The CRM picks a mode next to Submit; each deal keeps its own mode.

- **Automatic**: every step above runs by itself.
- **Step by step**: the deal stops before five steps and shows **Waiting for Approval** in the CRM
  table. **Review** opens a panel showing what the step will do; **Approve and continue** runs it,
  **Stop deal** ends the deal.

| Stop | Shown to the reviewer | Runs after approval |
|---|---|---|
| Deal details | Fields read from HubSpot | Org lookup and job preparation (nothing sent) |
| Load into Beta | Organisation (new / existing), job ID, apply link, course plans (editable), eligibility text, disclaimer | Org + job in Beta, Beta test accounts |
| Load into Prod | The same, plus where it is already loaded | Same job ID into Prod |
| Give students access | Eligible count, with email / phone | Access for the eligible students |
| Email students and start window | Students with access, emails to send, window and reminder times | Emails, 21h window; reminders and closing run automatically |

Any CRM user or Admin can approve; every approval is recorded (who, when) in the deal details and
logs. Course plans can only be changed before the first portal load, so beta and prod stay identical.
Nothing times out: a deal can wait at a stop as long as needed.

### Idempotency

Unique indexes make repeats harmless: one job per HubSpot deal, one task per `dedupeKey`, one email
per `jobId + type + recipient (+ job version for updates)`, one AI call per
`jobId + student + reminder`, one application / analysis row per `jobId + student`, one public link
per job, and each HubSpot webhook event is stored once (`eventId` or a hash of the event).

### Security

- Microsoft ID tokens are verified on the server (signature, app, company tenant, age); the role
  comes only from the `users` collection.
- Session: HS256 JWT in an HttpOnly cookie (`Secure` in production). Users are re-read on every
  request, so deactivation takes effect immediately.
- State-changing requests require `X-Requested-With` (CSRF guard) and pass strict CORS.
- helmet, rate limits, Zod validation on every input, parameterised BigQuery queries with
  validated table/column identifiers, SSRF guards on resume downloads.
- HubSpot webhooks: signature v3 (HMAC-SHA256 with the app client secret) and a 5-minute
  timestamp window.
- Public links: 256-bit random token; lookups use its SHA-256 hash; the token is stored encrypted
  (AES-256-GCM, `SESSION_SECRET`) so the CRM can reopen it. The public page shows no student IDs,
  contact details, PSM remarks, audit data or internal IDs.
- Candidate data is visible only to PSM and ADMIN. All secrets stay in the backend.

---

## Local setup

Requirements: Node.js 22.12+ (24 in production), npm 10+.

```bash
npm install
```

### Option A: live (the default)

Every integration is live unless you say otherwise. Fill `apps/api/.env` from
[.env.example](.env.example): MongoDB Atlas, the HubSpot deal webhook, the Learning Portal keys, Gemini, BigQuery, AWS SES, NxtDial, Microsoft sign-in, and your own email in
`BOOTSTRAP_ADMIN_EMAILS`. Set `PROCESS_ROLE=all` to run the worker inside the API process. Keys can be
added over time: the API always starts, lists what is still missing, and only the steps that need a
missing key stop (see below).

```bash
npm run dev:api      # API on http://localhost:8000 (+ worker with PROCESS_ROLE=all)
npm run dev:web      # frontend on http://localhost:5173
```

Open http://localhost:5173 and sign in with Microsoft.

### Option B: Docker

```bash
docker compose up --build        # MongoDB + API + worker, live integrations from apps/api/.env
npm run dev:web
```

### Option C: offline test mode (no credentials)

Only for trying the screens without any real service. Nothing reaches HubSpot, the portal, students
or AI. Run `npm run dev:db` for a throwaway in-memory MongoDB and put this in `apps/api/.env`:

```env
INTEGRATION_MODE=mock
ALLOW_DEV_LOGIN=true
PROCESS_ROLE=all
APPLICATION_WINDOW_HOURS=0.05
REMINDER_ONE_HOURS=0.02
REMINDER_TWO_HOURS=0.04
APPLICATION_COUNT_SYNC_MINUTES=0.5
WORKER_POLL_MS=1000
```

The short timings give a ~3-minute window. Use the development login with `crm@example.com`,
`psm@example.com` or `admin@example.com` (created automatically in this mode). Any numeric Deal ID
works; `404` (or IDs ending in `000`) simulates a deal HubSpot cannot find.

To simulate a HubSpot edit during the window (test mode only):

```bash
curl -X POST http://localhost:5173/api/dev/mock-hubspot/<dealId> \
  -H "X-Requested-With: XMLHttpRequest" -H "Content-Type: application/json" \
  -b <session cookie> -d '{"properties":{"location":"Bengaluru"}}'
```

### Adding users

Admins manage users in the app: **Settings → Users** adds an account (email, role, HubSpot owner) and
changes role, HubSpot owner or access. Admins also link their own HubSpot owner under **Settings →
Account**. The same can be done with the CLI (uses `MONGODB_URI`):

```bash
npm run users -w apps/api -- add crm.user@example.com CRM "CRM User"
npm run users -w apps/api -- add psm.user@example.com PSM
npm run users -w apps/api -- add some.one@example.com CRM --owner 1000001
npm run users -w apps/api -- owner crm.user@example.com 1000002
npm run users -w apps/api -- owners
npm run users -w apps/api -- deactivate old.user@example.com
npm run users -w apps/api -- list
```

Every account (CRM, PSM and ADMIN) is linked to its **HubSpot owner** (name, owner ID, email). `add`
links it automatically when the email is in the HubSpot owner map; otherwise pass `--owner <id>` or run
`owner <email> <id>` later. `owners` prints every owner with its ID. Accounts that match by email are
also linked on API start. The linked owner is preselected as CRM owner, Profiling POC and ISE when
that person adds a deal.

The HubSpot owner map (names, emails and owner IDs from CRM_Job_Loading) is real staff data, so it
is **not in the repository**. The API reads it from `HUBSPOT_OWNER_MAP_JSON` in `apps/api/.env`
(one-line JSON), or else from the git-ignored file `apps/api/src/data/hubspotOwnerMap.json`. The
format is shown in [hubspotOwnerMap.example.json](apps/api/src/data/hubspotOwnerMap.example.json)
(fake people, used by the tests). Without either, the owner dropdowns are empty and the API still starts.

`BOOTSTRAP_ADMIN_EMAILS` creates ADMIN users when the API starts.

---

## Configuration and integrations

All variables are documented in [.env.example](.env.example). Every integration is **live by
default** (`INTEGRATION_MODE=live`). Missing settings **never stop the API**: at
startup it logs one warning per integration that is not set up yet (e.g. `Gemini is not set up: add
GEMINI_API_KEY`). Everything that is configured works; a workflow step that needs a missing key fails
that deal with the exact keys to add (no pointless retries). Add them to `apps/api/.env`, restart the
API and press **Retry Failed Step**. Steps with a built-in fallback keep going, e.g. job descriptions
use the rule-based text when Gemini is not set up. `INTEGRATION_MODE=mock` (or one integration, e.g.
`GEMINI_MODE=mock`) switches to built-in test doubles; it exists for the automated tests and offline
trials, and is refused when `NODE_ENV=production`.

### MongoDB Atlas

1. Create a cluster (M0 is enough to start) and a database user.
2. Network access: allow Northflank's egress IPs (or `0.0.0.0/0` with a strong password).
3. Set `MONGODB_URI=mongodb+srv://user:pass@cluster.xxxxx.mongodb.net/job_flow?retryWrites=true&w=majority`.

Indexes are created automatically on startup.

### Microsoft sign-in

Users sign in with their company Microsoft account (Microsoft Entra ID). The browser signs in with
a popup and sends the ID token to the API, which verifies it. No client secret is needed.

1. [entra.microsoft.com](https://entra.microsoft.com) → **App registrations** → **New registration**.
2. Name: `Job Flow Automation`. Supported account types: **Accounts in this organizational
   directory only** (single tenant).
3. Redirect URI: platform **Single-page application (SPA)**, URI
   `http://localhost:5173/redirect.html`. After deploying, add
   `https://<your-vercel-domain>/redirect.html` under **Authentication**.
4. From **Overview**, copy **Application (client) ID** → `MICROSOFT_CLIENT_ID` and
   **Directory (tenant) ID** → `MICROSOFT_TENANT_ID` on the backend (the frontend reads them from
   `/api/auth/config`).
5. Optional: `ALLOWED_EMAIL_DOMAINS=yourcompany.com`.

Signing in only proves who someone is: they must also be in the user list
(`npm run users -- add …`). If Microsoft shows "Need admin approval", an Entra admin opens the app
→ **API permissions** → **Grant admin consent**.

### HubSpot (through one webhook, no token)

The app never calls HubSpot directly and needs no HubSpot token. Every read and write goes to one
webhook (n8n), set in `HUBSPOT_DEAL_WEBHOOK_URL`. The webhook talks to HubSpot. Requests are
`POST` JSON with an `action` field so one workflow can branch on it
([hubspotClient.js](apps/api/src/services/hubspotClient.js)). `HUBSPOT_DEAL_WEBHOOK_API_KEY`, when
set, is sent in the `HUBSPOT_DEAL_WEBHOOK_API_KEY_HEADER` header (default `x-api-key`).

**1. Read a deal** (when a deal is submitted, and on retries):

```json
{ "action": "fetch", "dealId": "123", "properties": ["dealname", "type_of_role", "…"], "companyProperties": ["name", "domain", "linkedin_company_page", "logo"] }
```

The webhook must reply with JSON (a one-item list or a `data` wrapper also works):

```json
{
  "id": "123",
  "properties": { "dealname": "…", "type_of_role": "…", "technologies_required": "…", "hubspot_owner_id": "…", "…": "…" },
  "company": { "name": "Acme", "domain": "acme.com", "linkedin_company_page": "…", "logo": "…" },
  "owner": { "email": "crm.owner@example.com", "firstName": "…", "lastName": "…" }
}
```

`{ "deal": {...}, "company": {...}, "owner": {...} }` and plain deal properties at the top level are
accepted too. A 404 or an **empty reply** fails the deal as "not found"; 429/5xx/timeouts are retried.
`HUBSPOT_DEAL_WEBHOOK_METHOD=GET` reads with `GET ?dealId=123` (or `{dealId}` in the URL) instead.

**2. Update a deal** (after the job is loaded into the Learning Portal; `HUBSPOT_WRITE_JOB_ID=true`):

```json
{ "action": "update", "dealId": "123", "properties": { "job_id": "<learning portal job id>" } }
{ "action": "update", "dealId": "123", "properties": { "crm": "<owner id>", "profiling_poc": "<owner id>", "ise": "<owner id>" } }
```

The webhook should set those deal properties in HubSpot and reply with any 2xx. The owner update is
sent only when owners were chosen, and a failure there is logged without blocking the job ID update.
The property name for the job ID is `HUBSPOT_JOB_ID_PROPERTY` (default `job_id`).

**What comes from where**: company, role, skills, eligibility, batch, location, CTC and openings come
from HubSpot (property names in `HUBSPOT_PROP_*`, defaults match CRM_Job_Loading). The **expected
pool** is entered in the app when the deal is added and lives only in the app's database; HubSpot
never sets or changes it. The CRM owner, Profiling POC and ISE are chosen in the app from the HubSpot
owner list (the deal owner from HubSpot is used only when no CRM owner was chosen). Required on every
deal: company, role, expected pool and CRM owner.

### HubSpot webhook

1. In the Private App → **Webhooks**: target URL `https://<api-host>/api/webhooks/hubspot`.
2. Subscribe to `deal.propertyChange` for the student-facing properties (role, skills, eligibility,
   batch, location, CTC, employment type, openings, instructions…) plus the expected-pool and owner
   properties.
3. Set `HUBSPOT_CLIENT_SECRET` (the app's client secret) and `HUBSPOT_WEBHOOK_URL` to the exact URL
   above (signatures include the URL, and proxies can change it).

Bursts of changes are merged (`HUBSPOT_UPDATE_DEBOUNCE_SECONDS`). Only changes to student-facing
fields update the portal and email students; others (expected pool, owner) are applied silently.
Updates are processed while the window is open.

### Learning Portal (NKB jobs API): beta and prod

Deals are loaded the way `CRM_Job_Loading/retool_phase1.py` loads them, using the same endpoints,
`x-api-key` header and quoted-JSON bodies
([learningPortalClient.js](apps/api/src/services/learningPortalClient.js),
[portalLoader.js](apps/api/src/services/learningPortal/portalLoader.js)):

| Step | Beta (`LEARNING_PORTAL_BETA_BASE_URL`) | Prod (`LEARNING_PORTAL_PROD_BASE_URL`) |
|---|---|---|
| Organisation (`org_details/create`) | created with one UUID… | …the same UUID |
| Job (`job_details/create`) | created first | same `job_id`, same content |
| Apply link | `LEARNING_PORTAL_BETA_APPLY_LINK_TEMPLATE` | `LEARNING_PORTAL_PROD_APPLY_LINK_TEMPLATE` |
| Test accounts (`user/jobs/create`) | the tool's beta test users for the job's plans | the tool's prod test users |
| Eligible students | listed by `jobs/eligible/users/count/get` | given apply access, 100 per request |

- **Keys**: `LEARNING_PORTAL_BETA_API_KEY` and `LEARNING_PORTAL_PROD_API_KEY` (the tool's
  `BETA_API_KEY` / `PROD_API_KEY` names also work). Base URLs, apply links and test accounts
  (`LEARNING_PORTAL_{BETA,PROD}_BASE_URL`, `_APPLY_LINK_TEMPLATE`, `_TEST_USERS_JSON`) are set only
  in `apps/api/.env`, never in the code. **To test without touching prod**, set `LEARNING_PORTAL_TARGETS=beta` and
  `LEARNING_PORTAL_ACCESS_ENV=beta`.
- **Organisations**: looked up in this app's records, then in the tool's Google Sheet ("NIAT
  Internships", by normalised company name), else created with a new UUID in both environments
  (with a logo found from the website, LinkedIn page or HubSpot). A *similar* but not identical name
  in the sheet stops the step (as the tool does) so nobody creates a duplicate: add the exact name
  with its Org ID (or an empty Org ID for a new organisation) and press **Retry Failed Step**.
- **Content**: the payload ([nkbPayload.js](apps/api/src/services/learningPortal/nkbPayload.js)) and
  the student-facing text ([jobContent.js](apps/api/src/services/learningPortal/jobContent.js)) port
  the tool's rules and prompts: eligibility criteria per enroll plan and the disclaimer are written
  by Gemini (`GEMINI_CONTENT_MODEL`) with the same templates, falling back to the tool's rule-based
  text without AI. The payload is built once and stored, so beta, prod and retries get identical
  content. `show_for_all_users_in_enroll_plans` lists the job for the deal's enroll plans; only
  students granted access can apply.
- **Retries**: each environment is recorded when loaded; a retry after a prod failure re-sends only
  prod, with the same IDs. HubSpot edits during the window update the same job in both.
- **After loading**: the job ID is written to the deal's `job_id` property and to its twin deal in
  the other job pipeline (`HUBSPOT_WRITE_JOB_ID`, needs `crm.objects.deals.write`), and, when
  `JOB_LOADING_SHEET_ID` is set, a row is added to the tool's "Loaded Jobs Tracker". The portal
  "Order" continues from that tracker's last Order.
- **Not ported** (manual steps of the tool's UI): the operator's enroll-plan confirmation before
  prod, NIAT batch selection, the Google-Sheet student lists (`USER_IDS` mode) and the CRM / ISE /
  profiling-agent pickers. Eligible students come from the eligible-users API (`CRITERIA` mode).
- **Deadline**: `apply_by` is the end of the application window (`APPLICATION_WINDOW_HOURS`, 21h),
  not the tool's +24h.

### Eligibility

`ELIGIBILITY_SOURCE=learning_portal` (default in live mode) calls the portal's eligible-users API
with the same filters the existing tool builds, then reads names, emails and phones from
`BIGQUERY_STUDENTS_TABLE`. `ELIGIBILITY_SOURCE=bigquery` filters the students table directly by
batch, program, campus and placement status.

### BigQuery

1. Create a service account with **BigQuery Data Viewer** on the dataset and **BigQuery Job User**
   on the project.
2. `GOOGLE_APPLICATION_CREDENTIALS_JSON` = the key JSON or its base64 encoding.
3. Set `BIGQUERY_PROJECT_ID`, `BIGQUERY_DATASET`, `BIGQUERY_LOCATION` and the tables. Table names
   may be `table`, `dataset.table` or `project.dataset.table`.
4. Default column names are in [config/bigquery.js](apps/api/src/config/bigquery.js); override any
   with `BIGQUERY_COLUMNS_JSON`, e.g. `{"applications":{"studentId":"uid","jobId":"job_id"}}`.
   Applications are matched on the **Learning Portal job ID**.

Missing GRIT/assessment/interview tables or rows show as N/A; they never fail the analysis.

### Gemini

`GEMINI_API_KEY` from Google AI Studio; `GEMINI_MODEL=gemini-2.5-flash-lite`. Output is strict JSON
validated with Zod; the prompt forbids inventing experience and treats resume text as untrusted.
One candidate's failure is recorded and the rest continue; failed candidates are re-analysed when
the step is retried.

### AWS SES

1. Verify the sender domain (DKIM) or address in the region you use, and move the account out of
   the SES sandbox.
2. An IAM user limited to `ses:SendEmail`; set `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `SES_FROM_EMAIL`, and optionally `SES_CONFIGURATION_SET`.
3. `SES_MAX_SEND_RATE` must stay at or below your SES sending rate.

Throttling and outages are retried; rejected addresses fail that one email only.

### NxtDial

`NXTDIAL_BASE_URL`, `NXTDIAL_API_KEY`, `NXTDIAL_AGENT_ID`, `NXTDIAL_FROM_NUMBER`. Reminder calls go to
`POST /api/alert` as multi-number requests of `NXTDIAL_CHUNK_SIZE` with
`variables: { company, role, deadline }`. Only eligible non-applicants with a valid phone are called,
once per reminder. 429 waits for `Retry-After`; 5xx retries with backoff; 401/403 fail without
retrying. `NXTDIAL_DAILY_REQUEST_LIMIT` (default 5,000) caps daily requests.

### Priority

`overall = Σ weight × score` over resume, GRIT, assessment and interview, with the
`PRIORITY_*_WEIGHT` values normalised to 100%. With `PRIORITY_MISSING_SCORE_STRATEGY=renormalize`, a
missing GRIT/assessment/interview score is left out of that candidate's weighting; a missing resume
counts as 0. Ties go to the higher resume score, then the earlier application. The AI priority is
stored separately and never overwritten; the PSM's final priority is authoritative (taking a
priority another candidate holds swaps the two), and every change is recorded in
`candidate_priority_history`.

---

## Deployment (Northflank + Vercel + MongoDB Atlas)

### Backend on Northflank

1. Push the repository to GitHub and connect it to Northflank.
2. Create a **secret group** with the production variables from `.env.example`
   (`NODE_ENV=production`, `INTEGRATION_MODE=live`, secrets, `FRONTEND_URL`, …).
3. **Service 1: API** (combined service)
   - Build: Dockerfile `docker/api.Dockerfile`, build context `/`.
   - Port `8000`, HTTP, public. Health check `GET /health` (readiness: `GET /ready`).
   - Command: default (`node src/server.js`), `PROCESS_ROLE=api`.
4. **Service 2: Worker**
   - Same repository and Dockerfile (or a deployment service reusing the API's image).
   - Command override: `node src/worker.js`. No public port.
5. Link the secret group to both services.

If your plan allows only one service, run the API with `PROCESS_ROLE=all`: the worker then runs
inside the API process (the code paths stay separate). Keep at least one instance running at all
times; the 21-hour workflow needs the worker to wake up tasks.

### Frontend on Vercel

1. New project → root directory `apps/web`, framework **Vite** (`vercel.json` is included).
2. **Recommended:** keep the API on the same origin so the session cookie is first-party. Add a
   rewrite as the first entry in `apps/web/vercel.json`:
   ```json
   { "source": "/api/:path*", "destination": "https://<your-northflank-api-host>/api/:path*" }
   ```
   and leave `VITE_API_BASE_URL` empty, with `COOKIE_SAMESITE=lax` on the API.
3. Alternative: set `VITE_API_BASE_URL=https://<api-host>` and on the API
   `COOKIE_SAMESITE=none` and `CORS_ORIGINS=https://<your-vercel-domain>`. Browsers that block
   third-party cookies (Safari) may not keep the session this way.
4. Add `https://<your-vercel-domain>/redirect.html` as a **Single-page application** redirect URI
   in the Entra app registration, and set `FRONTEND_URL` on the API (public links are built from it).

### CI/CD

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs lint, frontend typecheck and build,
backend tests (in-memory MongoDB), `npm audit`, gitleaks and a Docker build on every push and PR.
Enable Northflank's and Vercel's GitHub integrations with "deploy only when checks pass" so nothing
deploys on a red build.

---

## Running and testing

| Command | What it does |
|---|---|
| `npm run dev:db` | in-memory MongoDB (local only) |
| `npm run dev:api` | API with auto-reload |
| `npm run dev:worker` | worker with auto-reload (when not using `PROCESS_ROLE=all`) |
| `npm run dev:web` | frontend dev server with `/api` proxy |
| `npm run start -w apps/api` | API (production) |
| `npm run worker -w apps/api` | worker (production) |
| `npm test` | backend test suite (100 tests) |
| `npm run lint` / `npm run typecheck` / `npm run build` | quality gates |

The tests drive the real workflow with a controllable clock and mock integrations, and cover:
role authorization and CSRF; one job per deal (including concurrent submits); clean failure of an
unknown deal and retry; the 10h/20h rules (non-applicants only, skipped when the target is reached,
no duplicates on re-run); the 21h close, final pool and ranking; one AI failure not failing the rest;
BigQuery outages; webhook signature, relevant vs irrelevant changes and duplicate events; PSM swaps,
audit history, freeze, a single CRM email and the public page; and NxtDial chunking, 429
`Retry-After`, 401 and 5xx handling.

### Logs

Each request is one line with the endpoint, status, time taken and the signed-in user:

```
11:05:21 INFO  GET    /api/crm/deals?page=1&limit=20  200  88 ms  admin@example.com
11:05:21 INFO  DELETE /api/crm/deals/6ac0fcfe13a9bb4fc70a58a5  204  647 ms  admin@example.com
11:03:57 WARN  Task failed; retry scheduled  type=FETCH_DEAL attempt=2 — HubSpot deal webhook returned HTTP 500
```

`LOG_FORMAT=pretty` (default outside production) prints these readable lines; `LOG_FORMAT=json`
(default in production) prints one compact JSON object per line (`http: { method, url, status, ms,
user }`) for log search. Headers are never logged, public link tokens show as `***`, and requests
the browser cancelled are logged only at `LOG_LEVEL=debug`.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| A deal fails with "… is not set up yet: add …" | Add the listed keys to `apps/api/.env`, restart the API, then press **Retry Failed Step**. The startup warnings list everything still missing. |
| "Access Denied" after Microsoft sign-in | Add the email with `npm run users -- add …`; check `isActive` and `ALLOWED_EMAIL_DOMAINS`. |
| Microsoft popup shows `AADSTS50011` (redirect URI mismatch) | Add the exact `https://<domain>/redirect.html` as a **Single-page application** redirect URI. |
| Microsoft says "Need admin approval" | An Entra admin grants consent: app registration → **API permissions** → **Grant admin consent**. |
| "Allow pop-ups for this site" on the login page | The browser blocked the sign-in popup; allow pop-ups for the site. |
| Logged in, but the next request is 401 in production | Cross-site cookie blocked: use the Vercel `/api` rewrite, or `COOKIE_SAMESITE=none` + HTTPS. |
| Deals stay "Pending" | The worker is not running (`GET /ready` shows the last worker heartbeat). |
| Deal fails with "missing required fields" | Map the property with `HUBSPOT_PROP_*` or fill it on the deal, then Retry Failed Step. |
| Webhook returns 401 | `HUBSPOT_CLIENT_SECRET` and `HUBSPOT_WEBHOOK_URL` must match the app and the exact URL HubSpot calls; server clock must be accurate. |
| Applied count stays 0 | The applications table's job-ID column must contain the Learning Portal job ID; check `BIGQUERY_COLUMNS_JSON`. |
| Every candidate shows "AI analysis failed" | Gemini key/quota; the step retries automatically, then Retry Failed Step. |
| Emails not arriving | SES sandbox, sender verification, `SES_FROM_EMAIL`; see `View Logs` on the deal. |
| Calls not placed | `View Logs` shows skipped (no phone / daily limit), rate-limited or failed calls with the reason. |

---

## Assumptions to confirm before go-live

These could not be verified from the information available and are configurable:

1. **Learning Portal update**: no separate update endpoint is known, so updates (and a retried
   load) re-send the create call with the same `job_id`. Confirm the portal upserts.
2. **Student job URL**: emails link to the prod apply form unless `LEARNING_PORTAL_JOB_URL_TEMPLATE`
   points to a student-facing job page.
3. **Eligibility source**: like the tool, the eligible-student list is read from **beta** and access is
   granted in **prod** (`LEARNING_PORTAL_ELIGIBILITY_ENV`); confirm beta returns prod user IDs.
4. **n8n deal webhook**: it must answer `action: "fetch"` with the deal JSON and apply `action: "update"`
   properties to the HubSpot deal (see HubSpot above).
5. **BigQuery schemas**: table and column names for applications, students, GRIT, assessments and
   interviews.
6. **NxtDial response**: call IDs are read from `calls[].id` (or the request `id`) in the
   `/api/alert` response; adjust `collectCallIds` if the documented shape differs.
7. **Application window**: 21 hours as specified (the handwritten note said 24); it is
   `APPLICATION_WINDOW_HOURS`.
8. **Priority weights**: the defaults (40/25/20/15) are placeholders until the team agrees on them.
