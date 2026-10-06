# UI Specification

The internal app is a light SaaS dashboard ("CRM · Deal Tracker"): a header with the logo, a left
sidebar, and pages for the CRM dashboard, deals, companies, settings and PSM candidate pools. There
is also a login page and a public read-only candidate pool page. API shapes are in
[API_CONTRACT.md](./API_CONTRACT.md).

## Rules

- No dashboard charts, statistics cards, reports, notifications or breadcrumbs.
- No BRAVE, Nxtgroom or NxtDial branding. No camera, TensorFlow or Capacitor.
- Tables are the primary UI. Desktop-first; must work at 1366×768, 1440×900 and 1920×1080. Below
  1024px the sidebar becomes a row of links under the header and tables scroll horizontally.

## Design tokens

| Token | Value |
|---|---|
| Font | System UI font (Segoe UI on Windows, San Francisco on macOS) |
| Primary | `#5B3DF5` → `#6047FF` gradient on buttons, logo and selected toggle |
| Primary soft (active nav, icon tiles) | `#F1EFFF` |
| Page background | `#F7F9FC` |
| Card / header / sidebar background | `#FFFFFF`; table header `#FBFCFF` |
| Border | `#E4E9F3`; hero card `#D6D4FF`; inputs `#D8DFEB` |
| Text | `#101A3A` |
| Secondary text and icons | `#7183A8` |
| Links | `#2563EB`, semibold |
| Shadow | very light: `0 1px 3px rgba(15, 23, 42, 0.06)`; purple glow on primary buttons |
| Radius | tables and cards 10px (like FacultyTrack), hero card 12px, inputs/buttons/nav items 8–10px |

Typography follows Nxtgroom: 14px body and table text, 12px small text; table headers and labels
are 12px bold uppercase with wide letter spacing; key values semibold; dialog and drawer titles 18px bold.

Status chip tones (subtle background, darker text, pill shape, 12px bold text):
green, blue, purple, orange, yellow, gray, red. Do not make the UI overly colourful.

Toolbar controls (search, dropdowns, refresh) are 40px tall with 14px text. Tables follow the FacultyTrack table: white
52px header row (12px bold uppercase, muted), 60px body rows with 20px cell padding, thin row lines,
subtle row hover, sticky header, ellipsis action menus. The row's key value (Deal ID) is bold and the
company semibold; secondary text (job role) is slate. Status pills have a thin tinted border and a
small icon (✓ completed, ✕ failed, clock waiting, dot in progress, dashed circle pending/stopped).
Every table fills the rest of the page height (minimum 320px) and scrolls inside itself: the header
row stays pinned, the horizontal scrollbar sits at the bottom of the table, and the page header and
sidebar never scroll away. An empty table shows its message centred in the box with no scrollbar. Empty states show a pale
round icon with three small purple accent lines, a dark title and a muted hint.

## Layout (all internal pages)

- **Header** (64px, white, bottom border): left, a 36px rounded purple gradient tile with a white
  bar-chart icon, then `CRM` (bold) over `Deal Tracker` (muted); on PSM pages `PSM` over
  `Candidate Review`. The logo links to the user's home page. Right: purple initials avatar, the
  email, a chevron; the dropdown has **Logout**.
- **Sidebar** (240px, white, right border, starts under the header): 44px items, 15px text, 20px outline icons;
  the active item has a `#F1EFFF` background and purple icon and text. A divider sits at the bottom.
  Items by role: CRM → Dashboard, Deals, Companies, Settings; PSM → Candidate Pools, Settings;
  ADMIN → all five.
- **Content**: 24px padding.

Sizes follow the FacultyTrack (Nxtgroom) dashboard: compact controls and 14px body text, so the
page stays readable at 125% Windows display scaling.

## Routes

