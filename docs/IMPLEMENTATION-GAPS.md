# FEMS — what is NOT implemented

Audit date: 2026-10-01 · Branch: `arena/01a0f550-fems` · **Re-verified (2nd pass)**

Every item below was checked twice against the source; §1.2, §1.3 and §8 were
corrected after the second pass (see the notes in those sections).

**Update — email delivery (§1.3, partly closed).** `GET /system/integrations`,
`GET /system/integrations/mail` and `POST /system/integrations/mail/test` now
exist, `MailService.verifyConnection()` is called at boot and by those routes,
the mobile Settings screen shows the real transport state, and
`npm run mail:verify` checks SMTP from the command line. What remains open in
§1.3 is the *writable* side: `SystemSetting` still has no create/update API.

The platform is largely complete: 24 backend modules, ~130 REST endpoints, 39 Prisma
models, RBAC, cron jobs, real SMTP/Campay/LLM/Expo-push clients, PDF/CSV/JSON
reports, offline queue, GIS. The list below is what is **missing, dead, or only
half-wired**, ordered by impact.

---

## 1. Blocking gaps (feature advertised but unusable end-to-end)

### 1.1 Push notifications never reach a device
- Backend is complete: `NotificationsService.sendPushToUsers()` posts to the Expo
  push service, `POST /auth/devices` / `DELETE /auth/devices` store `DeviceToken`
  rows, per-type `pushEnabled` preferences exist.
- **The mobile app never registers a token.** `expo-notifications` is not in
  `fems-mobile/package.json`, and `authApi` has no `registerDevice()` call —
  `POST /auth/devices` is called from nowhere.
- Net effect: `DeviceToken` is always empty, every push reports
  `NO_RECIPIENTS`, and the "push" toggles in Settings control nothing.
- Also `PUSH_PROVIDER` defaults to `none`, so even a registered token would be skipped.

### 1.2 `FieldSession` exists only as seed data — no runtime API
- `model FieldSession` + `enum FieldSessionStatus` are in the schema, and
  `prisma/seed.ts` really does create demo sessions (`seedFieldSessions`,
  line ~4008). `GISLocation.fieldSessionId` can point at one.
- But **no service, controller or DTO ever creates, lists, closes or returns a
  field session** at runtime. The only writer is the seed; the only reader is
  the optional `fieldSessionId` passed to `POST /gis/positions`
  (`gis.service.ts:252`), which is not validated against an existing session.
- The "Field hub" tab reconstructs a session view from inspections/activities
  instead. Opening/closing a session, session-scoped GPS tracks and session
  summaries are not implemented.

### 1.3 `SystemSetting` is read but never written
- Three services read it, each with a hardcoded fallback:
  `organization.name` (`payments.service.ts:736`, `reports.service.ts:1098`) and
  `permit.default_royalty_rate_per_m3` (`permits.service.ts:815`, falls back to 2500).
- **Nothing ever writes a `SystemSetting` row** — no controller, no service, and
  the seed does not create any (`grep systemSetting prisma/seed.ts` → no match).
  `SettingCategory` and `SettingValueType` are referenced nowhere in `src/`.
  In practice the table is always empty and the fallback constants always win.
- `GET /system/integrations` now exists (added with the mail work) and
  `MailService.verifyConnection()` is called at boot and on demand — but there is
  still **no `GET/PATCH /settings`**: penalty grids, SLA hours and expiry windows
  live only in env vars / code and cannot be edited at runtime.

### 1.4 S3 storage driver is configuration-only
- `appConfig().storage.driver` accepts `'s3'` and `S3_BUCKET/REGION/KEY/SECRET/ENDPOINT`
  are read, but `StorageService` only ever writes to the local filesystem.
- Setting `STORAGE_DRIVER=s3` **silently stores files locally** — a production
  deployment would lose files on redeploy. No `@aws-sdk/client-s3` dependency.

---

## 2. Backend endpoints with no mobile UI (reachable only via Swagger/curl)

