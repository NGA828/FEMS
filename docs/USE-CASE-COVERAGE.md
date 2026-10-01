# FEMS — use-case diagram vs. implementation

Checked on 2026-10-01 against the UML use-case diagram (actors: visitor, forest
explorer, company representative, government forest office, environmental
officer, admin; external systems: Campay API, Gemini, GIS map).

Legend: ✅ implemented end-to-end (API + mobile screen) · ⚠️ partial · ❌ missing

The six actors in the diagram map **exactly** onto the RBAC catalogue
(`VISITOR`, `FOREST_EXPLORER`, `COMPANY_REPRESENTATIVE`,
`GOVERNMENT_FOREST_OFFICER`, `ENVIRONMENTAL_OFFICER`, `ADMINISTRATOR` — plus two
extra roles the diagram does not show: `FOREST_INSPECTOR`, `FIELD_OPERATOR`).

## Visitor

| Use case | Status | Where |
|---|---|---|
| Browse | ✅ | `GET /forests`, `/gis/map` (`@Public`) → `(public)/welcome`, `(public)/explore` |
| Register | ✅ | `POST /auth/register` (+ email verification) → `(auth)/register`, `verify-email` |
| View forest resources | ✅ | `GET /forests/:id`, `/protected-areas`, `/tree-species` → `(public)/forest/[id]` |

## Forest explorer

| Use case | Status | Where |
|---|---|---|
| Browse forest resources | ✅ | `GET /forests` → forests tab |
| View forest zones | ✅ | `GET /forests/:id/zones` → forest detail |
| Request exploitation permit | ✅ | `POST /permits` + `submit` action → `permit/new` |
| View permit status | ✅ | `GET /permits/:id`, `/timeline` → `permit/[id]` |
| Manage permit | ✅ | `PATCH /permits/:id`, `POST /permits/:id/actions/:action` |
| Download permit | ✅ | `GET /permits/:id/download` (`permits:download`) renders the certificate as a PDF — holder, forest/zone, authorised volume, validity, fees settled, conditions, decision history, verification code — and `permit/[id]` has a **Download the permit** button. Rendered from the live row, so a suspended/expired/draft permit prints stamped *not valid*. Every download is audited (`EXPORT`). *(implemented 2026-10-01)* |

## Company representative

| Use case | Status | Where |
|---|---|---|
| Manage company profile | ✅ | `GET/PATCH /companies/:id`, documents routes → `company/[id]` |
| Download approved permit | ✅ | Same route; an `APPROVED`/`ACTIVE` permit is the case that prints with a valid stamp. *(implemented 2026-10-01)* |
| Renew permit | ✅ | `POST /permits/:id/renew` → `permit/[id]` |
| Schedule exploitation activities | ✅ | `POST /activities` (planned dates, GPS) → `activity/capture` |
| View payment history | ✅ | `GET /payments`, `/payments/:id/receipt` → payments tab, `payment/[id]` |

> `GET /payments/:id/receipt` returns the receipt data and
> `GET /payments/:id/receipt/pdf` (`payments:download_receipt`) the printable
> document, with a **Download the receipt** button on `payment/[id]`. A sandbox
> settlement is stamped "no funds moved" so it can never pass for proof of
> payment. *(implemented 2026-10-01)*

## Government forest office

| Use case | Status | Where |
|---|---|---|
| View forest resource | ✅ | `GET /forests`, `/forests/statistics` |
| Review exploitation permit | ✅ | `POST /permits/:id/actions/review` + `/actions` |
| Validate exploitation permit | ✅ | `.../actions/approve` (fee computed, history written) |
| Reject exploitation permit | ✅ | `.../actions/reject` (reason required) |
| View company activity | ✅ | `GET /activities?companyId=`, `/companies/:id` → `activity/index` |

## Environmental officer

| Use case | Status | Where |
|---|---|---|
| View protected areas | ✅ | `GET /protected-areas` |
| Generate environmental report | ✅ | `POST /reports` type `ENVIRONMENTAL_VIOLATIONS` (JSON/CSV/PDF) → `report/new` |
| Monitor forest zone | ✅ | `GET /gis/map`, `/gis/nearby`, zone layers → map tab |
| Conduct environmental inspection | ✅ | `/inspections` lifecycle (start → submit → review → close) → `inspection/*` |
| Receive AI forest alert | ✅ | daily `ai-risk-sweep` cron → `GET /ai/alerts` + notifications → alerts tab |

## Admin

| Use case | Status | Where |
|---|---|---|
| Manage user account | ✅ | `/users` CRUD, roles, status, password reset → `user/index`, `user/[id]`. **Was unreachable until 2026-10-01**: the app's role vocabulary said `ADMIN`/`SUPER_ADMIN` while the API emits `ADMINISTRATOR`, so administrators fell through to the visitor navigation. Fixed, plus an Administration block on the dashboard. The detail screen now also covers the whole backend surface: edit details (`PATCH /users/:id`), grant/revoke roles with optional expiry (`POST`/`DELETE /users/:id/roles`), deactivate (soft-delete + session revoke) and restore, on top of suspend/reactivate and password reset; the list tiles read `GET /users/statistics`. |
| Monitor system performance | ✅ | `GET /system/metrics` (`system:monitor`): request throughput and error rate per minute, busiest and slowest routes, every scheduled job with its last outcome and duration, database latency, storage consumption and free disk, 24-hour workload (audited actions, sign-ins, refused sign-ins, notifications, active sessions). `GET /system/health` (`system:health`) gives one OK / DEGRADED / FAILING verdict per component. Plus the pre-existing `GET /health`, `GET /audit/summary`, `GET /system/integrations`. Mobile: **Settings → System monitoring**. *(implemented 2026-10-01)* |

