# FEMS

FEMS is a full-stack forestry management platform with:

- NestJS backend in [fems-backend/](./fems-backend)
- Expo + React Native mobile app in [fems-mobile/](./fems-mobile)
- MySQL database supplied by XAMPP

This repository is not just a UI mockup: the backend, Prisma schema, permissions, payments, GIS, inspections, AI, and mobile app are all wired together.

## Documentation

| Document | Who it is for |
|---|---|
| [User Guide](./docs/USER-GUIDE.md) | Everyone who uses FEMS: roles, every screen, and nine step-by-step workflows |
| [User Guide (PDF)](./docs/FEMS-User-Guide.pdf) | The same guide typeset for printing or sharing. Rebuild it after editing the Markdown with `python3 docs/tools/render-user-guide-pdf.py` |
| [Postman collection & API screenshots](./docs/postman/README.md) | Anyone integrating with or testing the API — 194 requests, 104 screenshots of real responses |

## Prerequisites

Before you start, install:

- Node.js 20 LTS or newer
- npm
- XAMPP with Apache and MySQL
- Git
- Optional: Android Studio or Xcode if you want to run the mobile app on a simulator/device

## 1) Database setup with XAMPP

This project can use the MySQL server included with XAMPP. Docker is not required.

1. Open the XAMPP Control Panel.
2. Start **MySQL**. Apache is only required if you want to use phpMyAdmin.
3. Open `http://localhost/phpmyadmin`.
4. Create a database named `fems` using the `utf8mb4` character set and `utf8mb4_unicode_ci` collation.

You can also create it from the phpMyAdmin SQL tab:

```sql
CREATE DATABASE fems
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Then create the backend environment file:

```bash
copy fems-backend\.env.example fems-backend\.env
```

Edit [fems-backend/.env](./fems-backend/.env) and set at least:

```env
DATABASE_URL="mysql://fems:fems@127.0.0.1:3306/fems"
JWT_SECRET="replace-with-a-long-random-secret"
JWT_REFRESH_SECRET="replace-with-a-different-long-random-secret"
PAYMENT_PROVIDER="simulator"
```

### Enable the conversational Forest Assistant

FEMS sends model-backed assistant answers and analysis summaries to **Groq only**.
Set these values in `fems-backend/.env` and restart the API:

```env
AI_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=openai/gpt-oss-120b
```

The API key stays on the backend and is never sent to the mobile app. If no Groq
key is configured, FEMS continues to answer from its deterministic rule engine
and reports that fallback honestly. Each reply uses only records the caller is
authorized to read; follow-up turns are included only while the conversation's
data scope and permissions remain unchanged. Never commit `.env` or share the key.

The default XAMPP database config is:

- database: `fems`
- user: `root`
- password: empty
- port: `3306`

If you configured a MySQL root password in XAMPP, update `DATABASE_URL` with that password.

If your migration error says `Access denied for user 'fems'`, your `.env` still
contains the old Docker credentials. Open the file and replace its
`DATABASE_URL` line:

```powershell
notepad fems-backend\.env
```

Use this for the default XAMPP installation:

```env
DATABASE_URL="mysql://root:@127.0.0.1:3306/fems"
```

If PowerShell has an old `DATABASE_URL` value in the current terminal, it takes
priority over `.env`. Clear it before running the migration:


```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
```

Run Prisma migrations after MySQL is running and the database exists:

```bash
npm --prefix fems-backend run db:migrate
```

Optionally seed demo data:

```bash
npm --prefix fems-backend run db:seed
```

The first time you use a fresh database, start the API once before seeding.
The API synchronises the RBAC catalogue and creates the system roles required
by the demo seed:

```bash
npm --prefix fems-backend run start:dev
```

Wait until the API reports that the RBAC catalogue was synchronised, stop it
with `Ctrl+C`, and then run:

```bash
npm --prefix fems-backend run db:seed
```

To stop the database, stop **MySQL** in the XAMPP Control Panel.

## 2) Backend setup

### Backend environment file

The backend reads configuration from `fems-backend/.env`. Create it from the
example file:

```powershell
Copy-Item fems-backend\.env.example fems-backend\.env
```

For XAMPP's default MySQL configuration, make sure this line is present:

```env
DATABASE_URL="mysql://root:@127.0.0.1:3306/fems"
```

If you set a password for the XAMPP MySQL `root` user, include it after
`root:`. If MySQL is running on another port, update `3306` as well.

The remaining local values can stay as shown in
[fems-backend/.env.example](./fems-backend/.env.example). At minimum, use
development-only values for `JWT_SECRET`, `JWT_REFRESH_SECRET`, and set
`PAYMENT_PROVIDER=simulator`. Do not commit `.env` files or real credentials.

Install dependencies:

```bash
cd C:\Users\greys\Documents\GitHub\FEMS
npm --prefix fems-backend install
```

Generate Prisma client:

```bash
npm --prefix fems-backend run prisma:generate
```

Start the backend:

```bash
npm --prefix fems-backend run start:dev
```

The backend runs at:

```text
http://localhost:3000
http://localhost:3000/api/v1
```

Useful backend commands:

```bash
npm --prefix fems-backend run build
npm --prefix fems-backend run test
npm --prefix fems-backend run test:e2e
npm --prefix fems-backend run db:seed
```

## 3) Frontend setup

Install the mobile app dependencies:

```bash
cd C:\Users\greys\Documents\GitHub\FEMS
npm --prefix fems-mobile install
```

Set the API URL if needed:

```powershell
$env:EXPO_PUBLIC_API_URL = "http://127.0.0.1:3000/api/v1"
```

Start Expo:

```bash
npm --prefix fems-mobile run start
```

For browser preview:

```bash
npm --prefix fems-mobile run web
```

The mobile app defaults to the backend at `http://127.0.0.1:3000/api/v1` in local development, as configured in [fems-mobile/src/api/config.ts](./fems-mobile/src/api/config.ts).

