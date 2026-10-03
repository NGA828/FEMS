#!/usr/bin/env node
/**
 * Capture real FEMS API traffic.
 *
 *   node docs/postman/tools/capture.mjs > docs/postman/tools/captured.json
 *
 * The script signs in with the seeded demonstration accounts, walks the API in
 * the order a real user would (discover a record, then act on it) and records
 * every request with the *real* status code, latency and body it produced.
 *
 * Nothing is hand-written: the JSON it writes is the single source of truth for
 *   - docs/postman/FEMS-API.postman_collection.json   (saved examples)
 *   - docs/postman/screenshots/*.png                  (Postman-style renders)
 *
 * Requires: a running API (`npm --prefix fems-backend run start`) and a seeded
 * database (`npm --prefix fems-backend run db:seed`).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(here, 'captured.json');

const BASE = process.env.FEMS_BASE_URL ?? 'http://127.0.0.1:3000/api/v1';
const PASSWORD = process.env.FEMS_DEMO_PASSWORD ?? 'FemsDemo#2026';

const ACCOUNTS = {
  admin: 'demo.admin@fems.cm',
  officer: 'demo.officer@fems.cm',
  environment: 'demo.environment@fems.cm',
  inspector: 'demo.inspector@fems.cm',
  operator: 'demo.operator@fems.cm',
  company: 'demo.company@fems.cm',
  explorer: 'demo.explorer@fems.cm',
};

/** Variable name the Postman environment stores each account's token under. */
const TOKEN_VARIABLE = {
  admin: 'tokenAdmin',
  officer: 'tokenOfficer',
  environment: 'tokenEnvironment',
  inspector: 'tokenInspector',
  operator: 'tokenOperator',
  company: 'tokenCompany',
  explorer: 'tokenExplorer',
};

const ROLE_LABEL = {
  admin: 'Administrator',
  officer: 'Government forest officer',
  environment: 'Environmental officer',
  inspector: 'Forest inspector',
  operator: 'Field operator',
  company: 'Company representative',
  explorer: 'Forest explorer',
};

/** Variables filled in as the walk progresses, and reused in later requests. */
const vars = {};

const results = [];
let failures = 0;

function pick(obj, dotted) {
  return dotted.split('.').reduce((acc, key) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) return acc[Number(key)];
    return acc[key];
  }, obj);
}