| Route | Access | Content |
|---|---|---|
| `/` | any | Redirects: not signed in → `/login`; CRM → `/crm`; PSM → `/psm`; ADMIN → `/crm` |
| `/login` | public | **Sign in with Microsoft** button centred on the page (plus dev-login email box only when `devLoginEnabled`) |
| `/crm` | CRM, ADMIN | Dashboard: "Add a HubSpot Deal" card + deals table |
| `/crm/deals` | CRM, ADMIN | Deals table only (same filters, actions and drawers) |
| `/crm/companies` | CRM, ADMIN | Companies with deal counts by state; **View deals** opens `/crm/deals?company=…` |
| `/settings` | CRM, PSM, ADMIN | Account (name, email, role, HubSpot owner, access) and **Sign out**. Admins pick their own HubSpot owner here and get a **Users** section: add user (email, name, role, HubSpot owner) and a table to change role, owner and access inline |
| `/psm` | PSM, ADMIN | PSM company-wise dashboard |
| `/psm/jobs/:jobId/review` | PSM, ADMIN | Candidate review |
| `/public/candidate-pool/:token` | public | Read-only candidate pool (no header, no auth) |

Unknown email after Microsoft sign-in → show an **Access Denied** state. A signed-in user opening a
page their role cannot access → Access Denied state (not a redirect loop).

## Page 1: CRM Dashboard (`/crm`)

1. Header and sidebar (Dashboard active).
2. The **Add a HubSpot Deal** card (white, `#D6D4FF` border, 18px radius, faint lavender circles in
   the corners), split by a thin vertical divider:

   ```
   [link tile]                          | HubSpot Deal ID
   Add a HubSpot Deal                   | [🔗 Enter Deal ID or deal link        ] [➤ Submit]
   Enter a HubSpot Deal ID or paste ... | FLOW  [ Automatic | Step by step ]  Every step runs by itself.
   ```

   Left (~40%): 44px lavender tile with a purple link icon, a 22px bold title and a 14px muted subtitle.
   Right (~60%): a full-width 44px input with a link icon, then one
   row of four 40px fields: **Expected Pool*** (number), **CRM Owner*** (HubSpot owner dropdown),
   **Profiling POC** and **ISE** (owner dropdowns, optional). The three dropdowns preselect the signed-in
   user's HubSpot owner. Then the
   FLOW toggle (selected option in the purple gradient) with the 124px gradient **Submit** (send icon)
   at the right end of that row. The flow choice defaults to Automatic. Step-by-step deals show "Step by step" under
   the Deal ID, a yellow "Waiting for Approval" status and a **Review** button that opens the approval
   panel (Approve and continue / Stop deal). Submit is the primary indigo button. On submit call
   `POST /api/crm/deals/process`; show inline validation errors under the input; clear the input on
   success; show a small toast "Deal already submitted" when `duplicate: true`. The new row must
   appear immediately (invalidate/refetch the list).
3. Directly below: one toolbar row, the search "Search company, Deal ID or role..." filling the
   free width, then 190px "All Status" and "All Companies" dropdowns and a square refresh button.
4. Table columns:

   `#` · Deal ID · Company · Job Role · Expected Pool · Applied · Progress · Current Step · Status ·
   Public Link · Last Updated · Action

   - Progress: small horizontal bar + percentage.
   - Status: chip from `displayStatus`.
   - Public Link: `-` until generated, then "View Link ↗" (opens new tab).
   - Last Updated: `Apr 24, 2026 10:14 AM`.
   - Action: `•••` menu with only permitted items: **View Details** (always; opens a right-side
     drawer or modal with `GET /api/crm/deals/:jobId`), **Retry Failed Step** (only when
     `canRetry`), **Copy Public Link** (only when `publicLinkUrl`), **View Logs** (always; drawer
     with `GET /api/crm/deals/:jobId/logs`), **Stop** (only when `canStop`) and **Delete** (only when
     `canDelete`, shown in red). Stop and Delete each ask for confirmation first.
   - Null company/role before the deal is fetched: show `—`.