## External systems

| System | Status | Notes |
|---|---|---|
| Campay API | ✅ | Real HTTP client + webhook; refuses to fake a result when unconfigured (simulator is explicitly labelled). |
| Gemini | ✅ | Real client; falls back to the deterministic rule engine, never to invented text. |
| GIS map | ✅ | `MAPS_TILE_URL` + `/gis/*`; Leaflet on web, `react-native-maps` on device. |
| Authentication (`<<include>>` on every use case) | ✅ | Global `JwtAuthGuard` + role/permission guards; public routes are opt-in. |

---

## Findings to act on

1. ~~**"Download permit" / "download approved permit" are not implemented**~~ —
   **done (2026-10-01).** `GET /permits/:id/download` renders the certificate
   through a new single-document renderer (`src/common/pdf/official-document.ts`)
   and `src/permits/permit-certificate.ts`; the mobile permit screen downloads it
   with the bearer token and hands it to the share sheet.
2. ~~**Payment receipts are data-only**~~ — **done (2026-10-01).**
   `GET /payments/:id/receipt/pdf` makes `payments:download_receipt` meaningful.
3. ~~**"Monitor system performance" is thin**~~ — **done (2026-10-01).**
   `GET /system/metrics` (`system:monitor`) reports request throughput and error
   rates per minute, the busiest and slowest routes, the outcome and duration of
   every scheduled job, database latency, storage consumption with free disk, and
   the 24-hour workload; `GET /system/health` (`system:health`) rolls the
   components into one OK / DEGRADED / FAILING verdict. Both permissions are now
   enforced. Mobile: **Settings → System monitoring** (`settings/monitoring`).
4. **RBAC leak (not in the diagram):** `COMPANY_PERMISSIONS` grants
   `environmental:read` (global), so a company representative can list **every**
   violation of **every** operator. The file even documents the opposite intent
   for inspections (`inspections:read_own`). It should be `environmental:read_own`
   — the permission exists and is currently unused.
5. Other defined-but-unenforced permissions: `exploitation:assign`,
   `inspections:assign` (no reassignment route), `companies:export_document`,
   `ai:settings_manage`, `forests:manage`.

---

## Is the diagram the whole picture? No — three different lists

The use-case diagram describes **26 use cases**. The system exposes **181 REST
routes across 20 controllers** and **53 mobile screens**. So "what is missing"
splits into three categories, and only the first one is visible on the diagram.

### A. Missing *inside* the diagram (0 — was 3)
`download permit`, `download approved permit` and the thin
`monitor system performance` were the last three; all were implemented on
2026-10-01 (details above). Every use case on the diagram is now covered by a
route **and** a screen.

### B. Missing *outside* the diagram
A use-case diagram cannot express infrastructure, so these do not appear on it
at all (full detail in [IMPLEMENTATION-GAPS.md](./IMPLEMENTATION-GAPS.md)):
push notifications never register a device token, `SystemSetting` has no write
API, the S3 storage driver is config-only, `FieldSession` has no runtime API,
offline sync covers only activities and observations, no SMS channel, UI chrome
is English-only, no web admin portal, no CI, no Dockerfile, thin e2e coverage.

### C. Implemented *beyond* the diagram
The build is considerably larger than the diagram. None of the following appear
as use cases, yet all are working features:

| Area | What exists beyond the diagram |
|---|---|
| Roles | Two actors the diagram omits: **`FOREST_INSPECTOR`** and **`FIELD_OPERATOR`**, each with their own permission set and screens |
| Payments | The diagram only has *view payment history*; the code initiates payments, verifies them server-side, refunds, issues receipt data, handles the Campay webhook and exposes provider status |
| Inspections | Full lifecycle (schedule → start with GPS → checklist → submit → review → close → cancel), evidence attachments, verified volume vs. declared volume |
| Environmental cases | Violation case file with severity, penalty computation, remediation deadlines, resolution/dismissal actions and an overdue sweep (cron) |
| Field work | Offline capture queue with idempotent replay, GPS check-ins with accuracy/mock-location rejection, field observations, equipment registry and usage |
| AI | Not just *receive alert*: a conversational assistant with history, on-demand analyses, an alert review workflow (confirm/dismiss/escalate) and a daily risk sweep |
| Permits | State machine with 14 actions, timeline, renewal, documents + verification, expiry warnings (cron), fee/royalty computation |
| Companies | Registration verification, suspension, document upload and verification |
| Reference data | Tree species, tree inventory, protected areas, forest zones (full CRUD on the API) |
| Accounts | Email verification, password reset, session list/revocation, device tokens, notification preferences per event type |
| Reporting | 8 report types in JSON/CSV/PDF with preview, catalogue, statistics and distribution to officers/companies |
| Oversight | Full audit trail with summary analytics, notification centre, media library, integration status (`/system/integrations`) |

**Conclusion:** the diagram is a *subset* of the system, not a specification of
it. Closing the three items in §A completes the diagram; the items in §B are
what actually stands between this build and a production deployment.
