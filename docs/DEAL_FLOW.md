# What happens after a deal is submitted

This document walks through every step Job Flow Automation takes after a CRM submits a HubSpot deal,
in order, for both flows: **Automatic** and **Step by step**, up to the company interviews on Google
Meet. It also lists what the admin and CRMs can switch on or off, what has to be set up, where the app
runs, and what happens when something goes wrong.

---

## 1. What the admin and CRMs control

### Admin: Settings → Config

All of this applies to every company and every deal, as soon as it is saved. Everything is on by
default.

| Setting | What it controls |
|---|---|
| Flows CRMs can choose | Both (the CRM picks Automatic or Step by step for each deal), only one, or none |
| Flow used when the CRM does not choose | The flow every deal uses when no choice is shown, and the one selected first when both are shown |
| Steps that need approval | Which of the five Step by step stops are used (see section 5) |
| Emails to students | Job email when applications open · Job update emails · Reminder emails from the Boost page |
| Checkpoints | First checkpoint reminder emails · Second checkpoint reminder emails · Second checkpoint AI calls |
| Emails to CRMs | Expected pool reached · Candidate pool ready (the shared profiles link) |
| AI calls | Master switch for every AI call: the automatic second-checkpoint calls and calls started from the Boost page |
| Interviews | Google Meet from the Interviews page |
| Automation | AI-written job text · AI resume analysis · Write the job ID to HubSpot |
| Timing | Application window length (default 21 h) · first and second checkpoint (default 10 h and 20 h after the window starts) · gap between Boost page reminder emails (default 60 min) |

When a switch is off, that action is skipped, the reason is recorded on the deal, and the deal
carries on. Nothing is sent. Call length and voice are set on the agent in NxtDial, not here.

### CRMs and admins: Companies page

Each company row has three switches, on by default: **1st Reminder**, **2nd Reminder** and **2nd AI
Calls**. A CRM or admin can turn any of them off for that one company. An action runs only when both
the admin setting and the company setting are on; when the admin has turned one off for everyone, the
company switch shows as off and locked.

### PSM: company page columns

On the PSM review page, **Company page columns** sets which columns the company sees on the shared
profiles page. The last saved choice is used for every company after it.

### CRMs and admins: Interviews page

- **Connect Google** (once for everyone): the Google account that creates every Meet. Any CRM or
  admin can connect, reconnect or disconnect it.
- **Company interviewer emails**, saved per company and added to that company's Meets.
- The **Meet** button on each student row works only when the admin's Interviews switch is on and a
  Google account is connected (see section 8).

---

## 2. What has to be set up

