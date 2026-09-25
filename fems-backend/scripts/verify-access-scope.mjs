#!/usr/bin/env node
/**
 * End-to-end access-control check against a running API.
 *
 * It signs in with every seeded role account and proves two things at once:
 *   1. the role matrix — which modules a role may read at all;
 *   2. data scoping — a company account only ever receives its own records,
 *      whatever permission it holds (this is what caught the cross-company
 *      activity leak in the exploitation scope).
 *
 * Usage: node scripts/verify-access-scope.mjs [apiBaseUrl]
 */
const BASE = process.argv[2] ?? process.env.FEMS_API_URL ?? 'http://127.0.0.1:3000/api/v1';
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'FemsDemo#2026';

let failures = 0;
let checks = 0;

function check(label, ok, detail = '') {
  checks += 1;
  if (ok) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, endpoint, options = {}) {
  const response = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

/** The API throttles journeys (120 requests/minute): back off when told to. */
async function login(email) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    if (response.status !== 429) return response;
    await new Promise((resolve) => setTimeout(resolve, 25_000 * (attempt + 1)));
  }
  return call('POST', '/auth/login', { body: { email, password: PASSWORD } });
}

// Accounts that represent a logging company. Their own company id is resolved
// from the API — never hard-coded — so the check keeps working whatever the
// dataset looks like.
const EMPLOYER_ACCOUNTS = new Set([
  'demo.company@fems.cm',
  'demo.cooperative@fems.cm',
  'demo.efe@fems.cm',
  'demo.bsc@fems.cm',
  'demo.cwpi@fems.cm',
]);

const EXPECTED = {
  'demo.admin@fems.cm': { permits: 200, inspections: 200, payments: 200, violations: 200, alerts: 200, reports: 200, activities: 200 },
  'demo.officer@fems.cm': { permits: 200, inspections: 200, payments: 200, violations: 200, alerts: 200, reports: 200, activities: 200 },
  'demo.environment@fems.cm': { permits: 200, inspections: 200, payments: 403, violations: 200, alerts: 200, reports: 200, activities: 200 },
  'demo.inspector@fems.cm': { permits: 200, inspections: 200, payments: 403, violations: 200, alerts: 200, reports: 200, activities: 200 },
  'demo.operator@fems.cm': { permits: 403, inspections: 200, payments: 403, violations: 200, alerts: 403, reports: 403, activities: 200 },
  'demo.company@fems.cm': { permits: 200, inspections: 200, payments: 200, violations: 200, alerts: 403, reports: 200, activities: 200 },
  'demo.cooperative@fems.cm': { permits: 200, inspections: 200, payments: 200, violations: 200, alerts: 403, reports: 200, activities: 200 },
  'demo.efe@fems.cm': { permits: 200, inspections: 200, payments: 200, violations: 200, alerts: 403, reports: 200, activities: 200 },
  'demo.bsc@fems.cm': { permits: 200, inspections: 200, payments: 200, violations: 200, alerts: 403, reports: 200, activities: 200 },
  'demo.cwpi@fems.cm': { permits: 200, inspections: 200, payments: 200, violations: 200, alerts: 403, reports: 200, activities: 200 },
  'demo.explorer@fems.cm': { permits: 403, inspections: 403, payments: 403, violations: 403, alerts: 403, reports: 200, activities: 403 },
  'demo.visitor@fems.cm': { permits: 403, inspections: 403, payments: 403, violations: 403, alerts: 403, reports: 403, activities: 403 },
};

const MODULES = [
  ['permits', '/permits?limit=100', 'companyId'],
  ['inspections', '/inspections?limit=100', 'companyId'],
  ['payments', '/payments?limit=100', 'companyId'],
  ['violations', '/violations?limit=100', 'companyId'],
  ['alerts', '/ai/alerts?limit=100', 'companyId'],
  ['reports', '/reports?limit=100', 'companyId'],
  ['activities', '/activities?limit=100', 'companyId'],
];

console.log('FEMS access-scope verification');
console.log('------------------------------');

for (const [email, expected] of Object.entries(EXPECTED)) {
  console.log(`\n— ${email}`);
  const auth = await login(email);
  const token = auth.body?.data?.accessToken ?? auth.body?.data?.tokens?.accessToken;
  check('signs in with the seeded password', Boolean(token), token ? 'token issued' : `HTTP ${auth.status} ${auth.body?.error?.code ?? ''}`);
  if (!token) continue;

  let employer = null;
  if (EMPLOYER_ACCOUNTS.has(email)) {
    const mine = await call('GET', '/companies/me', { token });
    employer = mine.body?.data?.id ?? null;
    check(
      'resolves its own company from the API',
      Boolean(employer),
      employer ? employer : `HTTP ${mine.status} ${mine.body?.error?.code ?? ''}`,
    );
  }
  let leaked = 0;

  for (const [label, endpoint, scopeField] of MODULES) {
    const response = await call('GET', endpoint, { token });
    check(`${label} → HTTP ${expected[label]}`, response.status === expected[label], `got ${response.status} ${response.body?.error?.code ?? ''}`);
    if (response.status !== 200 || !employer) continue;

    const rows = Array.isArray(response.body?.data) ? response.body.data : [];
    const foreign = rows.filter((row) => row[scopeField] && row[scopeField] !== employer);
    leaked += foreign.length;
    check(
      `${label} rows belong to the caller's own company`,
      foreign.length === 0,
      foreign.length === 0 ? `${rows.length} row(s) in scope` : `${foreign.length} foreign row(s)`,
    );
  }

  if (employer) {
    check('no cross-company record is reachable through any list', leaked === 0, `${leaked} leak(s)`);
  }
}

console.log('');
console.log(failures === 0 ? `ALL GREEN — ${checks} checks passed` : `FAILURES — ${checks - failures} passed, ${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
