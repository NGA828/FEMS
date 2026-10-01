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
| **Download permit** | ❌ | **No endpoint.** `permits:download` is granted to 3 roles but no route consumes it, and the permit screen has no download action. Only user-uploaded attachments can be fetched (`GET /files/download`). There is no generated permit certificate/PDF. |

## Company representative

| Use case | Status | Where |
|---|---|---|
| Manage company profile | ✅ | `GET/PATCH /companies/:id`, documents routes → `company/[id]` |
| **Download approved permit** | ❌ | Same gap as above — nothing renders an approved permit as a document. |
| Renew permit | ✅ | `POST /permits/:id/renew` → `permit/[id]` |
| Schedule exploitation activities | ✅ | `POST /activities` (planned dates, GPS) → `activity/capture` |
| View payment history | ✅ | `GET /payments`, `/payments/:id/receipt` → payments tab, `payment/[id]` |

> ⚠️ `GET /payments/:id/receipt` returns receipt **data**, not a PDF — the receipt
> cannot be saved or printed as a document.

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
| Manage user account | ✅ | `/users` CRUD, roles, status, password reset → `user/index`, `user/[id]` |
| **Monitor system performance** | ⚠️ | `GET /health` (DB up/latency/uptime), `GET /audit/summary`, `GET /system/integrations` (new). **Missing:** request throughput, error rates, slow-query/latency history, cron-job outcomes, storage usage. The permissions `system:monitor` and `system:health` are defined but enforced by no route. |

## External systems

| System | Status | Notes |
|---|---|---|
| Campay API | ✅ | Real HTTP client + webhook; refuses to fake a result when unconfigured (simulator is explicitly labelled). |
| Gemini | ✅ | Real client; falls back to the deterministic rule engine, never to invented text. |
| GIS map | ✅ | `MAPS_TILE_URL` + `/gis/*`; Leaflet on web, `react-native-maps` on device. |
| Authentication (`<<include>>` on every use case) | ✅ | Global `JwtAuthGuard` + role/permission guards; public routes are opt-in. |

---

## Findings to act on

1. **"Download permit" / "download approved permit" are not implemented** (2 use
   cases, 3 roles). Needs a `GET /permits/:id/download` that renders the permit
   as a PDF (number, holder, forest/zone, volume, validity, conditions,
   decision history) behind the existing `permits:download` permission, plus a
   download button on the permit screen. The reporting module already has a PDF
   renderer (`src/reports/report-pdf.ts`) to reuse.
2. **Payment receipts are data-only** — same treatment would make
   `payments:download_receipt` meaningful.
3. **"Monitor system performance" is thin** — health + audit + integrations, no
   real metrics; `system:monitor` / `system:health` are dead permissions.
4. **RBAC leak (not in the diagram):** `COMPANY_PERMISSIONS` grants
   `environmental:read` (global), so a company representative can list **every**
   violation of **every** operator. The file even documents the opposite intent
   for inspections (`inspections:read_own`). It should be `environmental:read_own`
   — the permission exists and is currently unused.
5. Other defined-but-unenforced permissions: `exploitation:assign`,
   `inspections:assign` (no reassignment route), `companies:export_document`,
   `ai:settings_manage`, `forests:manage`.