5. Server-side pagination below the table.
6. Polling: refetch every ~12s while any visible row has `isActive: true`; stop when none are active.
7. Empty state: "No Deal IDs have been submitted yet." with "Enter a HubSpot Deal ID above to get
   started."

## Page 2: PSM dashboard (`/psm`)

1. Header.
2. One filter row: search "Search by company, role or Deal ID...", "All Companies",
   "All PSM Status", "All Priority", "All AI Status" dropdowns, and a **Clear Filters** button.
3. Table columns:

   `#` · Deal ID · Company · Job Role · Expected Count · Applied Count · Application Window ·
   AI Analysis Status · Priority Status · PSM Review Status · CRM Share Status · Updated At · Action

   Chips come from the API. Action button by `action`: `OPEN_REVIEW` → primary "Open Review",
   `CONTINUE_REVIEW` → "Continue Review", `VIEW_POOL` → secondary "View Pool", `NONE` → disabled
   "Processing". All three navigate to `/psm/jobs/:jobId/review`.
4. Refetch on window focus and after mutations (no constant polling). Server-side pagination.
5. Empty state: "No candidate pools are ready for review."

## PSM review (`/psm/jobs/:jobId/review`)

1. Same header. A small "← Back" text link is allowed above the summary.
2. On mount call `POST /api/psm/jobs/:jobId/start-review` (idempotent).
3. Compact summary strip (one row of label/value pairs, no big cards): Company, Job Role, Deal ID,
   Expected Pool, Total Applied, Application Status, AI Analysis Status (chip).
4. Filters row: search (name or student ID), AI priority, final priority, candidate status.
5. Candidate table columns:

   `#` · AI Priority · Student Name · Student ID · Campus · Resume · AI Resume Score ·
   GRIT Skill Score · Assessment Score · Interview Score · Overall Score · AI Reason ·
   Final Priority · PSM Remarks · Candidate Status

   - Resume: "View" link (new tab) when `hasResume`, else `—`.
   - Null scores: `N/A`. Null GRIT: `N/A` with tooltip "GRIT Data Not Available".
   - AI Reason: truncated with the full text in a tooltip or popover (also show matched/missing
     skills there).
   - Final Priority: editable `<select>` with `P1..P{candidateCount}`. Highlight the cell subtly when
     it differs from AI priority.
   - PSM Remarks: text input, saved on blur (debounced), with a tiny saved/saving indicator.
   - Candidate Status: select: Recommended / Consider / Not Recommended.
   - Every change calls `PATCH …/candidates/:studentId`; after a success that returns `swappedWith`,
     refetch the list.
   - When `isSubmitted`, every control is read-only and a small "Submitted by X on date" note and
     the public link (copy button) are shown.
6. Server-side pagination.
7. Bottom-right primary button **Submit Final Candidate Pool** (hidden when submitted). Opens a
   confirm dialog:

   > You are about to finalize this candidate pool. Please verify all priority changes before
   > submitting.

   Buttons: **Cancel**, **Confirm & Submit**. On success show the public link.

## Public candidate pool (`/public/candidate-pool/:token`)

No header, no auth. Shows Company Name, Job Role, Total Applied and the final candidate table:

Final Priority · Student Name · Resume · Relevant Skills · AI Resume Score · GRIT Score ·
Assessment Score · Interview Score · Overall Score · Candidate Status

Sorted by final priority. Friendly states for `404` ("This link is not valid") and `410`
("This link has expired").

## States every page handles

Loading (skeleton rows), Empty, Error (with retry), No results (after filtering), Unauthorized
(Access Denied), Success.

## Reusable components

AppHeader, UserEmailMenu, DealIdSubmitCard, SearchInput, FilterSelect, StatusBadge, ProgressBar,
DataTable (TanStack Table), Pagination, ConfirmDialog, CandidatePrioritySelect, RemarksInput,
LoadingSkeleton, EmptyState, ErrorState.