## Full local setup with XAMPP

From the repo root:

```bash
npm run setup
npm --prefix fems-backend run prisma:generate
npm run db:migrate
npm run backend:dev
npm run mobile:start
```

## Common commands

```bash
npm run setup
npm run db:migrate
npm run db:seed
npm run backend:dev
npm run backend:test
npm run mobile:start
npm run mobile:web
npm run mobile:typecheck
```

## Project structure

```text
FEMS/
├── README.md
├── fems-backend/      # NestJS API, Prisma schema, migrations, business logic
├── fems-mobile/       # Expo React Native app
└── package.json       # root convenience scripts
```

## Troubleshooting

### MySQL is not running

Start MySQL in the XAMPP Control Panel. If it does not start, check whether
another MySQL or MariaDB service is already using port `3306`.

If XAMPP uses a different port, update the port in `DATABASE_URL`.

### Prisma client errors

```bash
npm --prefix fems-backend run prisma:generate
```

### Database migration problems

Check the connection string in [fems-backend/.env](./fems-backend/.env) and confirm MySQL is running.

### Mobile app cannot reach the backend

Make sure the backend is running on port 3000 and that `EXPO_PUBLIC_API_URL` points to the same machine or LAN address.

## Notes

- New to FEMS? Start with the [User Guide](./docs/USER-GUIDE.md).
- Do not commit secrets to source control.
- The backend expects environment variables from [fems-backend/.env.example](./fems-backend/.env.example).
- Payment integrations default to a simulator in local development unless you configure Campay credentials.
- Docker is optional; the documented local database setup uses XAMPP MySQL.

## Email delivery (SMTP)

FEMS sends transactional email for account verification codes, password-reset
codes and any notification whose **Email** channel is enabled on the account.
Nothing is faked: when SMTP is not configured the API reports
`NOT_CONFIGURED`/`FAILED` instead of claiming a message was delivered, and
(outside production) returns the verification code in the response so the flow
stays testable.

### 1) Create a Gmail App password