async function call(step) {
  const url = new URL(BASE + step.path.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(vars[key] ?? `{{${key}}}`)));
  for (const [key, value] of Object.entries(step.query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const headers = { Accept: 'application/json' };
  const body = typeof step.body === 'function' ? step.body(vars) : step.body;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (step.role && step.role !== 'none') {
    if (!tokens[step.role]) throw new Error(`no token for role ${step.role}`);
    headers.Authorization = `Bearer ${tokens[step.role]}`;
  }

  const startedAt = Date.now();
  const response = await fetch(url, {
    method: step.method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const elapsedMs = Date.now() - startedAt;

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isBinary = !contentType.includes('json') && !contentType.includes('text');

  const record = {
    id: step.id,
    folder: step.folder,
    name: step.name,
    method: step.method,
    url: url.toString(),
    path: step.path,
    role: step.role ?? 'none',
    requestHeaders: headers,
    requestBody: body,
    status: response.status,
    statusText: response.statusText,
    contentType,
    elapsedMs,
    sizeBytes: Buffer.byteLength(raw),
    responseBody: isBinary
      ? `«binary ${contentType || 'application/octet-stream'} — ${Buffer.byteLength(raw)} bytes»`
      : parsed ?? raw,
    responseText: isBinary ? '' : raw,
    note: step.note,
    hidden: Boolean(step.hidden),
    tokenVariable: step.tokenVariable,
    capturedAt: new Date().toISOString(),
  };

  // A 2xx is expected; 4xx/5xx steps are deliberate (permission demos) — both
  // are recorded, but an unexpected failure is reported loudly.
  const ok = response.status >= 200 && response.status < 300;
  if (!ok && !step.expectError) failures += 1;
  record.ok = ok;

  for (const [name, selector] of Object.entries(step.capture ?? {})) {
    const value = pick(parsed, selector);
    if (value === undefined || value === null) {
      console.error(`  ! capture ${name} (${selector}) missing from ${step.id} — status ${response.status}`);
    } else {
      vars[name] = value;
    }
  }

  results.push(record);
  const flag = ok ? '✓' : step.expectError ? '•' : '✗';
  console.error(`  ${flag} ${String(response.status).padEnd(3)} ${String(elapsedMs).padStart(4)}ms  ${step.method.padEnd(6)} ${url.pathname}`);
  return record;
}

const tokens = {};

async function signIn() {
  for (const [role, email] of Object.entries(ACCOUNTS)) {
    const response = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const payload = await response.json();
    if (!response.ok) {
      console.error(`  ! login failed for ${email}: ${response.status} ${JSON.stringify(payload).slice(0, 200)}`);
      continue;
    }
    tokens[role] = payload.data.tokens.accessToken;

    // Only the administrator login is screenshotted: it is the account the
    // walkthrough uses for the read-only tour. The other six are captured so
    // the Postman collection ships a working, pre-filled login per role.
    const record = await call({
      id: `auth-login-${role}`,
      folder: 'Auth',
      name: `Login — ${ROLE_LABEL[role].toLowerCase()}`,
      method: 'POST',
      path: '/auth/login',
      body: { email, password: PASSWORD },
      hidden: role !== 'admin',
      tokenVariable: TOKEN_VARIABLE[role],
      note:
        'Sign in and receive an access token (15 min) and a refresh token (30 days). '
        + `The Postman test script stores the access token in {{${TOKEN_VARIABLE[role]}}}.`,
    });
    if (record) record.loginRole = role;
  }
}

// ---------------------------------------------------------------------------
// The walk. `capture` pulls ids out of a response so later steps act on real
// records; `body` may be a function of those captured variables.
// ---------------------------------------------------------------------------
const steps = [
  // --- Auth ---------------------------------------------------------------
  {
    id: 'auth-me',
    folder: 'Auth',
    name: 'Current profile',
    method: 'GET',
    path: '/auth/me',
    role: 'admin',
    capture: { adminUserId: 'data.id' },
    note: 'Returns the signed-in profile, role labels and the effective permission list.',
  },
  {
    id: 'auth-sessions',
    folder: 'Auth',
    name: 'Active sessions',
    method: 'GET',
    path: '/auth/sessions',
    role: 'admin',
    note: 'One row per refresh-token family; an administrator can revoke any of them.',
  },
  {
    id: 'auth-notification-preferences',
    folder: 'Auth',
    name: 'Notification preferences',
    method: 'GET',
    path: '/auth/notification-preferences',
    role: 'admin',
    note: 'Per-event delivery matrix (in-app / push / email) for the signed-in account.',
  },
  {
    id: 'auth-permission-denied',
    folder: 'Auth',
    name: 'Permission refused (403)',
    method: 'GET',
    path: '/users',
    role: 'explorer',
    expectError: true,
    note: 'A Forest Explorer has no users:read permission: the API refuses even though the client could hide the screen.',
  },
  {
    id: 'auth-unauthenticated',
    folder: 'Auth',
    name: 'Missing token (401)',
    method: 'GET',
    path: '/permits',
    role: 'none',
    expectError: true,
    note: 'Every protected route answers 401 without a bearer token.',
  },

  // --- Health & system ----------------------------------------------------
  {
    id: 'health',
    folder: 'System',
    name: 'Service health',
    method: 'GET',
    path: '/health',
    role: 'none',
    note: 'Public liveness probe: database state and latency.',
  },
  {
    id: 'system-integrations',
    folder: 'System',
    name: 'Integration status',
    method: 'GET',
    path: '/system/integrations',
    role: 'admin',
    note: 'Email, push, payments, AI, storage and database — configured vs. reachable.',
  },
  {
    id: 'system-health',
    folder: 'System',
    name: 'Component health',
    method: 'GET',
    path: '/system/health',
    role: 'admin',
    note: 'One OK / DEGRADED / FAILING verdict per component of the deployment.',
  },
  {
    id: 'system-metrics',
    folder: 'System',
    name: 'Runtime metrics',
    method: 'GET',
    path: '/system/metrics',
    role: 'admin',
    note: 'Throughput, error rate, slowest routes, scheduled jobs and storage — collected since process start.',
  },

  // --- Roles & permissions ------------------------------------------------
  {
    id: 'roles-catalogue',
    folder: 'Users & roles',
    name: 'Role catalogue (public)',
    method: 'GET',
    path: '/roles/catalogue',
    role: 'none',
    note: 'Public list used by the registration screen; no token required.',
  },
  {
    id: 'roles-permissions',
    folder: 'Users & roles',
    name: 'Permission codes',
    method: 'GET',
    path: '/roles/permissions',
    role: 'admin',
    note: 'Every permission code grouped by module — the vocabulary used by the guards.',
  },
  {
    id: 'roles-list',
    folder: 'Users & roles',
    name: 'Roles with members',
    method: 'GET',
    path: '/roles',
    role: 'admin',
    note: 'Roles with their effective permissions and member counts.',
  },
  {
    id: 'users-list',
    folder: 'Users & roles',
    name: 'List accounts',
    method: 'GET',
    path: '/users',
    role: 'admin',
    query: { page: 1, limit: 5 },
    capture: { userId: 'data.0.id' },
    note: 'Searchable account list, filterable by role, status and company.',
  },
  {
    id: 'users-statistics',
    folder: 'Users & roles',
    name: 'Account statistics',
    method: 'GET',
    path: '/users/statistics',
    role: 'admin',
    note: 'Account counters per status and per role.',
  },
  {
    id: 'users-detail',
    folder: 'Users & roles',
    name: 'Account detail',
    method: 'GET',
    path: '/users/{userId}',
    role: 'admin',
    note: 'One account with its roles, active sessions and recent activity.',
  },

  // --- Forests ------------------------------------------------------------
  {
    id: 'forests-list',
    folder: 'Forests & GIS',
    name: 'List forests (public)',
    method: 'GET',
    path: '/forests',
    role: 'none',
    query: { page: 1, limit: 5 },
    capture: { forestId: 'data.0.id' },
    note: 'Public forest catalogue — readable without authentication.',
  },
  {
    id: 'forests-statistics',
    folder: 'Forests & GIS',
    name: 'Forest coverage statistics',
    method: 'GET',
    path: '/forests/statistics',
    role: 'none',
    note: 'Public coverage figures used on the dashboard.',
  },
  {
    id: 'forests-detail',
    folder: 'Forests & GIS',
    name: 'Forest detail',
    method: 'GET',
    path: '/forests/{forestId}',
    role: 'admin',
    note: 'Forest with its zones, inventory summary and recent activities.',
  },
  {
    id: 'forests-zones',
    folder: 'Forests & GIS',
    name: 'Zones of a forest',
    method: 'GET',
    path: '/forests/{forestId}/zones',
    role: 'none',
    capture: { zoneId: 'data.0.id' },
    note: 'Management zones inside a forest (production, protection, buffer…).',
  },
  {
    id: 'forests-inventory-statistics',
    folder: 'Forests & GIS',
    name: 'Timber inventory statistics',
    method: 'GET',
    path: '/forests/inventory/statistics',
    role: 'admin',
    query: { forestId: (v) => v.forestId },
    note: 'Standing volume, plot counts and species mix — optional forestId filter.',
  },
  {
    id: 'tree-species-list',
    folder: 'Forests & GIS',
    name: 'Tree species catalogue',
    method: 'GET',
    path: '/tree-species',
    role: 'none',
    query: { page: 1, limit: 5 },
    capture: { speciesId: 'data.0.id' },
    note: 'Public species catalogue with IUCN status and harvest rules.',
  },
  {
    id: 'protected-areas-list',
    folder: 'Forests & GIS',
    name: 'Protected areas',
    method: 'GET',
    path: '/protected-areas',
    role: 'none',
    query: { page: 1, limit: 5 },
    capture: { protectedAreaId: 'data.0.id' },
    note: 'Parks, reserves and sanctuaries — public reference data.',
  },
  {
    id: 'inventory-list',
    folder: 'Forests & GIS',
    name: 'Inventory plots',
    method: 'GET',
    path: '/inventory',
    role: 'admin',
    query: { page: 1, limit: 5 },
    capture: { inventoryId: 'data.0.id' },
    note: 'Timber inventory plots with volumes and health status.',
  },
  {
    id: 'gis-map',
    folder: 'Forests & GIS',
    name: 'Public map (GeoJSON)',
    method: 'GET',
    path: '/gis/map',
    role: 'none',
    note: 'GeoJSON FeatureCollection for the public map screen.',
  },
  {
    id: 'gis-map-full',
    folder: 'Forests & GIS',
    name: 'Full map (officers)',
    method: 'GET',
    path: '/gis/map/full',
    role: 'officer',
    note: 'Adds alerts, violations and field check-ins to the public layers.',
  },
  {
    id: 'gis-layers',
    folder: 'Forests & GIS',
    name: 'Layer legend',
    method: 'GET',
    path: '/gis/layers',
    role: 'officer',
    note: 'Layer legend with the feature count behind each layer.',
  },
  {
    id: 'gis-nearby',
    folder: 'Forests & GIS',
    name: 'Features near a position',
    method: 'GET',
    path: '/gis/nearby',
    role: 'officer',
    query: { latitude: 3.848, longitude: 11.5021, radiusKm: 50 },
    note: 'Haversine proximity search evaluated in the database.',
  },
  {
    id: 'gis-statistics',
    folder: 'Forests & GIS',
    name: 'GIS coverage statistics',
    method: 'GET',
    path: '/gis/statistics',
    role: 'officer',
    note: 'How much of the estate is mapped, and where the gaps are.',
  },

  // --- Companies ----------------------------------------------------------
  {
    id: 'companies-list',
    folder: 'Companies',
    name: 'List companies',
    method: 'GET',
    path: '/companies',
    role: 'admin',
    query: { page: 1, limit: 5 },
    capture: { companyId: 'data.0.id' },
    note: 'All companies for regulators; a representative only ever sees their own.',
  },
  {
    id: 'companies-statistics',
    folder: 'Companies',
    name: 'Company statistics',
    method: 'GET',
    path: '/companies/statistics',
    role: 'admin',
    note: 'Counts by status, type and region.',
  },
  {
    id: 'companies-detail',
    folder: 'Companies',
    name: 'Company detail',
    method: 'GET',
    path: '/companies/{companyId}',
    role: 'admin',
    note: 'Company with documents, members and a permit summary.',
  },
  {
    id: 'companies-documents',
    folder: 'Companies',
    name: 'Company documents',
    method: 'GET',
    path: '/companies/{companyId}/documents',
    role: 'admin',
    capture: { companyDocumentId: 'data.0.id' },
    note: 'Compliance documents attached to the company file.',
  },
  {
    id: 'companies-me',
    folder: 'Companies',
    name: 'My company',
    method: 'GET',
    path: '/companies/me',
    role: 'company',
    note: 'The company of the signed-in representative, with documents and members.',
  },

  // --- Permits ------------------------------------------------------------
  {
    id: 'permits-list',
    folder: 'Permits',
    name: 'List permits',
    method: 'GET',
    path: '/permits',
    role: 'admin',
    query: { page: 1, limit: 5 },
    capture: { permitId: 'data.0.id', activePermitId: 'data.1.id' },
    note: 'Every permit in the caller’s scope; a representative only sees their own.',
  },
  {
    id: 'permits-statistics',
    folder: 'Permits',
    name: 'Permit statistics',
    method: 'GET',
    path: '/permits/statistics',
    role: 'admin',
    note: 'Statuses, authorised volumes, fees and expiries for the caller’s scope.',
  },
  {
    id: 'permits-detail',
    folder: 'Permits',
    name: 'Permit detail',
    method: 'GET',
    path: '/permits/{permitId}',
    role: 'admin',
    note: 'Permit with documents, status history, payments, activities and the actions available to you.',
  },
  {
    id: 'permits-actions',
    folder: 'Permits',
    name: 'Available actions',
    method: 'GET',
    path: '/permits/{permitId}/actions',
    role: 'admin',
    note: 'The state machine, computed for this permit and this caller — the API never trusts the client to guess.',
  },
  {
    id: 'permits-timeline',
    folder: 'Permits',
    name: 'Permit timeline',
    method: 'GET',
    path: '/permits/{permitId}/timeline',
    role: 'admin',
    note: 'Every status change with who made it, when and why.',
  },
  {
    id: 'permits-documents',
    folder: 'Permits',
    name: 'Permit documents',
    method: 'GET',
    path: '/permits/{permitId}/documents',
    role: 'admin',
    capture: { permitDocumentId: 'data.0.id' },
    note: 'Documents supporting the application and their verification state.',
  },
  {
    id: 'permits-lifecycle',
    folder: 'Permits',
    name: 'Lifecycle reference',
    method: 'GET',
    path: '/permits/lifecycle',
    role: 'admin',
    note: 'Every transition: from-status, to-status, whether a reason is required and who may trigger it.',
  },
  {
    id: 'permits-expiring',
    folder: 'Permits',
    name: 'Expiring permits',
    method: 'GET',
    path: '/permits/expiring',
    role: 'admin',
    query: { days: 60 },
    note: 'Permits that will lapse within N days (default 30).',
  },
  {
    id: 'permits-download',
    folder: 'Permits',
    name: 'Download permit certificate (PDF)',
    method: 'GET',
    path: '/permits/{permitId}/download',
    role: 'admin',
    note: 'Server-rendered PDF. A permit that is not in force is stamped “not valid” instead of being refused.',
  },

  // --- Payments -----------------------------------------------------------
  {
    id: 'payments-provider',
    folder: 'Payments',
    name: 'Active payment provider',
    method: 'GET',
    path: '/payments/provider',
    role: 'admin',
    note: 'Which provider is wired up (Campay or the labelled local simulator) and whether it is complete.',
  },
  {
    id: 'payments-list',
    folder: 'Payments',
    name: 'List payments',
    method: 'GET',
    path: '/payments',
    role: 'admin',
    query: { page: 1, limit: 5 },
    capture: { paymentId: 'data.0.id', settledPaymentId: 'data.1.id' },
    note: 'Fees, royalties, penalties and bonds recorded on the ledger.',
  },
  {
    id: 'payments-statistics',
    folder: 'Payments',
    name: 'Collection statistics',
    method: 'GET',
    path: '/payments/statistics',
    role: 'admin',
    note: 'Totals collected, purpose mix and a 12-month trend.',
  },
  {
    id: 'payments-detail',
    folder: 'Payments',
    name: 'Payment detail',
    method: 'GET',
    path: '/payments/{paymentId}',
    role: 'admin',
    note: 'One payment with its provider reference and settlement state.',
  },
  {
    id: 'discovery-settled-payment',
    folder: 'Payments',
    name: 'Find a settled payment',
    method: 'GET',
    path: '/payments',
    role: 'admin',
    hidden: true,
    query: { status: 'SUCCESSFUL', page: 1, limit: 1 },
    capture: { settledPaymentId: 'data.0.id' },
  },
  {
    id: 'payments-receipt',
    folder: 'Payments',
    name: 'Receipt data',
    method: 'GET',
    path: '/payments/{settledPaymentId}/receipt',
    role: 'admin',
    note: 'Receipt payload for a settled payment — the same data that is rendered into the PDF.',
  },
  {
    id: 'payments-receipt-pdf',
    folder: 'Payments',
    name: 'Download receipt (PDF)',
    method: 'GET',
    path: '/payments/{settledPaymentId}/receipt/pdf',
    role: 'admin',
    note: 'Printable receipt. Simulated settlements are stamped “no funds moved”.',
  },

  // --- Inspections --------------------------------------------------------
  {
    id: 'inspections-list',
    folder: 'Inspections',
    name: 'List inspections',
    method: 'GET',
    path: '/inspections',
    role: 'inspector',
    query: { page: 1, limit: 5 },
    capture: { inspectionId: 'data.0.id' },
    note: 'Inspections in the caller’s scope; an inspector sees their own assignments.',
  },
  {
    id: 'inspections-statistics',
    folder: 'Inspections',
    name: 'Inspection statistics',
    method: 'GET',
    path: '/inspections/statistics',
    role: 'inspector',
    note: 'Coverage, outcomes and the violations raised by inspections.',
  },
  {
    id: 'inspections-detail',
    folder: 'Inspections',
    name: 'Inspection detail',
    method: 'GET',
    path: '/inspections/{inspectionId}',
    role: 'inspector',
    note: 'Checklist, evidence, observations and linked violations.',
  },
  {
    id: 'inspections-evidence',
    folder: 'Inspections',
    name: 'Evidence register',
    method: 'GET',
    path: '/inspections/evidence',
    role: 'inspector',
    query: { page: 1, limit: 5 },
    note: 'Evidence attached to inspections, observations or activities.',
  },

  // --- Exploitation -------------------------------------------------------
  {
    id: 'activities-list',
    folder: 'Exploitation',
    name: 'List field activities',
    method: 'GET',
    path: '/activities',
    role: 'operator',
    query: { page: 1, limit: 5 },
    capture: { activityId: 'data.0.id' },
    note: 'Harvesting, transport, planting and survey activities in the caller’s scope.',
  },
  {
    id: 'activities-statistics',
    folder: 'Exploitation',
    name: 'Harvest statistics',
    method: 'GET',
    path: '/activities/statistics',
    role: 'operator',
    note: 'Harvested volumes, activity mix and the monthly trend.',
  },
  {
    id: 'activities-detail',
    folder: 'Exploitation',
    name: 'Activity detail',
    method: 'GET',
    path: '/activities/{activityId}',
    role: 'operator',
    note: 'One activity with its observations, inspections and violations.',
  },
  {
    id: 'equipment-list',
    folder: 'Exploitation',
    name: 'Equipment registry',
    method: 'GET',
    path: '/equipment',
    role: 'company',
    query: { page: 1, limit: 5 },
    capture: { equipmentId: 'data.0.id' },
    note: 'The signed-in company’s machinery, with maintenance dates.',
  },

  // --- Observations -------------------------------------------------------
  {
    id: 'observations-list',
    folder: 'Observations',
    name: 'List observations',
    method: 'GET',
    path: '/observations',
    role: 'operator',
    query: { page: 1, limit: 5 },
    capture: { observationId: 'data.0.id' },
    note: 'Field observations recorded on site, online or synchronised from offline capture.',
  },
  {
    id: 'observations-statistics',
    folder: 'Observations',
    name: 'Observation statistics',
    method: 'GET',
    path: '/observations/statistics',
    role: 'operator',
    note: 'Counts by category and severity.',
  },
  {
    id: 'observations-detail',
    folder: 'Observations',
    name: 'Observation detail',
    method: 'GET',
    path: '/observations/{observationId}',
    role: 'operator',
    note: 'One observation with its GPS fix, media and review state.',
  },

  // --- Environmental ------------------------------------------------------
  {
    id: 'violations-list',
    folder: 'Environmental',
    name: 'List violations',
    method: 'GET',
    path: '/violations',
    role: 'environment',
    query: { page: 1, limit: 5 },
    capture: { violationId: 'data.0.id' },
    note: 'Environmental and forestry offence cases.',
  },
  {
    id: 'violations-statistics',
    folder: 'Environmental',
    name: 'Case statistics',
    method: 'GET',
    path: '/violations/statistics',
    role: 'environment',
    note: 'Case counts, assessed damage, penalties and overdue remediation.',
  },
  {
    id: 'violations-detail',
    folder: 'Environmental',
    name: 'Case detail',
    method: 'GET',
    path: '/violations/{violationId}',
    role: 'environment',
    note: 'Penalty position, linked alerts, evidence and the actions available next.',
  },
  {
    id: 'violations-penalty',
    folder: 'Environmental',
    name: 'Penalty position',
    method: 'GET',
    path: '/violations/{violationId}/penalty',
    role: 'environment',
    note: 'What was assessed, what was actually settled through the provider, and what is outstanding.',
  },

  // --- AI -----------------------------------------------------------------
  {
    id: 'ai-status',
    folder: 'AI Forest Intelligence',
    name: 'AI module status',
    method: 'GET',
    path: '/ai/status',
    role: 'officer',
    note: 'Which provider is answering (model-backed or the deterministic rule engine) and what it may see.',
  },
  {
    id: 'ai-catalogue',
    folder: 'AI Forest Intelligence',
    name: 'Rule catalogue',
    method: 'GET',
    path: '/ai/catalogue',
    role: 'officer',
    note: 'Every detection rule with its thresholds, the alert action it proposes and the data it reads.',
  },
  {
    id: 'ai-alerts-list',
    folder: 'AI Forest Intelligence',
    name: 'List AI signals',
    method: 'GET',
    path: '/ai/alerts',
    role: 'officer',
    query: { page: 1, limit: 5 },
    capture: { alertId: 'data.0.id' },
    note: 'Signals raised by the analysis engine, newest first.',
  },
  {
    id: 'ai-alerts-statistics',
    folder: 'AI Forest Intelligence',
    name: 'Alert workload',
    method: 'GET',
    path: '/ai/alerts/statistics',
    role: 'officer',
    note: 'Review status, risk levels, types, forests and how many were confirmed by a human.',
  },
  {
    id: 'ai-alerts-detail',
    folder: 'AI Forest Intelligence',
    name: 'Alert with reasoning',
    method: 'GET',
    path: '/ai/alerts/{alertId}',
    role: 'officer',
    note: 'The evidence, thresholds and records behind one signal — an alert is always reviewable.',
  },
  {
    id: 'ai-analyses-list',
    folder: 'AI Forest Intelligence',
    name: 'Analyses',
    method: 'GET',
    path: '/ai/analyses',
    role: 'officer',
    query: { page: 1, limit: 5 },
    note: 'Analyses already run; regulators see every analysis, others only their own.',
  },
  {
    id: 'ai-assistant-conversations',
    folder: 'AI Forest Intelligence',
    name: 'Assistant conversations',
    method: 'GET',
    path: '/ai/assistant/conversations',
    role: 'officer',
    note: 'The caller’s own Forest Assistant threads — never another user’s.',
  },
  {
    id: 'ai-assistant-ask',
    folder: 'AI Forest Intelligence',
    name: 'Ask the Forest Assistant',
    method: 'POST',
    path: '/ai/assistant/ask',
    role: 'officer',
    body: { question: 'Which permits expire in the next 30 days and how much have their holders paid?' },
    capture: { conversationId: 'data.conversationId' },
    note: 'The assistant answers only from records the caller is already authorised to read.',
  },
  {
    id: 'ai-analyses-run',
    folder: 'AI Forest Intelligence',
    name: 'Run an analysis',
    method: 'POST',
    path: '/ai/analyses',
    role: 'officer',
    body: (v) => ({ type: 'RISK_ASSESSMENT', forestId: v.forestId }),
    capture: { analysisId: 'data.id' },
    note: 'Runs the detection rules over live data and raises reviewable alerts. It never decides for a human.',
  },
  {
    id: 'ai-analyses-detail',
    folder: 'AI Forest Intelligence',
    name: 'Analysis detail',
    method: 'GET',
    path: '/ai/analyses/{analysisId}',
    role: 'officer',
    note: 'Findings of one run and the alerts it raised.',
  },

  // --- Reports ------------------------------------------------------------
  {
    id: 'reports-catalogue',
    folder: 'Reports',
    name: 'Report catalogue',
    method: 'GET',
    path: '/reports/catalogue',
    role: 'admin',
    note: 'Available report types, their columns and the formats each supports.',
  },
  {
    id: 'reports-list',
    folder: 'Reports',
    name: 'Generated reports',
    method: 'GET',
    path: '/reports',
    role: 'admin',
    query: { page: 1, limit: 5 },
    capture: { reportId: 'data.0.id' },
    note: 'Reports already generated, with their summary block and totals.',
  },
  {
    id: 'reports-statistics',
    folder: 'Reports',
    name: 'Report statistics',
    method: 'GET',
    path: '/reports/statistics',
    role: 'admin',
    note: 'Reports generated by type, format and status.',
  },
  {
    id: 'reports-preview',
    folder: 'Reports',
    name: 'Preview a dataset',
    method: 'POST',
    path: '/reports/preview',
    role: 'admin',
    body: (v) => ({ type: 'PERMITS', format: 'JSON', forestId: v.forestId, maxRows: 5 }),
    note: 'Runs the query without writing a file — the same rows the report would contain.',
  },
  {
    id: 'reports-generate',
    folder: 'Reports',
    name: 'Generate a report',
    method: 'POST',
    path: '/reports',
    role: 'admin',
    body: (v) => ({
      type: 'PAYMENTS',
      format: 'CSV',
      title: 'Postman walkthrough — collections by purpose',
      maxRows: 200,
    }),
    capture: { generatedReportId: 'data.id' },
    note: 'Generates the file server-side and returns its metadata plus summary totals.',
  },
  {
    id: 'reports-detail',
    folder: 'Reports',
    name: 'Report detail',
    method: 'GET',
    path: '/reports/{generatedReportId}',
    role: 'admin',
    note: 'Metadata, parameters and the summary block computed at generation time.',
  },
  {
    id: 'reports-download',
    folder: 'Reports',
    name: 'Download report file',
    method: 'GET',
    path: '/reports/{generatedReportId}/download',
    role: 'admin',
    note: 'The generated JSON / CSV / PDF payload.',
  },

  // --- Notifications ------------------------------------------------------
  {
    id: 'notifications-list',
    folder: 'Notifications',
    name: 'Notification inbox',
    method: 'GET',
    path: '/notifications',
    role: 'admin',
    query: { page: 1, limit: 5 },
    capture: { notificationId: 'data.0.id' },
    note: 'The signed-in user’s notifications, newest first.',
  },
  {
    id: 'notifications-unread-count',
    folder: 'Notifications',
    name: 'Unread count',
    method: 'GET',
    path: '/notifications/unread-count',
    role: 'admin',
    note: 'Drives the badge on the notifications tab.',
  },

  // --- Audit --------------------------------------------------------------
  {
    id: 'audit-list',
    folder: 'Audit',
    name: 'Audit trail',
    method: 'GET',
    path: '/audit',
    role: 'admin',
    query: { page: 1, limit: 5 },
    note: 'Who did what, to which record, from where — including refused sign-ins.',
  },
  {
    id: 'audit-summary',
    folder: 'Audit',
    name: 'Audit summary',
    method: 'GET',
    path: '/audit/summary',
    role: 'admin',
    note: 'Audit activity grouped for the monitoring dashboard.',
  },

  // --- Media --------------------------------------------------------------
  {
    id: 'media-list',
    folder: 'Media',
    name: 'Media descriptors',
    method: 'GET',
    path: '/media',
    role: 'none',
    capture: { mediaId: 'data.0.id' },
    note: 'Public media descriptors (no bytes) used for forest and species imagery.',
  },
  {
    id: 'media-covers',
    folder: 'Media',
    name: 'Cover images',
    method: 'GET',
    path: '/media/covers',
    role: 'none',
    note: 'One cover descriptor per owner id — avoids a request per card in a list.',
  },


  // --- Write operations: one permit, end to end ---------------------------
  {
    id: 'forests-create',
    folder: 'Write operations',
    name: 'Register a forest',
    method: 'POST',
    path: '/forests',
    role: 'officer',
    body: {
      code: 'UFA-POSTMAN-001',
      name: 'Unité Forestière d’Aménagement — Parcellaire de démonstration Postman',
      type: 'PRODUCTION',
      region: 'Centre',
      division: 'Nyong et So’o',
      subdivision: 'Mbalmayo',
      totalAreaHa: 12400,
      exploitableAreaHa: 9100,
      latitude: 3.5167,
      longitude: 11.5,
      annualAllowableCutM3: 42000,
      description: 'Forest created by the documented Postman walkthrough.',
    },
    capture: { createdForestId: 'data.id' },
    note: 'Officers register forests and UFAs; the response echoes the stored record.',
  },
  {
    id: 'forests-create-zone',
    folder: 'Write operations',
    name: 'Create a forest zone',
    method: 'POST',
    path: '/forests/{createdForestId}/zones',
    role: 'officer',
    body: {
      code: 'ZONE-POSTMAN-A1',
      name: 'Assiette de coupe A1 (démonstration Postman)',
      zoneType: 'PRODUCTION',
      areaHa: 1250,
      latitude: 3.52,
      longitude: 11.51,
    },
    capture: { createdZoneId: 'data.id' },
    note: 'Zones are the unit of authorisation: a permit always points at one.',
  },
  {
    id: 'permits-create',
    folder: 'Write operations',
    name: 'File a permit application',
    method: 'POST',
    path: '/permits',
    role: 'company',
    body: (v) => ({
      type: 'EXPLOITATION',
      title: 'Coupe annuelle 2027 — assiette A1 (démonstration Postman)',
      purpose: 'Selective logging of the annual allowable cut, filed through Postman.',
      priority: 'NORMAL',
      forestId: v.createdForestId,
      zoneId: v.createdZoneId,
      volumeRequestedM3: 3200,
      areaRequestedHa: 1250,
      startDate: '2027-01-15',
      endDate: '2027-12-15',
      conditions: 'Respect the 70 cm minimum felling diameter and the 25 m riparian buffer.',
    }),
    capture: { createdPermitId: 'data.id' },
    note: 'A representative files for their own company; the API ignores any companyId they try to pass.',
  },
  {
    id: 'permits-submit',
    folder: 'Write operations',
    name: 'Submit the application',
    method: 'POST',
    path: '/permits/{createdPermitId}/actions/SUBMIT',
    role: 'company',
    note: 'DRAFT → SUBMITTED. Only the applicant can submit their own application.',
  },
  {
    id: 'permits-start-review',
    folder: 'Write operations',
    name: 'Start the review',
    method: 'POST',
    path: '/permits/{createdPermitId}/actions/START_REVIEW',
    role: 'officer',
    note: 'SUBMITTED → UNDER_REVIEW. The officer claims the file; the reviewer is recorded.',
  },
  {
    id: 'permits-approve',
    folder: 'Write operations',
    name: 'Approve the application',
    method: 'POST',
    path: '/permits/{createdPermitId}/actions/APPROVE',
    role: 'officer',
    capture: { createdPermitFee: 'data.feeAmount' },
    note: 'UNDER_REVIEW → APPROVED. The approved volume and the fee are fixed at this point.',
  },
  {
    id: 'permits-mark-payment-pending',
    folder: 'Write operations',
    name: 'Mark payment pending',
    method: 'POST',
    path: '/permits/{createdPermitId}/actions/MARK_PAYMENT_PENDING',
    role: 'company',
    note: 'APPROVED → PAYMENT_PENDING. The permit cannot be activated until the fee is settled.',
  },
  {
    id: 'payments-create',
    folder: 'Write operations',
    name: 'Pay the permit fee',
    method: 'POST',
    path: '/payments',
    role: 'company',
    body: (v) => ({
      purpose: 'PERMIT_FEE',
      permitId: v.createdPermitId,
      amount: Number(v.createdPermitFee ?? 8000000),
      method: 'MOBILE_MONEY_MTN',
      payerPhone: '+237677000111',
      notes: 'Permit fee — Postman walkthrough',
      clientRef: 'postman-walkthrough-0001',
    }),
    capture: { createdPaymentId: 'data.id' },
    note: 'Idempotent through clientRef: replaying the same reference never creates a second debit.',
  },
  {
    id: 'payments-simulate',
    folder: 'Write operations',
    name: 'Confirm sandbox settlement',
    method: 'POST',
    path: '/payments/{createdPaymentId}/simulate',
    role: 'admin',
    body: { outcome: 'SUCCESSFUL' },
    note: 'Only available while PAYMENT_PROVIDER=simulator. The receipt is stamped “no funds moved”.',
  },
  {
    id: 'permits-activate',
    folder: 'Write operations',
    name: 'Activate the permit',
    method: 'POST',
    path: '/permits/{createdPermitId}/actions/ACTIVATE',
    role: 'officer',
    note: 'PAYMENT_PENDING → ACTIVE, allowed only once the fee is actually settled on the ledger.',
  },
  {
    id: 'observations-create',
    folder: 'Write operations',
    name: 'Record a field observation',
    method: 'POST',
    path: '/observations',
    role: 'operator',
    body: (v) => ({
      category: 'ILLEGAL_LOGGING',
      severity: 'HIGH',
      title: 'Fresh stumps outside the marked cutting area',
      description:
        'Three sapelli stumps found about 40 m beyond the boundary marks, with no entry in the harvest register.',
      forestId: v.createdForestId,
      zoneId: v.createdZoneId,
      latitude: 3.5181,
      longitude: 11.5032,
      locationAccuracyM: 8.4,
      clientRef: 'postman-obs-0001',
    }),
    capture: { createdObservationId: 'data.id' },
    note: 'clientRef de-duplicates retries so a flaky connection never double-records an observation.',
  },
  {
    id: 'inspections-create',
    folder: 'Write operations',
    name: 'Schedule an inspection',
    method: 'POST',
    path: '/inspections',
    role: 'officer',
    body: (v) => ({
      type: 'COMPLIANCE',
      title: 'Contrôle de conformité — assiette A1 (démonstration Postman)',
      forestId: v.createdForestId,
      zoneId: v.createdZoneId,
      permitId: v.createdPermitId,
      scheduledFor: '2027-03-05T08:00:00.000Z',
      checklist: [
        { code: 'A1-01', label: 'Boundary marks present and legible' },
        { code: 'A1-02', label: 'Felling diameter respected on sampled stumps' },
        { code: 'A1-03', label: 'Harvest register matches the stumps on site' },
      ],
    }),
    capture: { createdInspectionId: 'data.id' },
    note: 'Scheduled inspections move through start → submit → review → close, each step audited.',
  },
  {
    id: 'violations-create',
    folder: 'Write operations',
    name: 'Open a violation case',
    method: 'POST',
    path: '/violations',
    role: 'environment',
    body: (v) => ({
      title: 'Coupe hors assiette — assiette A1 (démonstration Postman)',
      description:
        'Stumps recorded outside the approved cutting area during the Postman walkthrough inspection; a survey is requested.',
      severity: 'HIGH',
      forestId: v.createdForestId,
      zoneId: v.createdZoneId,
      permitId: v.createdPermitId,
      observationId: v.createdObservationId,
      latitude: 3.5181,
      longitude: 11.5032,
      estimatedDamageXAF: 450000,
      penaltyAmountXAF: 900000,
      remediationRequired: true,
      remediationDeadline: '2027-02-28',
    }),
    capture: { createdViolationId: 'data.id' },
    note: 'A case opened from documented evidence; penalties and remediation are tracked to closure.',
  },
  {
    id: 'violations-action-investigate',
    folder: 'Write operations',
    name: 'Progress a case — INVESTIGATE',
    method: 'POST',
    path: '/violations/{createdViolationId}/actions/INVESTIGATE',
    role: 'environment',
    body: { reason: 'Field survey ordered after the Postman walkthrough inspection.' },
    note: 'Case transitions are explicit: INVESTIGATE, CONFIRM, DISMISS, ESCALATE, RESOLVE, REOPEN.',
  },
  {
    id: 'gis-record-position',
    folder: 'Write operations',
    name: 'Record a GPS check-in',
    method: 'POST',
    path: '/gis/positions',
    role: 'operator',
    body: () => ({
      latitude: 3.5181,
      longitude: 11.5032,
      accuracyM: 8.4,
      elevationM: 640,
      label: 'Assiette A1 — contrôle de démonstration Postman',
      source: 'DEVICE_GPS',
    }),
    note: 'Field check-ins feed the map, the “nearby” search and the operational anomaly rules.',
  },
  {
    id: 'notifications-broadcast',
    folder: 'Write operations',
    name: 'Broadcast an announcement',
    method: 'POST',
    path: '/notifications/broadcast',
    role: 'admin',
    body: {
      title: 'Maintenance planifiée',
      message: 'The FEMS API will be restarted tonight at 23:00 for a database upgrade.',
    },
    note: 'Administrators only: one call notifies every active account.',
  },
  {
    id: 'validation-error',
    folder: 'Write operations',
    name: 'Validation refusal (400)',
    method: 'POST',
    path: '/observations',
    role: 'operator',
    body: { category: 'NOT_A_CATEGORY', title: 'x', description: '', forestId: 'not-a-uuid', latitude: 999, longitude: 0 },
    expectError: true,
    note: 'class-validator rejects the payload field by field; unknown properties are refused rather than ignored.',
  },
];

// ---------------------------------------------------------------------------

console.error(`FEMS API capture — ${BASE}`);
console.error('signing in…');
await signIn();
console.error(`signed in as: ${Object.keys(tokens).join(', ')}\nrunning ${steps.length} requests…`);

for (const step of steps) {
  // Resolve functions that need the variables filled in by earlier steps.
  const resolved = { ...step };
  if (typeof step.body === 'function') resolved.body = step.body(vars);
  if (step.query) {
    resolved.query = {};
    for (const [key, value] of Object.entries(step.query)) {
      resolved.query[key] = typeof value === 'function' ? value(vars) : value;
    }
  }
  try {
    await call(resolved);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${step.id} threw: ${error.message}`);
    results.push({
      id: step.id,
      folder: step.folder,
      name: step.name,
      method: step.method,
      path: step.path,
      url: BASE + step.path,
      role: step.role ?? 'none',
      requestBody: resolved.body,
      status: 0,
      statusText: error.message,
      elapsedMs: 0,
      sizeBytes: 0,
      responseBody: { error: error.message },
      ok: false,
      note: step.note,
    });
  }
}

const payload = {
  baseUrl: BASE,
  capturedAt: new Date().toISOString(),
  accounts: ACCOUNTS,
  tokenVariables: TOKEN_VARIABLE,
  roleLabels: ROLE_LABEL,
  requests: results,
  variables: vars,
  failures,
};

writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
console.error(`\n${results.length} requests captured, ${failures} unexpected failure(s) → ${outFile}`);
console.log(JSON.stringify(payload, null, 2));