| Endpoint | Missing screen |
|---|---|
| `POST/PATCH/DELETE /forests`, `POST /forests/:id/zones`, `PATCH/DELETE /zones/:id` | No forest or zone create/edit/delete screen; forests are read-only in the app |
| `POST/PATCH/DELETE /protected-areas` | Read-only list only (`useProtectedAreas`) |
| `GET/POST/PATCH/DELETE /tree-species` | `forestsApi.species()` exists in `endpoints.ts` but is **never called** — no species screen |
| `GET/POST/PATCH/DELETE /inventory`, `GET /forests/inventory/statistics` | `forestsApi.inventory()` / `inventoryStatistics()` defined but unused — no tree-inventory UI |
| `POST /notifications/broadcast` | No admin broadcast/announcement composer (`SYSTEM_ANNOUNCEMENT` is unreachable from the app) |
| `DELETE /users/:id`, `POST /users/:id/restore` | Admin can change status but cannot soft-delete/restore from the app |
| `GET /roles/permissions`, `GET /roles/catalogue/sync-status`, `GET /roles/:name` | No role/permission inspector screen |
| `POST /payments/webhook/campay` | Fine (server-to-server), but there is no UI to view provider webhook/callback history |
| `GET /companies/:id/documents` upload path, `DELETE .../documents/:documentId` | Partially wired; deletion is exposed in the API client but has no entry point for permit documents (`permitsApi` has no `removeDocument`) |

## 3. Offline / sync gaps
- `src/offline/sync.ts` only replays **ACTIVITY** and **OBSERVATION** records.
- Inspection submissions accept a `clientRef` on the server (idempotent replay is
  supported) but are **not queued offline** — an inspector who submits without
  network loses the submission.
- Evidence/photo uploads are not queued either: `filesApi.upload` requires a live
  connection, so offline captures cannot carry their attachments.
- No background sync task (sync runs only while the app is open on the Sync tab /
  on reconnect).

## 4. Notification channels
- `NotificationChannel` enum = `IN_APP | PUSH | EMAIL`. **No SMS channel at all**
  (no provider, no config, no code) — unusual for a Cameroon field deployment
  where mobile-money already uses phone numbers.
- Email delivery for *notifications* is implemented, but only two branded
  templates exist (`sendEmailVerification`, `sendPasswordReset`); all other
  notification emails go out as generic text.

## 5. Internationalisation (partial)
- Enum labels in `src/lib/format.ts` are fully bilingual (EN/FR) and the profile
  screen can switch `preferredLanguage`.
- **All UI chrome is hardcoded English** — screen titles, buttons, helper copy,
  validation messages, empty states. There is no i18n framework (no `i18n-js`,
  no `expo-localization`), so switching to French only translates enum values.
- Backend messages (errors, emails, notification titles) are English-only.

## 6. Platform / delivery gaps
- **No web admin portal.** Everything regulator-side (user admin, report
  generation, audit review) must be done on a phone-sized layout; the Expo web
  build is the only desktop path and is not a designed admin console.
- **No CI pipeline** (`.github/workflows` absent) — tests, lint, typecheck,
  prisma drift and the e2e suite are never run automatically.
- **No Dockerfile / deployment manifest** for the API; `docker-compose.yml`
  provisions MySQL only, and the README declares Docker optional.
- No API client generation from Swagger — `fems-mobile/src/api/endpoints.ts` is
  maintained by hand and can drift from the controllers (it already contains
  functions pointing at endpoints no screen uses).

## 7. Test coverage gaps
- Unit tests exist for pure logic (state machines, payment rules, geo, RBAC
  catalogue, report datasets) — good.
- e2e covers only `auth-rbac` and `permit-payment-activity`. **No e2e for**
  inspections, violations, reports, AI alerts, GIS, media, notifications,
  offline-sync idempotency, or file upload/download.
- No mobile tests at all (no Jest/RNTL setup in `fems-mobile`).

## 8. Smaller loose ends
- `Evidence` model is written by two call sites only; no evidence review/verify
  workflow (verify, reject, chain-of-custody) despite `EvidenceSource` enum.
- `ActivityEquipmentUsage` is created (`POST /activities/:id/equipment`) and is
  returned inside `ACTIVITY_INCLUDE`, but it feeds **no aggregate**: no equipment
  utilisation report, no maintenance scheduling or alerting even though
  `Equipment.nextMaintenanceAt` is stored.
- `AIAnalysis` supports provider calls, but there is no scheduled analysis per
  forest/company — only the daily `ai-risk-sweep` cron for alerts.
- Report formats are limited to `JSON | CSV | PDF`; no XLSX despite
  Excel MIME types being allow-listed in the storage service.
- Reports are generated synchronously in the request (`GENERATING` status and a
  60 s client timeout exist) — no job queue, so a large national report can time out.
- `PermitDocument`/`CompanyDocument` expiry is stored but nothing watches it
  (no cron warning on an expiring company registration document).
- Refresh-token rotation exists, but there is no account-level 2FA/MFA despite
  government-grade claims.