1. Use a dedicated sending account, e.g. `fems.notifications@gmail.com`.
2. Enable 2-Step Verification:
   <https://myaccount.google.com/signinoptions/two-step-verification>
3. Create an **App password** (type *Mail*):
   <https://myaccount.google.com/apppasswords> — Google returns 16 characters.
   A normal account password is rejected with
   `535-5.7.8 Username and Password not accepted`.

### 2) Configure the backend

Add to `fems-backend/.env` (never commit it):

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=fems.notifications@gmail.com
SMTP_PASSWORD=abcdefghijklmnop
SMTP_FROM="FEMS <fems.notifications@gmail.com>"
```

`SMTP_FROM` must be the sending mailbox (or one of its aliases), otherwise Gmail
rewrites or rejects the sender. Port `587` uses STARTTLS; port `465` uses
implicit TLS and is also supported.

### 3) Verify it works

Without starting the API:

```bash
npm run mail:verify                      # configuration + SMTP handshake
npm run mail:verify -- you@example.com   # also sends a real test message
```

The script explains the exact failure (bad credentials, blocked port, TLS) and
exits non-zero when email would not be delivered.

With the API running, it logs the transport state at boot:

```text
[Bootstrap] Email delivery ready: smtp.gmail.com:587 as FEMS <fems.notifications@gmail.com>
```

and administrators can check or test it from the app or over HTTP:

| Route | Permission | Purpose |
|---|---|---|
| `GET /api/v1/system/integrations` | `settings:read` | Email, push, payments, AI, storage and database status in one call |
| `GET /api/v1/system/integrations/mail` | `settings:read` | SMTP configuration (never the password) + live handshake |
| `POST /api/v1/system/integrations/mail/test` | `settings:manage` | Sends a real test email; the SMTP response is returned verbatim and written to the audit trail |

In the mobile app: **Settings → Email delivery** shows the same status and has a
*Send test email* button for administrators.

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `missing: EMAIL_PROVIDER` | `EMAIL_PROVIDER=none`. Set it to `smtp` (or just fill `SMTP_HOST` — that now implies `smtp`). |
| `535 Username and Password not accepted` | A normal Google password was used, or 2-Step Verification is off. Create an App password. |
| `ETIMEDOUT` / `ECONNREFUSED` | Outbound port 587/465 is blocked on the network, or the host is wrong. |
| Mail works locally, not after deploy | The `.env` of the deployed API has no SMTP values — they are not baked into the build. |
| Message sent but not received | Check the spam folder on the first send, and that `SMTP_FROM` matches `SMTP_USER`. |

## Printable documents (PDF)

FEMS renders two official documents server-side, from the live record, so a
printed copy can never disagree with the register:

| Route | Permission | Document |
|---|---|---|
| `GET /api/v1/permits/:id/download` | `permits:download` | **Permit certificate** — holder, forest and zone, authorised volume, validity dates, fees assessed/settled/outstanding, conditions, decision history and a verification code |
| `GET /api/v1/payments/:id/receipt/pdf` | `payments:download_receipt` | **Payment receipt** — amount, method, provider reference, payer, the permit it settles, and a verification code |

Both are plain `application/pdf` responses behind the bearer token (a plain link
would be rejected), and both are written to the audit trail as an `EXPORT`.

Honesty rules baked into the renderer:

- a permit that is not in force (draft, submitted, suspended, revoked, expired,
  rejected) is **stamped "not valid"** and carries an explanatory banner rather
  than being refused — the record can still be filed;
- seeded demonstration data is stamped `DEMONSTRATION DATA`;
- a sandbox payment (`PAYMENT_PROVIDER=simulator`) is stamped **"no funds
  moved"**, so a simulated settlement can never pass for proof of payment.

In the mobile app: **Download the permit** on the permit screen, **Download the
receipt** on a settled payment. The file is fetched with the session token and
handed to the platform share sheet.

## System monitoring

Administrators can see what the deployment is actually doing:

| Route | Permission | Purpose |
|---|---|---|
| `GET /api/v1/system/metrics` | `system:monitor` | Request throughput and error rate per minute, busiest and slowest routes, every scheduled job with its last outcome and duration, database latency, storage consumption and free disk, and the 24-hour workload (audited actions, sign-ins, refused sign-ins, notifications, active sessions) |
| `GET /api/v1/system/health` | `system:health` | One OK / DEGRADED / FAILING verdict per component (email, push, payments, AI, storage, database, scheduled jobs, API responses, disk) |

Request counters are collected in-process by an interceptor and reset when the
API restarts — the payload states `process.startedAt` so the window is explicit.
Scheduled jobs (`permit-lifecycle`, `ai-risk-sweep`,
`violation-remediation-sweep`) report success, duration and failure reason.

In the mobile app: **Settings → System monitoring**, also reachable from the
dashboard's Administration block and the module catalogue.

## AI provider (Groq)

FEMS sends model-backed assistant replies and analysis narratives to **Groq only**.
The deterministic rule engine always computes findings and continues to answer
when no Groq key is configured, so a missing key never takes the API offline.
New model-backed calls are recorded as `GROQ`; a deliberate `AI_PROVIDER=none`
uses `LOCAL_RULE_ENGINE`. OpenRouter settings are ignored.

### 1) Create a Groq API key

Create an API key in the Groq console at **https://console.groq.com/keys**.
The key is server-side only: never put it in the Expo app or commit it to Git.

### 2) Configure the backend

Set these values in `fems-backend/.env`:

```env
AI_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=openai/gpt-oss-120b
GROQ_BASE_URL=https://api.groq.com/openai/v1
AI_REQUEST_TIMEOUT_MS=30000
AI_MAX_OUTPUT_TOKENS=2048
```

`openai/gpt-oss-120b` is the current default Groq production model; `openai/gpt-oss-20b`
is a smaller alternative. Groq's active models and quotas can change, so use the
verification command below rather than copying old model IDs or quota tables.
Legacy `.env` files that still name the retired `llama-3.3-70b-versatile`,
`llama-3.1-8b-instant` or `qwen/qwen3.6-27b` IDs are automatically redirected to
their supported replacements.

### 3) Verify the key and model

```bash
cd fems-backend
npm run ai:verify           # validate key, list active models, make one real call
npm run ai:verify -- --list # validate key and list active models only
```

A successful run prints the active models, latency and a short reply. Failures
are actionable: HTTP 401 points at `GROQ_API_KEY`, HTTP 404 points at `GROQ_MODEL`,
and HTTP 429 identifies a Groq rate/quota limit. The rule engine remains available
while you fix provider settings. Restart the API after changing `.env`.

Administrators can check the live configuration in **Settings → Artificial
intelligence**, `GET /api/v1/ai/status`, or `GET /api/v1/system/integrations`.

### Provider selection

| `.env` | Effect |
|---|---|
| `AI_PROVIDER=groq` (default) + `GROQ_API_KEY` | Groq answers using `GROQ_MODEL` |
| `AI_PROVIDER=groq` without a key | Deterministic FEMS rule-engine answers; status reports `GROQ_API_KEY` missing |
| `AI_PROVIDER=none` | No external model call; deterministic FEMS rule-engine answers |
| Legacy `AI_PROVIDER=openrouter` or `OPENROUTER_API_KEY` | Ignored; this build never sends requests to OpenRouter |

Only authorised FEMS records are sent to Groq. Regulatory findings are computed
by FEMS rules; Groq writes narrative text and never makes officer decisions.

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `GROQ_API_KEY is empty` | Add a Groq key to `fems-backend/.env` and restart the API. |
| `HTTP 401 Invalid API Key` | The key was revoked or mistyped. Create a replacement in the Groq console. |
| `HTTP 404 model not found` | Run `npm run ai:verify -- --list` and set `GROQ_MODEL` to an active model ID. |
| `HTTP 429 rate limit` | Check the account's current Groq usage and wait for its quota window to reset. FEMS continues with the rule engine meanwhile. |
| Answers say "rule engine only" | No Groq key is configured or `AI_PROVIDER=none` is selected. |
