# FEMS — User Guide

**F**orest **E**xploitation **M**anagement **S**ystem.

This guide is written for the people who use FEMS every day — forestry officers, field
inspectors and operators, company representatives, environmental officers and
administrators — not for the people who build it. For installation and architecture, see
the [README](../README.md); for the API, see [Postman collection & screenshots](./postman/README.md).

**Contents**

1. [What FEMS does](#1-what-fems-does)
2. [Getting started](#2-getting-started)
3. [Accounts, roles and permissions](#3-accounts-roles-and-permissions)
4. [The mobile app, screen by screen](#4-the-mobile-app-screen-by-screen)
5. [Step-by-step workflows](#5-step-by-step-workflows)
6. [Working in the field: offline, GPS and photos](#6-working-in-the-field-offline-gps-and-photos)
7. [Artificial intelligence in FEMS](#7-artificial-intelligence-in-fems)
8. [Reports and documents](#8-reports-and-documents)
9. [Administration](#9-administration)
10. [Using the API directly](#10-using-the-api-directly)
11. [Troubleshooting](#11-troubleshooting)
12. [Glossary](#12-glossary)

---

## 1. What FEMS does

FEMS is the operational record of a forest estate. It answers three questions:

* **What is there?** — forests, management units (zones), species, protected areas,
  inventory plots, and where all of it sits on a map.
* **What is happening?** — who is allowed to harvest what, where, until when and in what
  volume; what actually got cut, moved and replanted; who inspected it and what they found.
* **What went wrong, and what is owed?** — violation cases, penalties, remediation, and
  whether the fees and royalties were paid.

It is made of three parts:

| Part | What it is | Who touches it |
|---|---|---|
| **API** (`fems-backend`, NestJS + Prisma + MySQL) | The single source of truth. Every rule is enforced here. | Developers, integrators, anyone running Postman |
| **Mobile app** (`fems-mobile`, Expo / React Native) | The tool people carry. Runs on Android, iOS and in a browser. | Everyone |
| **Database** (MySQL) | The records. | Administrators |

Everything the app can do, the API can do — the app is only a client. That matters for two
reasons: you can always fall back to the API (or Postman) for a bulk action, and no
permission is ever enforced only in the app.

---

## 2. Getting started

### 2.1 Running FEMS (for the person who installs it)

```bash
git clone <your fork> FEMS && cd FEMS

npm run setup                       # install backend + mobile dependencies

cd fems-backend
cp .env.example .env                # then edit DATABASE_URL to point at your MySQL
npm run prisma:generate
npm run db:migrate                  # create the schema
npm run db:seed                     # roles, permissions and demonstration data
npm run start:dev                   # API on http://localhost:3000/api/v1
```

The mobile app:

```bash
npm --prefix fems-mobile run start        # Expo — scan the QR code with Expo Go
npm --prefix fems-mobile run web          # or open it in a browser
```

The app finds the API automatically: on the web it uses the page origin, on a phone it uses
the address that served the JavaScript bundle. To point it somewhere else, set
`EXPO_PUBLIC_API_URL` before starting Expo:

```bash
EXPO_PUBLIC_API_URL=https://fems.example.org/api/v1 npm --prefix fems-mobile run start
```

Interactive API documentation (Swagger) is served at **http://localhost:3000/api/v1/docs**.
It is the fastest way to see what a route expects.

### 2.2 Signing in

Open the app and sign in with your work email and password. The first screen after sign-in
is your **Home** dashboard; the tabs along the bottom change with your role (see
[§3](#3-accounts-roles-and-permissions)).

If you have no account yet, **Create account** on the welcome screen registers you.
Self-registration offers two roles only — *Forest explorer* (public data) and *Company
representative* (your company's file). Officer, inspector, operator and administrator
accounts are created by the administration, because they carry permissions over other
people's records.

If your account has never been verified, you will be asked for the code sent to your email
before you can do anything else. Ask an administrator to resend it if it expired.

### 2.3 Demonstration accounts

A seeded database ships with one account per role. **Password for all of them:**
`FemsDemo#2026`

| Email | Role | What it is for |
|---|---|---|
| `demo.admin@fems.cm` | Administrator | Everything, including users, roles and system settings |
| `demo.officer@fems.cm` | Government forest officer | The permit register: review, approve, activate |
| `demo.environment@fems.cm` | Environmental officer | Inspections, observations, violation cases |
| `demo.inspector@fems.cm` | Forest inspector | Field inspections and site verification |
| `demo.operator@fems.cm` | Field operator | Activities, observations, offline capture |
| `demo.company@fems.cm` | Company representative | Its own permits, activities and payments |
| `demo.explorer@fems.cm` | Forest explorer | Public forest data, the map and the Assistant |

There are also four additional company accounts sharing one operator, useful for seeing how
scope works: `demo.cooperative@…`, `demo.efe@…`, `demo.bsc@…`, `demo.cwpi@…`.

> Demonstration records are flagged **DEMO** in the interface and `isDemo: true` in the API.
> Never seed a production database with them.

### 2.4 If you cannot sign in

| Symptom | Cause | What to do |
|---|---|---|
| *Invalid credentials*, and you are sure of the password | Five failed attempts lock the account for 15 minutes (the counter resets on a successful sign-in) | Wait 15 minutes, or ask an administrator to set your status back to *Active* |
| The app says it cannot reach the server | The API is not running, or the app is pointed at the wrong address | Check `http://<host>:3000/api/v1/system/health` in a browser, then review `EXPO_PUBLIC_API_URL` |
| *Email not verified* | The account was created but never activated | Use **Resend the code** on the verification screen |
| `429 Too many requests` | More than 10 sign-ins per minute from the same address | Wait a minute and retry |
| The app opens but every list is empty | Signed in with a role that has no data in scope | Check your role on **Profile → Roles and scope** |

---

## 3. Accounts, roles and permissions

### 3.1 The seven roles

FEMS ships with seven roles. A person can hold more than one; the navigation always follows
the **highest** role they hold.

| Role | Works on | Typical day |
|---|---|---|
| **Administrator** | Everything | Creates accounts, grants roles, configures the system, reads the audit trail |
| **Government forest officer** | The permit register | Reviews applications, requests revisions, approves, suspends, revokes |
| **Environmental officer** | Compliance and environment | Plans inspections, records observations, opens and resolves violation cases, follows remediation |
| **Forest inspector** | Field verification | Runs inspections against a checklist, records GPS and photos, submits findings |
| **Field operator** | Operations on the ground | Declares harvest/transport/planting activities, records observations, works offline |
| **Company representative** | Its own company | Files applications, submits them, pays fees, downloads permits and receipts |
| **Forest explorer** | Public data | Browses forests, the map and the Forest Assistant. Read-only. |

### 3.2 What each role sees

The bottom tabs are deliberately different for each role. Hiding a tab is a usability
decision only — typing the address of a hidden screen still returns **403 Forbidden**,
because the server checks the permission again.

| Role | Tabs |
|---|---|
| Administrator | Home · Permits · Alerts · Map · Profile |
| Government forest officer | Home · Permits · Field · Alerts · Profile |
| Environmental officer | Home · Map · Field · Alerts · Profile |
| Forest inspector | Home · Field · Map · Alerts · Profile |
| Field operator | Home · Field · Map · Sync · Profile |
| Company representative | Home · Permits · Field · Payments · Profile |
| Forest explorer | Home · Forests · Assistant · Map · Profile |

Everything else lives behind **Home → All modules** (the `⋯` button), which is the same for
everyone: registers (activities, observations, inspections, violations, reports, companies,
users), the audit trail and system settings. Entries you are not entitled to are marked
rather than hidden, so you can see what exists.

### 3.3 Permissions

A permission is a short code, e.g. `permits:approve`, `violations:resolve`,
`observations:create`. Two of them shape almost every screen:

* `…:read` — you see **all** records of that kind.
* `…:read_own` — you see only the records linked to **your company** (or created by you).
* `…:read_public` — you see only what is published (forest explorers).

The server decides scope; the app only labels it. **Profile → Roles and scope** shows
exactly which scope you have on each module, and **Profile → Permissions** lists the codes
you hold. If a button you expect is missing, this is where to look first.

---

## 4. The mobile app, screen by screen

### 4.1 Home

Your start page. It contains:

* **Your identity** — your roles, your company, whether the device is online, and how many
  records are still queued on this device.
* **Quick actions** — *New permit* and *Capture activity*, the two things people do most.
* **Operational picture** (or *Forest resources* for public accounts) — live counters:
  forests, permits, active permits, fees invoiced, open alerts, pending payments. Tap any
  tile to open the matching register, already filtered.
* **Administration** — only if you hold `users:read`, `audit:read` or `settings:manage`:
  user accounts, companies, the audit trail, system monitoring, system settings.
* **All modules** (`⋯`, top right) — the full screen index, grouped by theme, with a badge
  showing how many AI alerts are waiting.

### 4.2 Map

Forests, zones, protected areas, inventory plots and your own GPS check-ins, drawn from the
`/gis` endpoints.

* **Layers** — toggle each feature type on and off. The counter row shows how many features
  of each type are loaded, and warns when a forest has no boundary polygon (it cannot be
  drawn until a geometry is imported).
* **Tap a feature** — a sheet with its properties and, where the record exists, an
  **Open record** button that jumps to the full screen.
* **Search near me** — uses your device position and a radius (1–50 km) to find forests,
  zones and check-ins around you.
* **Record check-in** — stores your position as a field check-in, with accuracy and
  whether the fix came from the device GPS.

### 4.3 Permits

The register of every permit you are allowed to see. Filter by status, type, company,
forest or period; sort and paginate.

Open a permit to see its **state machine in practice**:

* Header with the permit number, status pill, type and **DEMO** flag where applicable.
* **Available actions** — the buttons are computed from `GET /permits/{id}/actions`, so you
  only ever see transitions that are legal from the current status *and* allowed by your
  permissions. Some actions ask for a reason (reject, request a revision, suspend, revoke);
  the reason is stored in the audit trail.
* **Pay the permit fee** — for company representatives on a permit awaiting payment.
* Details: type, purpose, company, forest, zone, validity, volume requested and approved,
  fee, royalty rate per m³, and the **outstanding balance**.
* **Download the permit** — the permit certificate as a PDF, rendered from the live record
  (needs `permits:download`).
* **Documents** — attach and verify supporting documents on the permit file.
* **Timeline** — every transition the permit has been through, with who made it and when.

### 4.4 Payments

Fees, royalties and penalties. **New payment** records a payment and picks up the permit's
outstanding balance automatically.

Open a payment for:

* **Provider actions** — *Verify with provider* re-checks the transaction; in the
  **simulator** provider you also get *Sandbox: mark successful* and *Sandbox: mark
  failed* so the flow can be demonstrated end to end without moving money.
* **Receipt** — the printable record: issuer, amount, purpose, method, provider reference,
  payer, company and permit. Sandbox receipts are clearly marked *no funds moved*.
* The **receipt PDF**, and the history of the payment.

### 4.5 Field

The working screen for anyone on the ground. Four tiles summarise the day: open
inspections, running activities, field observations and, for operators, how many records
are queued offline.

* **Capture** — four entry points: *Activity*, *Observation*, *Inspection*, *Equipment*.
* **Tabs** — *Inspections* (assigned to you), *Activities*, *Observations*. Each row shows
  its status pill and, for offline records, a **queued / sync** badge and whether the
  position came from the device GPS.

### 4.6 Alerts

The AI detection queue (see [§7](#7-artificial-intelligence-in-fems)). Each alert carries a
severity, an explanation of *why* it fired, the evidence it was computed from, and the
decision controls: **acknowledge**, **dismiss** (with a reason), or **escalate into a
violation case** in one tap.

### 4.7 Assistant

The Forest Assistant: a chat over your own forest data. Ask *“which permits expire in the
next 30 days?”* or *“summarise compliance for UFA 09-012”* and it answers in French or
English, with the sources it used. Conversations are saved (**History**), and each answer
shows which engine produced it and how long it took.

### 4.8 Sync (field operators)

Everything captured while offline lands in a local queue. This screen is the queue: what is
pending, what failed and why, and the controls to **Synchronise now**, retry, or discard a
record that will never be accepted.

See [§6](#6-working-in-the-field-offline-gps-and-photos).

### 4.9 Profile

* **Account** — name, phone, job title (editable in place).
* **Roles and scope** — your roles and, per module, whether you see *all*, *own* or
  *public* records.
* **Appearance** — light or dark theme.
* **Language** — English by default; French or English can be selected per account. It affects
  bilingual data labels, dates, numbers, generated documents and AI answers. Most screen copy is
  currently displayed in English regardless of this preference.
* **Sessions** — every device currently signed in, with *This device* marked; revoke any of
  them individually.
* **Security** — change your password (current password required; changing it signs out
  every other device).

### 4.10 Public explore

The **Forest explorer** account — or simply *Explore forests* on the welcome screen, without
signing in at all — gets a read-only view: the forest register, the map, forest detail screens and the
Assistant. No permit, payment or compliance data is exposed — every one of those endpoints
requires authentication.

---

## 5. Step-by-step workflows

Each workflow below is a real path through FEMS. Where an action is only offered to certain
roles, the role is named.

### 5.1 Apply for an exploitation permit — *company representative*

1. **Permits → New permit.**
2. Choose the **type** (annual cutting permit, special products, …), the **forest** and, if
   the forest is divided, the **zone**.
3. Fill in **purpose**, the requested **volume in m³**, and the planned **start and end
   dates**.
4. Save. The permit is created in **DRAFT** — nothing has been sent to the administration
   yet, and you can still edit it.
5. When it is ready, open the permit and press **Submit**. It moves to **SUBMITTED** and
   becomes read-only for you.
6. Watch the status. Officers may ask for a revision (**REVISION_REQUIRED**) with a reason:
   edit the permit and press **Resubmit**.
7. When it reaches **APPROVED**, the fee is calculated and the permit moves to
   **PAYMENT_PENDING**. Pay it — see 5.3.
8. Once the payment is confirmed the officer **activates** the permit. It is now **ACTIVE**
   and you may start operations against it.

### 5.2 Review an application — *government forest officer*

1. **Permits**, filter by *SUBMITTED*.
2. Open the application. Check the company's standing, the requested volume against the
   zone's allowable cut, and the dates.
3. Choose an action — the app only shows legal ones:
   * **Start the review** → `UNDER_REVIEW` (takes ownership of the file).
   * **Request a revision** → `REVISION_REQUIRED`, with a reason the applicant sees.
   * **Approve** → `APPROVED`, optionally setting the **approved volume** below what was
     requested, and confirming the fee and royalty rate.
   * **Reject** → `REJECTED`, with a reason.
4. After approval, FEMS raises the fee and moves the permit to **PAYMENT_PENDING**.
5. When the payment settles, press **Activate**. The permit becomes **ACTIVE** and its
   number is issued.

Later, on an active permit you can **Suspend** (with a reason), **Reinstate**, **Revoke**
(with a reason), let it **Expire**, or **Renew** it back to a draft.

### 5.3 Pay the fee and get a receipt — *company representative*

1. **Payments → New payment** (or **Pay the permit fee** on the permit itself). The
   outstanding balance is pre-filled.
2. Choose the **method** (mobile money, bank transfer, cash at the treasury, …) and the
   **amount**.
3. Save. The payment is `PENDING`.
4. Open the payment. *Verify with provider* asks the payment provider for the real status.
   With the **simulator** provider, use *Sandbox: mark successful* instead.
5. Once `PAID`, the **Receipt** section appears with the receipt number. Open the **receipt
   PDF** to print or share it.

> Unpaid and partially paid permits are visible on the dashboard tile *Outstanding*, and the
> permit detail always shows the **outstanding balance** in red while anything is due.

### 5.4 Declare a harvesting activity — *field operator*

1. **Field → Capture → Activity** (or *Capture activity* on Home).
2. Choose the **type** (harvest, transport, planting, …), the **permit** it runs under, the
   **zone**, and the planned **volume** and **dates**. Add the **equipment** used if
   relevant.
3. Save → `PLANNED`. When the crew actually starts, press **Start** → `IN_PROGRESS`.
   Starting requires a valid permit; FEMS refuses otherwise.
4. If work stops, **Suspend**; when it resumes, **Resume** (checked again against the
   permit). When the job is done, **Complete** — record the actual volume, species and
   parcel.
5. Attach **photos** on the activity detail screen; they are stored with the record and
   appear in reports.

### 5.5 Record a field observation — *any field role*

The quickest thing to record on site, and the one people do offline.

1. **Field → Capture → Observation.**
2. Pick a **category** (illegal logging, fire, wildlife, encroachment, erosion, …), give it a
   **title** and a description, and set the **severity**.
3. Take the **position** — the app offers the device GPS and, if the fix is poor, lets you
   drop the point on the map instead. Whatever you choose is recorded: `DEVICE_GPS` or
   `MANUAL`, plus the accuracy in metres. This is what makes an observation usable as
   evidence later.
4. Add **photos** (optional, but strongly recommended).
5. Save. If you are offline the observation is queued and badged **QUEUED** until it syncs.

### 5.6 Run an inspection — *forest inspector*

1. **Field → Capture → Inspection**, or open an inspection assigned to you.
2. Set the **target** (permit, zone or activity), the **type** (routine, compliance,
   incident, verification, post-harvest) and the planned date.
3. On site, open the inspection. Press **Get position** and then **Start inspection** —
   starting is refused without a position, and the fix is stored with its accuracy and the
   distance from the target. The app warns you if the position looks simulated.
4. Work through the **checklist**. The questions depend on the inspection type (routine,
   compliance, environmental, post-harvest, incident, verification). Answer each one and
   note what was found. FEMS computes a **compliance score** from the answers.
5. Press **Submit inspection**: record the **outcome**, a **summary**, your
   **recommendations**, the **verified volume** and **verified trees**, and any
   **discrepancies** between the register and what you found.
6. The inspection becomes `SUBMITTED`; a supervisor **reviews** it and then **closes** it.
   A failed inspection is normally the start of a violation case.

### 5.7 Open and resolve a violation — *environmental officer*

1. **Violations → New**, or — faster — open an AI alert and press **Escalate to violation**,
   which carries the evidence and the alert id into the new case.
2. Record the **type**, **severity**, the **forest / zone / protected area**, the company and
   permit concerned, the location, the **estimated damage** and, if you have it, the
   **evidence** (photos, GPS, observations).
3. Work the case with the actions in **Case workflow** — again, only legal ones are offered:
   * **Open an investigation** (`OPEN → UNDER_INVESTIGATION`) — assign it for field
     verification.
   * **Confirm the violation** (→ `CONFIRMED`) — record the regulatory finding, the assessed
     damage in XAF and the **penalty**. A reason is required and stored.
   * **Dismiss** (→ `DISMISSED`) — the case was unfounded; say why.
   * **Escalate** (→ `ESCALATED`) — hand it to the hierarchy, prosecution or ministry.
   * **Resolve** (→ `RESOLVED`) — once the penalty is settled and remediation agreed. This
     needs the dedicated `violations:resolve` permission.
   * **Reopen** — new evidence appeared on a closed case.
4. When confirming, set **remediation required** (e.g. *replant 120 stems of sapelli in the
   degraded block*) and a **remediation deadline**. FEMS flags the case **remediation
   overdue** when the date passes.
5. The company pays the penalty from the case screen (**Settle the penalty**). The case shows
   **penalty settled** and can then be resolved.

### 5.8 Handle an AI alert — *officer or administrator*

1. **Alerts**. New alerts are `NEW`; the badge on **Home → All modules** counts them.
2. Open one. Read the **explanation** — the rule that fired, the data it compared and the
   numbers. An alert you cannot justify is an alert nobody will act on.
3. Decide: **Acknowledge** (someone is on it), **Dismiss** with a reason (false positive —
   this also teaches the engine what to ignore next time), or **Escalate to violation**.
4. Alerts you escalated carry an *raised from an AI alert* badge on the violation case, so
   the trail is complete in both directions.

### 5.9 Generate a report

1. **Reports**. The catalogue lists built-in reports (permit register, harvest volumes,
   revenue, violations, inspection coverage, …) with their parameters.
2. Choose one, set the **period** and any **filters** (forest, company, status), and press
   **Dataset** to preview a few rows before committing.
3. Press **Generate** and pick the **format**:
   * **JSON** — hand it to another system or a spreadsheet.
   * **CSV** — open it in Excel.
   * **PDF** — a formatted document, branded with the ministry/organisation from system
     settings, ready to print or attach to a letter.
4. Generated files are listed on the report screen with their parameters, who asked for
   them and when. Download from there, or **Send** the report to an audience
   (*officers* or *companies*) with a short message — the recipients get a notification with
   the file attached. Default format is PDF.

---

## 6. Working in the field: offline, GPS and photos

### 6.1 Offline capture

Field operators frequently have no signal in the forest. FEMS is built for that:

1. Record your **activities** and **observations** as normal. The app saves them on the
   device and shows a **Queued** badge instead of pretending they reached the server.
2. Home and Field both show how many records are waiting. A full-screen notice appears when
   the queue is not empty: **Synchronise** sends everything at once.
3. Open **Sync** to see the queue in detail: the client reference, the type, the planned
   volume or category, and the position that was recorded.
4. If the server rejects a record (for example, the permit was suspended while you were
   offline), the record turns red with the server's message, an **attempts** counter, and a
   **Retry** button. Fix the cause, then retry — or **Discard** the record if it was a
   mistake.
5. **Clear queue** empties the device. It warns you first, because it is the one action that
   loses data for good.

Rules of thumb:

* Photos and GPS are captured at the moment you press save, so a queued record is complete.
* Sync while you still have some signal — at the edge of the concession is better than at
  the office two days later.
* A queued record is **not** visible to your colleagues until it syncs. Say so if someone
  calls asking why the register is behind.

### 6.2 GPS and evidence quality

Everywhere a position matters (observations, inspection start, check-ins, activity sites),
FEMS records three things alongside the coordinates:

* **Accuracy** in metres,
* **Source** — `DEVICE_GPS`, `MANUAL` (you placed the point) or a network fix,
* **Distance from the target**, where there is one.

It also flags a **simulated / mocked** fix, which is how fake GPS apps show up. A record with
a mocked position is marked as such, because it will not survive scrutiny as evidence.

Practical advice: wait for the accuracy to settle below ~10 m before saving; if the canopy
makes that impossible, say so in the description and place the point manually — an honest
manual point beats a wildly wrong automatic one.

---

## 7. Artificial intelligence in FEMS

Two features, one principle: **the AI proposes, a human decides.**

### 7.1 Alerts

A rules engine watches the data you already produce — harvest volumes against permit
ceilings, activity outside the authorised zone, missing inspection coverage, repeated
observations in the same place, unusual transport volumes — and raises **alerts**.

Every alert carries:

* a **severity** (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`),
* the **rule** that fired, in plain language,
* the **evidence**: the records and numbers it compared,
* a **state**: `NEW` → `ACKNOWLEDGED` / `DISMISSED` / escalated.

Alerts never change a permit, a payment or a case. Only the three human decisions in 5.8 do.

### 7.2 The Forest Assistant

A chat over your own forest data, inside **Assistant**. It answers questions like *“which
permits expire this quarter?”*, *“what did the last inspection of UFA 09-012 find?”* or
*“summarise violations in the Littoral region this year”*, and cites the records it used.

* It only ever reads what **you** are allowed to read — the same scoping rules apply.
* It answers in the language you selected in **Profile → Language**.
* Each reply shows which engine produced it and how long it took. When no external model is
  configured, a local rule engine answers instead and the badge says so.
* It is an assistant, not an authority: check anything that is going into a decision.

### 7.3 Analysis

**Analysis** screens let you ask the engine for a deeper read of a forest, zone or permit —
deforestation signals, pressure indicators, compliance posture — and keep the result with
its inputs so it can be reviewed later.

---

## 8. Reports and documents

| Document | Where | Notes |
|---|---|---|
| **Permit certificate** (PDF) | Permit detail → *Download the permit* | Rendered from the live record, so a re-download after a suspension shows the current status |
| **Payment receipt** (PDF) | Payment detail → Receipt | Available once the payment is `PAID`. Sandbox receipts are marked *no funds moved* |
| **Report** (JSON / CSV / PDF) | Reports | Generated on demand, listed with its parameters and author. See [5.9](#59-generate-a-report) |

Documents are generated server-side from the live data at the moment you ask for them, so a
certificate re-downloaded after a suspension shows the current status. Generated files are
kept in the backend's `reports-output` directory and listed on the report screen.

---

## 9. Administration

_Administrator only. All of these are under **Home → Administration** or **All modules**._

### 9.1 User accounts

* **Users** — search, open, edit, deactivate. Deactivating keeps the history: the account
  stops working but its audit trail and records stay.
* **Create account** — sets the email, name, role and optional company. The new user gets a
  verification email; they can be forced to change their password at first sign-in.
* **Unlock and reset** — an account locked by five failed attempts unlocks itself after 15
  minutes; to do it now, set its status back to **Active** (that also clears the lock).
  **Reset password** sets a temporary password and forces a change at the next sign-in.
  **Restore** brings back an account that was deleted by mistake.

### 9.2 Roles and permissions

**Roles** lists the seven built-in roles with their level and member count. Use
**Permissions** to see the complete vocabulary the guards use, and to grant or revoke
individual permissions on a role.

Be conservative. Permissions are additive and immediate: granting `permits:approve` to a
role means every member can approve a permit from the next request onwards.

### 9.3 System settings

* **Notification delivery** — per notification type, whether it goes to the app (**Push**),
  by **Email**, or both. In-app delivery is always on and cannot be switched off.
* **Email delivery** — shows the SMTP configuration actually in use (host, port, encryption,
  account, whether the password is set, the *from* address) and lets you **send a test
  email** to any address before relying on it.
* **Other integrations** — payments (provider, currency, webhook) and the AI services, with a
  **Re-check integrations** button that tests each one and reports the result.
* **Artificial intelligence** — which detector is active, how many rules the engine holds,
  and whether an external model is configured.

### 9.4 System monitoring

**Settings → System monitoring** is the health console. It opens with one verdict —
**OK**, **DEGRADED** or **FAILING** — and then the measurements behind it:

* **Process** — uptime, start time, Node version, heap and resident memory.
* **Requests per minute** over the last quarter of an hour, plus the **busiest routes** and
  the **slowest recent requests**.
* **Scheduled jobs** — the outcome of each one's last run (a failed job shows here before
  anyone notices missing data).
* **Storage** — driver, directory, number of files and total size.
* **Last 24 hours** — audited actions, successful vs refused sign-ins, notifications created,
  active sessions.
* **Components** — one line each for the database, mail, payments, AI and the offline sync,
  green / amber / red, with the reason when it is not green.

Read it at the start of the day. An amber component usually means an integration expired or
a scheduled job failed — not that FEMS is broken. The lighter `GET /system/health` is the
same verdict without the detail, and the public `/health` probe tells a load balancer only
that the process is up.

### 9.5 The audit trail

**All modules → Audit** records who did what, to which record, when, from where, with which
result. It is append-only and cannot be edited from any screen. When a decision is contested,
this is the record that settles it.

---

## 10. Using the API directly

Everything above is also a documented HTTP API. This is useful for bulk actions, integrations
and troubleshooting.

```bash
BASE=http://localhost:3000/api/v1

# sign in
TOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" \
  -d '{"email":"demo.admin@fems.cm","password":"FemsDemo#2026"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['tokens']['accessToken'])")

# use it
curl -s $BASE/permits -H "Authorization: Bearer $TOKEN"
```

Things worth knowing:

* **Base URL** — `http://<host>:3000/api/v1`. Interactive docs at `/docs`, machine-readable
  schema at `/docs-json`.
* **Tokens** — an access token (15 min) and a refresh token (30 days) come back from
  `/auth/login`. Send `Authorization: Bearer <access token>`; refresh with
  `POST /auth/refresh`.
* **Envelope** — successes are `{ "success": true, "data": …, "meta": {page, limit, total,
  totalPages, hasNextPage, hasPreviousPage}, "timestamp": … }`.
* **Errors** — `{ "success": false, "error": { "code": …, "message": …, "details": … } }`.
  The `code` is the thing to branch on; `details` lists validation failures field by field.
* **Pagination** — `?page=1&limit=20` (max 100), plus `sortBy` / `sortOrder`.
* **Rate limits** — 120 requests/minute, 10/minute on authentication routes. The response
  carries `X-RateLimit-Limit`, `-Remaining` and `-Reset`.
* **Scope** — a record outside your scope returns **404**, not 403, deliberately: existence
  is not information a stranger is entitled to.

A ready-to-import **Postman collection** with 194 requests across 17 folders, and 104
screenshots of those requests actually executed, is in
[`docs/postman/`](./postman/README.md). Import the collection and the environment, run the
administrator login, and everything else is pre-filled.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| *Invalid credentials* on a known-good password | Account locked after 5 failures | Wait 15 min, or have an administrator set the status back to *Active* |
| Buttons missing on a permit | Not your permission, or not a legal transition from this status | Check the permit's status and your role scope |
| `403` with a permission code in the message | The role lacks that permission | Administrator: grant it, or use an account that has it |
| `404` on a record you know exists | It exists but is **outside your scope** | Sign in with a role that covers it |
| `400 PERMIT_INVALID_TRANSITION` | The action is not allowed from the current status | Open the permit and read **Available actions** |
| `400` with a `details` array | Validation: a field is missing, malformed or out of range | Read `details`; it names every offending field |
| `409 …_CODE_EXISTS` | The code (forest, permit, company) is already used | Choose another code, or update the existing record |
| `429` | Rate limit | Wait for `X-RateLimit-Reset`, then retry |
| Queued records never sync | The server is rejecting them | Open **Sync**, read the red message on the record |
| Inspections refuse to start | No GPS fix | Press **Get position** and wait for accuracy to settle |
| Position marked *simulated* | A mock-location app is active | Turn it off; the record will not be usable evidence |
| No verification / notification email | SMTP not configured or rejected by the provider | **Settings → Email delivery → Send test email** |
| Receipt says *sandbox receipt — no funds moved* | `PAYMENT_PROVIDER=simulator` | Expected in demonstration environments |
| The app cannot reach the API on a phone | It is using `localhost`, or the LAN address changed | Set `EXPO_PUBLIC_API_URL` to the machine's LAN address |
| The AI answers oddly or slowly | No external model configured, or the provider is rate-limited | Check **Settings → Artificial intelligence**; the badge on each answer names the engine |

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **UFA / Forest management unit** | A forest concession identified by a code (e.g. `UFA 09-012`) |
| **Zone** | A management subdivision of a forest: a series, block or parcel |
| **AAC (allowable annual cut)** | The volume that may legally be harvested from a zone in a year |
| **Permit** | The authorisation to exploit. See the [lifecycle](#permit-lifecycle) below |
| **Activity** | A declared operation: harvest, transport, planting, … |
| **Observation** | A field note about something seen on site (illegal logging, fire, …) |
| **Inspection** | A planned visit, scored against a checklist |
| **Violation** | A compliance case, from report through penalty to remediation |
| **Royalty** | The charge per m³ harvested, separate from the permit fee |
| **Remediation** | Corrective work demanded from an offender (replanting, restoration, …) |
| **XAF** | Central African CFA franc — the currency FEMS records amounts in |
| **`isDemo`** | Flag on seeded demonstration records, shown as a **DEMO** badge |
| **Scope** | Which slice of the data you may see: *all*, *own* (your company) or *public* |

### Permit lifecycle

| Action | From → To | Who | Reason required |
|---|---|---|---|
| `SUBMIT` | DRAFT → SUBMITTED | applicant | – |
| `START_REVIEW` | SUBMITTED → UNDER_REVIEW | officer | – |
| `REQUEST_REVISION` | UNDER_REVIEW → REVISION_REQUIRED | officer | ✔ |
| `RESUBMIT` | REVISION_REQUIRED → SUBMITTED | applicant | – |
| `APPROVE` | UNDER_REVIEW → APPROVED | officer | – |
| `REJECT` | UNDER_REVIEW → REJECTED | officer | ✔ |
| `MARK_PAYMENT_PENDING` | APPROVED → PAYMENT_PENDING | officer / company | – |
| `ACTIVATE` | PAYMENT_PENDING → ACTIVE | officer | – |
| `SUSPEND` | ACTIVE → SUSPENDED | officer | ✔ |
| `REINSTATE` | SUSPENDED → ACTIVE | officer | – |
| `EXPIRE` | ACTIVE / SUSPENDED → EXPIRED | system or officer | – |
| `REVOKE` | ACTIVE / SUSPENDED / PAYMENT_PENDING → REVOKED | officer | ✔ |
| `CANCEL` | DRAFT / SUBMITTED / REVISION_REQUIRED → CANCELLED | applicant | – |
| `RENEW` | ACTIVE / EXPIRED → DRAFT | applicant | – |

Get the same list, filtered to what *you* may do to *this* permit, from
`GET /permits/{id}/actions`.

### Violation lifecycle

`OPEN` → *(INVESTIGATE)* → `UNDER_INVESTIGATION` → *(CONFIRM)* → `CONFIRMED`
→ *(RESOLVE)* → `RESOLVED`, with `DISMISS` and `ESCALATE` available from the earlier states
and `REOPEN` from any closed state. Every transition except `INVESTIGATE` requires a reason,
which is stored in the audit trail.

### Inspection lifecycle

`SCHEDULED` → *(START, needs a GPS fix)* → `IN_PROGRESS` → *(SUBMIT)* → `SUBMITTED`
→ *(REVIEW)* → `REVIEWED` → *(CLOSE)* → `CLOSED`, with `CANCEL` available before submission.

### Activity lifecycle

`PLANNED` → *(START, requires a valid permit)* → `IN_PROGRESS` → *(COMPLETE)* → `COMPLETED`,
with `SUSPEND` / `RESUME` / `CANCEL` available along the way.