| What | Used for |
|---|---|
| HubSpot deal webhook (n8n) | Reading the deal, company and owner, and writing the job ID back |
| Learning Portal Beta and Prod keys | Organisations, jobs and student access |
| Eligible Pool page | The students who can get each job (NIAT and Academy), with their email and mobile |
| BigQuery views | The applied pool: application details and personal details per student and job |
| AWS SES | Every email |
| Gemini | AI-written job text and AI resume analysis |
| Redis Cloud (`REDIS_URL`) | The queue that analyses resumes one at a time |
| NxtDial (key, number, agent) | AI calls |
| Google OAuth client (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and one connected Google account | Google Meet interviews with auto-recording (see section 8) |
| `FRONTEND_URL` | The web address: links in emails (shared profiles link, job update form) and the Connect Google return address |
| Sign-in (same OAuth client, user type External, plus AWS SES) | Signing in to the app with **Sign in with Google** or with an **emailed 6-digit code**. Either way the email must be in Settings → Users (and in `ALLOWED_EMAIL_DOMAINS`). A session lasts `SESSION_TTL_HOURS` (default 168 hours, 7 days). The test login without a password works only on a developer's computer |
| Old tool's Google Sheet (optional, read only) | Reusing the old tool's organisation IDs and continuing its Order numbers |

The app starts even when something is missing. Only the step that needs it stops, with a message
saying what to add.

---

## 3. Submitting a deal (CRM)

On the **Dashboard**, the CRM fills in:

| Field | Notes |
|---|---|
| HubSpot Deal ID | The ID or the full deal link |
| Expected Pool | How many applications the deal should get (whole number, 1 or more) |
| CRM Owner | Required. Defaults to the signed-in CRM |
| Profiling POC, ISE | Optional |
| Flow | Only the flows the admin allows are shown; none means the admin's flow is used. The **ⓘ** icon explains each flow |

The JD count is **not** entered. It is worked out automatically (step A2).

The CRM clicks **Submit**, checks the summary in the confirmation box and clicks **Confirm and
submit**. If the server is briefly reconnecting to the database, the form waits and tries again on its
own, so one click is enough. The deal appears in the table straight away as **Submitted**. If the same
Deal ID was already submitted, no second deal is created.

---

## 4. Automatic flow, step by step

Every step below runs on its own, one after another. The **Current Step** column in the Deals table
shows where the deal is.

### Part A: Prepare and load the job

**A1. Fetch the deal from HubSpot**
- The app reads the deal, its company and owner through the n8n HubSpot webhook.
- It maps the fields: company, website, LinkedIn, role, skills, eligibility, location, CTC or
  stipend, openings, job type, duration, pass-out year (batch), course plans and so on.
- Everything is saved in our database: the mapped fields on the deal, and a snapshot of the raw
  HubSpot deal, company and owner.
- If a required field is missing (for example the company name), the deal **fails** at this step
  with the missing field names. Fix the deal in HubSpot and click **Retry**.

**A2. Work out the JD count** (at the same time as A2b)
- The app counts earlier deals in its own database for the same company and adds one: the first
  deal for a company is JD 1, the second is JD 2, and so on.
- Company names are compared without case, punctuation or endings such as "Pvt Ltd", so
  "ACME" and "Acme Pvt Ltd" count as the same company. Stopped and failed deals count; deleted
  deals do not. A retried deal keeps its number.

**A2b. Find the company logo** (at the same time as A2, same order as the old tool)
1. Logo services for the company website domain: Clearbit, then Google, then Hunter.
2. The company website itself: its "logo" data, then its share image, then an image named "logo".
3. A guess from the LinkedIn company page name (`<name>.com`) with the same logo services.
4. The logo saved in HubSpot (company logo link), unless it is HubSpot's default placeholder.
5. Nothing found: the deal carries on without a logo.

A logo only counts if its link really opens. The logo is saved on the deal, shown in the deal
details and approval panel, and used for the organisation in the Learning Portal.

**A3. Prepare the job**
- Find the company's **organisation**: first among organisations this app has used before, then in
  the old tool's Google Sheet (read only, if connected). If it is not found, a new organisation is
  created with a new ID, the company name, website and logo.
- Create one **job ID** (a new UUID), used in both Beta and Prod.
- Write the job text: title, description, eligibility and disclaimer. Gemini writes it when
  "AI-written job text" is on; otherwise the rule-based text is used.
- Set the apply-by deadline (now + the window length), the course plans and the job details sent to
  the portal: locations, CTC, skills, openings, durations, job type, apply link, CRM, Profiling POC,
  ISE and the HubSpot deal ID. The Order number continues from the old tool's tracker sheet when it
  is connected.

**A4. Load into Beta, then Prod**
- The organisation is created in each portal if it is new there.
- The job is created in **Beta**, and Beta test accounts get access.
- The same job ID is then created in **Prod**, and Prod test accounts get access.
- Status: **Job Loaded (Beta & Prod)**.

**A5. Updates to other tools** (run alongside B1)
- The job ID, JD count and the CRM / Profiling POC / ISE owners are written to the HubSpot deal
  (if "Write the job ID to HubSpot" is on).
- All loaded-job details are saved in our database. Nothing is written to any Google Sheet.

### Part B: Students

**B1. Find the eligible students**
- Students come from the **Eligible Pool** page (not straight from BigQuery).
- The deal's course plans decide the products: **NIAT** and/or **Academy**. A deal whose plans are
  neither stops here with a clear message.
- Only students marked **Eligible** in those products are picked. Placed, Mint, Do not Provided and
  Not Interested are left out.
- If the deal has a pass-out year, students with a different year are left out; students with no
  year set are kept.
- The list is saved for the deal: user ID, name, email, mobile, campus, batch and the Learning Portal
  job ID.
- If nobody matches, the deal **fails** here with a clear message. Add students on the Eligible Pool
  page, then click **Retry**.
- Status: **Eligible Students Identified**.

**B2. Give students access**
- The eligible students get apply access to the job in the Learning Portal (Prod), by user ID and
  job ID, 100 students per request.
- The access time is saved for each student. IDs the portal refuses are saved with the reason and
  the rest still get access.
- Status: **Granting Access**.

**B3. Open the application window and email students**
- The application window opens (default **21 hours**). The 10 h and 20 h checkpoints, the 30-minute
  checks and the 21 h close are scheduled. If the window starts later than planned (for example
  after Step by step approvals), the deadline in Beta and Prod is moved to match.
- Every student with access and an email gets the **job email** with the apply link (if "Job email
  when applications open" is on).
- Status: **Application Window**.

### Part C: The application window

**C1. Applied pool refresh (every 30 minutes, active jobs only)**
- While the window is open, the app reads this job's applicants from BigQuery by its job ID: the
  application details (applied time, stage, product, education, location) and the personal details
  (name, email, mobile, resume), joined by user ID.
- Each applicant is saved once per job in our database; later refreshes update the same record, so
  there are no duplicates. Students who applied are marked as applied.
- The Applied and Progress columns update. Closed jobs are not refreshed again.

**C2. Expected pool reached**
- If applications reach the Expected Pool, the CRM who submitted the deal gets one email
  (if "Expected pool reached" is on). The window **stays open** until the end, and the checkpoints
  still remind students who have not applied.

**C3. First checkpoint (10 h)**
- The applied pool is refreshed first.
- Every student who got access and **has not applied** gets a reminder email through AWS SES. It
  names the company, role and closing time; it has no apply link. Students who applied never get
  it, and nobody gets the same reminder twice.
- Nothing is sent to the CRM and no AI calls are made.
- Can be turned off by the admin (Checkpoints, for every company) or by a CRM or admin for one
  company (Companies page).

**C4. The Boost applications page (CRM, optional)**
- Opened from the deal's details. Shows Expected Pool, Applied, Not Applied and AI call results.
- The CRM can send a reminder email to students who have not applied (again after the set gap) or
  start AI calls by hand, if the admin allows them.

**C5. Second checkpoint (20 h)**
- The applied pool is refreshed first.
- Students who still have not applied get a final reminder email (no apply link).
- **AI calls** start automatically to the students who have not applied and have a valid mobile,
  through NxtDial:
  - one shared agent; each call uses the student's name, company, role, a short spoken summary of
    the job and the deadline;
  - two-way, short calls, one student after another; students already reached are not called again;
  - every few minutes the app reads back each call's status, duration, recording, summary and
    answers (Interested, Will Apply, reason, questions, call back), shown on the Boost page.
- Nothing is sent to the CRM.
- The reminder and the AI calls can each be turned off by the admin for every company or by a CRM or
  admin for one company. AI calls also need the admin's AI calls switch on and NxtDial set up.

**C6. HubSpot changes during the window (checked every 30 minutes)**
- Every 30 minutes, while the window is open, the app reads the deal from HubSpot again.
- If a student-facing field changed (for example location, CTC, skills, eligibility), the job is
  updated in our database and the same job is updated in the Learning Portal (Beta and Prod).
- Every student who **applied** gets a "Job updated" email (if "Job update emails" is on) that lists
  only the changed fields (old → new) and one link: a short form asking if they are still
  interested.
- The link looks like `/job-update/<job ID>/<update code>?user_id=<student ID>`: the same for
  everyone except the student ID at the end. Only students who applied to that job can use it.
- The form asks "Are you still interested?" (Yes / No), the main reason when the answer is No
  (location, CTC or stipend, role or skills, timing, other) and optional comments. Each student's
  answer is saved for that company and job, and can be changed later.
- The answer shows in the **Interested** column of the applied pool in PSM review.

**C7. Window closes (21 h)**
- The window always closes at the end, never earlier, even if the pool was reached.
- Status: **Applications Closed**.

### Part D: Candidate ranking and review

**D1. Final applicant list**
- The applied pool is read one last time and frozen as the final list.
- Status: **Applied Pool Ready**.

**D2. AI resume analysis (NIAT students only, one resume at a time)**
- Only applicants from **NIAT** get an AI resume score. Academy applicants are marked "No AI resume
  analysis" and get no resume score and no GRIT score, even when the deal covers both products.
- NIAT resumes go into a queue in **Redis Cloud** and are analysed **one at a time** by Gemini. Each
  resume is tried up to three times. The step checks the queue every 30 seconds and moves on when
  every resume is done; anything still waiting after 2 hours is marked failed.
- If "AI resume analysis" is off in Settings, resumes are marked as skipped.
- Status: **AI Analysis**.

**D3. Priority ranking**
- Resume, GRIT, assessment and interview scores are combined into one overall score and candidates
  are ranked P1, P2, … Each is marked Recommended, Consider or Not Recommended.
- GRIT scores are read for NIAT students only. Academy students are ranked on assessment and
  interview scores; with neither, they go to the end as Consider.
- Status: **PSM Review** (ready).

**D4. PSM review (PSM)**
- The PSM opens the deal in **Candidate Pools**, reviews the ranked candidates (scores, AI reason,
  resume, Interested answer), changes priority, status and remarks where needed, and **submits** the
  final pool.
- **Company page columns**: the PSM picks the columns the company sees, from Final Priority, Student
  Name, Campus, Resume, Relevant Skills, the AI Resume / GRIT / Assessment / Interview / Overall
  scores, Candidate Status, Interested and PSM Remarks. The choice is saved and used for every
  company after it, until a PSM changes it again.
- After submitting, the pool is frozen and the shared profiles link is created:
  `/shared/profiles/<Learning Portal job ID>`.

**D5. CRM gets the shared profiles link**
- The CRM who loaded the deal gets an email with the link (if "Candidate pool ready" is on).
- The page works like a spreadsheet:
  - it shows the columns the PSM picked, sorted by final priority, with resume links;
  - anyone with the link (the CRM, the company) can edit any cell, add rows (new profiles) and add,
    rename or delete their own columns;
  - changes save straight away and everyone sees them within 30 seconds;
  - the shortlisted profiles cannot be deleted; rows added on the page can.
- Hidden columns, student IDs, emails, mobiles and resume storage addresses are never sent to the
  page. Because the link uses the job ID, which also appears in students' apply links, share it only
  with the company.
- The link expires after 30 days.
- Status: **Completed**.

**D6. Interviews (CRM)**
- The company now appears on the **Interviews** page with its shared profiles link.
- The CRM opens it, adds the company's interviewer emails and clicks **Meet** on each student the
  company wants to interview. Every Meet is created with auto-recording on and saved in the row
  (section 8).

---

## 5. Step by step flow

The steps are exactly the same as the Automatic flow. The difference is that the deal **stops** before
the steps the admin turned on, shows **Waiting for Approval** in the Deals table, and waits.

| Stop (if turned on) | Happens after | What the reviewer sees | What runs after approval |
|---|---|---|---|
| **1. Deal details** | A1–A2b | The fields read from HubSpot, JD count, company logo | A3: organisation lookup and job preparation (nothing is sent yet) |
| **2. Load into Beta** | A3 | Organisation (new or existing), job ID, apply link, course plans (can be changed here), eligibility text, disclaimer | The job is created in Beta, Beta test accounts get access |
| **3. Load into Prod** | Beta load | The same details, plus where it is already loaded | The same job is created in Prod |
| **4. Give students access** | B1 | Number of eligible students, how many have an email and a mobile | B2: students get access |
| **5. Email students and start window** | B2 | Students with access, emails to send (or that the job email is turned off), window length, checkpoint times, closing time | B3: emails and the window; everything after that runs on its own |

How it works for the person approving:

1. In the Deals table the deal shows **Waiting for Approval** and the step name, for example
   "Approve: Load into Beta".
2. Click **Review** to open the approval panel and check what the step will do.
3. Click **Approve and continue** to run the step. The deal moves on to the next stop.
4. Or click **Stop deal** to end the deal. Nothing more runs.

Notes:
- Each deal keeps the flow it was submitted with.
- Any CRM or admin can approve. Every approval is recorded with who approved and when.
- A deal can wait at a stop for as long as needed; nothing times out.
- Course plans can only be changed before the job is loaded into Beta, so Beta and Prod stay the same.
- After stop 5, the rest (window, checkpoints, HubSpot checks, close, AI analysis, ranking, PSM
  review, shared link, interviews) runs exactly as in the Automatic flow (Parts C and D).
- If the admin turns off a stop, deals waiting there continue on their own, recorded as approved by
  that admin.

---

## 6. When something goes wrong

| Situation | What happens | What to do |
|---|---|---|
| A step fails (for example a missing HubSpot field, the portal is down, no eligible students) | The deal shows **Failed** with the step name and the reason. Temporary problems are retried automatically first | Fix the cause, then click **Retry** on the deal |
| `REDIS_URL` is not set | The API runs, but the AI analysis step stops with a message | Add `REDIS_URL` to `apps/api/.env` and restart, then **Retry** |
| NxtDial is not set up, or no student has a mobile | The second checkpoint records "AI calls not started" with the reason; the reminder emails still go | Set up NxtDial or add mobiles in the Eligible Pool |
| An email or AI call is turned off (admin or company) | That action is skipped and the reason recorded on the deal | Turn it back on in Settings → Config or on the Companies page |
| The CRM wants to end a deal | **Stop deal** (while it is running or waiting) | Nothing more runs. The deal stays in the list as Stopped |
| A deal was submitted by mistake | **Delete** (only when it is safe to delete) | The deal is removed |
| The shared profiles link is older than 30 days | The page says the link has expired | Links last 30 days by default (`PUBLIC_LINK_EXPIRY_DAYS`); share the profiles before then |
| Google Meet is not connected, or Google removed the access | The Interviews page shows Connect Google or Reconnect Google, and the Meet button is greyed out | Click Connect Google and sign in as the interview account (section 8) |
| Google refuses a Meet | The popup shows Google's message | Fix what it says, then click Create Meet again |
| The Meet was created but auto-recording is not on | The Meet and invites stay; the Auto-recording cell says why | Check the organizer's Workspace plan and that recording is allowed, or start recording by hand in the Meet |
| Connect Google shows `redirect_uri_mismatch` | Google does not know the return address | Add `<web address>/api/interviews/google/callback` to the OAuth client's redirect URIs (it can take a few minutes to apply) |
| Nobody can sign in on the live site | There is no test login in production | Put the first admin's email in `BOOTSTRAP_ADMIN_EMAILS`, then add the other users in Settings → Users |
| The sign-in code email does not arrive | Codes go only to active users, at most once a minute | Check the email is in Settings → Users and spelled the same, check spam, then click Send a new code after a minute |
| Google says "access blocked" when signing in or connecting | The account is outside the company Workspace (the app is Internal) | Use an account of the company Workspace |

---

## 7. Status names in the Deals table

| Status | Meaning |
|---|---|
| Pending | Submitted, about to start |
| Processing | Fetching the deal, loading the job, finding students, giving access, emailing |
| Waiting for Approval | Step by step: waiting at a stop |
| In Progress | The application window is open, or the applicants are being collected |
| AI Analysis | Resumes are being analysed and candidates ranked |
| PSM Review | Ready for, or under, PSM review |
| Completed | The final pool was submitted and the shared profiles link was created |
| Failed | A step failed; see the reason and retry |
| Stopped | Ended by a CRM or admin |

---

## 8. Interviews page and Google Meet (CRMs and admins)

**Interviews** in the menu lists every company whose shared profiles link has been created: company,
job role, the link (click to open, or copy), whether it is active or expired, and how many profiles,
Meets and interviewer emails it has. **Open** shows that company's sheet.

**The sheet** has the same rows and columns as the company's shared profiles page, and edits made here
show there too. It also has columns with a lock that only appear on this page: **Student Email**
(filled from our database for shortlisted students), **Meet Link**, **Meet Time** and **Auto-recording**,
plus any columns added on this page. Every cell can be edited except Auto-recording. Rows added here
also appear on the company's page.

**Company interviewer emails** are saved per company at the top of the page. They are never sent to the
shared profiles page.

**Connect Google (once).** Meets are created from one Google account, the interview account. A CRM or
admin clicks **Connect Google** at the top of the Interviews page, signs in as that account and clicks
**Allow**. The card then shows "Google Meet connected" with the account. The permission is stored
encrypted in MongoDB and never leaves the server. **Disconnect** removes it. If Google later withdraws
the access (password change, access removed), the card shows **Reconnect Google**.

**Meet button** (one per student row) is greyed out, with the reason, until the admin's Interviews
switch is on and a Google account is connected. It opens a popup with:

| Field | Filled in with | Can be changed |
|---|---|---|
| Event name | "Company interview – Student name" | Yes |
| Date and time, length | Tomorrow 11:00, 30 minutes (15 minutes to 8 hours) | Yes |
| Organizer | The connected Google account; invites come from it | No |
| CRM (you) | The signed-in CRM, added as a guest | No |
| Student email | The row's Student Email cell | Yes |
| Company interviewer emails | The company's saved list; the "Save these interviewer emails" tick keeps changes for the company | Yes |
| Other guests, description | Empty / a short description | Yes |

On **Create Meet**:
1. Google Calendar creates the event on the connected account's calendar with a Meet link and emails
   the invite to the CRM, the student, the interviewers and other guests.
2. The Google Meet API turns on auto-recording and transcripts for that Meet.
3. The Meet link, time and recording state ("On, with transcript") are saved and shown in the row.

The button then reads **Update**. Clicking it moves the same event: the Meet link stays and Google sends
the new time to every guest. Two clicks at once cannot create two Meets for the same student.

Recording starts when the connected account (or a teammate in the same Workspace allowed to record)
joins; students and company interviewers cannot start it. Recordings and transcripts go to the connected
account's Google Drive.

**Set-up (once, no Workspace admin needed):**
1. In the Google Cloud project of the sign-in client, enable the **Google Calendar API** and the
   **Google Meet REST API**.
2. **Google Auth Platform → Audience:** user type **Internal**.
3. **Data Access:** add `calendar.events`, `meetings.space.settings`, `openid` and `userinfo.email`.
4. **Clients:** on the web client, add the redirect URI `<web address>/api/interviews/google/callback`
   (locally `http://localhost:5173/api/interviews/google/callback`) and create a client secret.
5. `apps/api/.env`: `GOOGLE_CLIENT_SECRET`, and `GOOGLE_MEET_ORGANIZER_EMAIL` with the interview account
   (only that account can then be connected). Set `GOOGLE_OAUTH_REDIRECT_URI` when the API is not
   reached through the web address.
6. Check the account can record: in Google Calendar, create an event, add Google Meet, open the gear
   icon → Meeting records → "Record the meeting" must be there.
7. Restart the API, open Interviews and click **Connect Google**.

Alternative: with `GOOGLE_MEET_CREDENTIALS_JSON` set, a service account with domain-wide delegation
(granted by the Workspace super admin) is used instead of Connect Google.

---

## 9. Where the app runs

| Part | Where | Notes |
|---|---|---|
| Web app (what users open) | Vercel | Every `/api/...` request is passed on to the API, so the browser only ever talks to the web address. Sign-in, the shared profiles page and Connect Google all use that one address |
| API, workflow worker and resume queue | Northflank | One service (`PROCESS_ROLE=all`), always on, because the 10 h, 20 h and 21 h steps need the worker awake |
| Database | MongoDB Atlas | Deals, students, sheets, Meets and the encrypted Google permission |
| Resume queue | Redis Cloud | One resume at a time |

Keys and passwords live only in the Northflank secret group and in `apps/api/.env` on a developer's
machine, never in the repository. The README's Deployment section has the full set-up.
