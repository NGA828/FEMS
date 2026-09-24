#!/usr/bin/env node
/**
 * FEMS E2E smoke — reports and exports.
 *
 * Exercises every report type through the real HTTP API, checking that the
 * dataset comes from the live database, that each format (JSON, CSV, PDF) is
 * rendered and stored, that the downloaded bytes match the declared format, and
 * that a company account only ever reports on its own records.
 *
 * Usage: node scripts/smoke-reports.mjs
 *        FEMS_API_URL=... FEMS_ADMIN_PASSWORD=... node scripts/smoke-reports.mjs
 *
 * Exit code 0 = every assertion passed.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.FEMS_API_URL ?? 'http://127.0.0.1:3000/api/v1';
const ADMIN_EMAIL = process.env.FEMS_ADMIN_EMAIL ?? 'admin@fems.cm';
const COMPANY = process.env.FEMS_SMOKE_COMPANY ?? '83a65695-931b-4714-8d62-50b4692cd8f5';
const COMPANY_USER_EMAIL = process.env.FEMS_SMOKE_COMPANY_EMAIL ?? 'env-smoke-company@fems.cm';
const COMPANY_USER_PASSWORD = 'FemsSmoke-Env9';
const STAMP = Date.now();

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`);
  }
};

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json };
}

function adminPassword() {
  if (process.env.FEMS_ADMIN_PASSWORD) return process.env.FEMS_ADMIN_PASSWORD;
  try {
    return readFileSync('/tmp/admin.pw', 'utf8').trim();
  } catch {
    console.error('Set FEMS_ADMIN_PASSWORD (or create /tmp/admin.pw) before running this smoke test.');
    process.exit(2);
  }
}

const login = await call('POST', '/auth/login', { body: { email: ADMIN_EMAIL, password: adminPassword() } });
check('admin login', login.status === 200 || login.status === 201, `HTTP ${login.status}`);
const token = login.body?.data?.accessToken ?? login.body?.data?.tokens?.accessToken;
if (!token) {
  console.error('No access token — aborting.', JSON.stringify(login.body).slice(0, 400));
  process.exit(1);
}

console.log('\n— catalogue —');
const catalogue = await call('GET', '/reports/catalogue', { token });
const types = (catalogue.body?.data?.reportTypes ?? []).map((entry) => entry.type);
check('GET /reports/catalogue', catalogue.status === 200, `HTTP ${catalogue.status}`);
check(
  'the eight report types are published',
  types.length === 8 &&
    ['PERMITS', 'EXPLOITATION_ACTIVITIES', 'PAYMENTS', 'INSPECTIONS', 'ENVIRONMENTAL_VIOLATIONS', 'FOREST_ACTIVITIES', 'COMPLIANCE_SUMMARY', 'AI_ALERTS'].every(
      (type) => types.includes(type),
    ),
  types.join(', '),
);
check(
  'every type documents its columns and formats',
  (catalogue.body?.data?.reportTypes ?? []).every((entry) => entry.columns.length > 3 && entry.formats.length === 3),
  `max rows=${catalogue.body?.data?.maxRows}`,
);

console.log('\n— preview —');
const preview = await call('POST', '/reports/preview', { token, body: { type: 'COMPLIANCE_SUMMARY' } });
check('POST /reports/preview → 201', preview.status === 201, `HTTP ${preview.status}`);
check(
  'preview computes the summary from live data',
  (preview.body?.data?.summary ?? []).length >= 5,
  JSON.stringify(preview.body?.data?.summary ?? []).slice(0, 160),
);
check(
  'preview lists the assessed companies with a score',
  (preview.body?.data?.rows ?? []).every((row) => typeof row.score === 'number' && typeof row.rating === 'string'),
  `${(preview.body?.data?.rows ?? []).length} row(s) previewed`,
);
const invalidPeriod = await call('POST', '/reports/preview', {
  token,
  body: { type: 'PAYMENTS', from: '2026-12-31', to: '2026-01-01' },
});
check(
  'an inverted period is refused',
  invalidPeriod.status === 400 && invalidPeriod.body?.error?.code === 'REPORT_PERIOD_INVALID',
  `HTTP ${invalidPeriod.status} ${invalidPeriod.body?.error?.code}`,
);

console.log('\n— generating every report type —');
const generated = {};
for (const type of ['PERMITS', 'EXPLOITATION_ACTIVITIES', 'PAYMENTS', 'INSPECTIONS', 'ENVIRONMENTAL_VIOLATIONS', 'FOREST_ACTIVITIES', 'COMPLIANCE_SUMMARY', 'AI_ALERTS']) {
  const created = await call('POST', '/reports', {
    token,
    body: { type, format: 'JSON', title: `Smoke ${type} ${STAMP}` },
  });
  const id = created.body?.data?.id;
  generated[type] = id;
  check(
    `${type} → 201 READY`,
    created.status === 201 && created.body?.data?.status === 'READY',
    `HTTP ${created.status} status=${created.body?.data?.status} rows=${created.body?.data?.rowCount} ${created.body?.error?.code ?? ''}`,
  );
  check(
    `${type} stored a file`,
    typeof created.body?.data?.fileKey === 'string' && Number(created.body?.data?.sizeBytes) > 0,
    `${created.body?.data?.sizeBytes} bytes`,
  );
}

console.log('\n— dataset content —');
const permits = await call('GET', `/reports/${generated.PERMITS}`, { token });
check(
  'the permit report summarises fees and volumes',
  (permits.body?.data?.summary ?? []).some((entry) => entry.label.includes('Fees invoiced')),
  JSON.stringify(permits.body?.data?.summary ?? []).slice(0, 200),
);
check('totals are computed per numeric column', Object.keys(permits.body?.data?.totals ?? {}).length >= 3, JSON.stringify(permits.body?.data?.totals ?? {}));

const payments = await call('GET', `/reports/${generated.PAYMENTS}`, { token });
check(
  'the payment report reports what the provider actually settled',
  Number(payments.body?.data?.totals?.amount ?? 0) > 0,
  `summed=${payments.body?.data?.totals?.amount} rows=${payments.body?.data?.rowCount}`,
);

const violations = await call('GET', `/reports/${generated.ENVIRONMENTAL_VIOLATIONS}`, { token });
check(
  'the case report states that humans open cases',
  JSON.stringify(violations.body?.data?.notes ?? []).includes('never opens a case'),
  JSON.stringify(violations.body?.data?.notes ?? []).slice(0, 160),
);

const alerts = await call('GET', `/reports/${generated.AI_ALERTS}`, { token });
check(
  'the alert report is honest about alerts being signals',
  JSON.stringify(alerts.body?.data?.notes ?? []).includes('signal, not a finding'),
  JSON.stringify(alerts.body?.data?.notes ?? []).slice(0, 160),
);

console.log('\n— formats and download —');
const csv = await call('POST', '/reports', { token, body: { type: 'PERMITS', format: 'CSV', title: `Smoke CSV permit register ${STAMP}` } });
check('CSV report generated', csv.status === 201 && csv.body?.data?.format === 'CSV', `HTTP ${csv.status}`);

const pdf = await call('POST', '/reports', {
  token,
  body: { type: 'COMPLIANCE_SUMMARY', format: 'PDF', title: `Smoke compliance scorecard ${STAMP}` },
});
check('PDF report generated', pdf.status === 201 && pdf.body?.data?.format === 'PDF', `HTTP ${pdf.status}`);

if (csv.body?.data?.id) {
  const download = await fetch(`${BASE}/reports/${csv.body.data.id}/download`, { headers: { authorization: `Bearer ${token}` } });
  const text = await download.text();
  check('CSV download → 200', download.status === 200, `HTTP ${download.status}`);
  check('CSV content type', (download.headers.get('content-type') ?? '').includes('text/csv'), download.headers.get('content-type') ?? 'none');
  check(
    'CSV carries the provenance header and the real columns',
    text.startsWith('# ') && text.includes('Organisation:') && /\r\nPermit,|\r\nPermit number,/.test(text),
    text.split('\r\n')[0].slice(0, 80),
  );
  check(
    'CSV is not empty',
    text.split('\r\n').length > 2,
    `${text.split('\r\n').length} lines`,
  );
}

if (pdf.body?.data?.id) {
  const download = await fetch(`${BASE}/reports/${pdf.body.data.id}/download`, { headers: { authorization: `Bearer ${token}` } });
  const buffer = Buffer.from(await download.arrayBuffer());
  check('PDF download → 200', download.status === 200, `HTTP ${download.status}`);
  check('PDF content type', (download.headers.get('content-type') ?? '').includes('application/pdf'), download.headers.get('content-type') ?? 'none');
  check('PDF has a PDF header', buffer.subarray(0, 5).toString() === '%PDF-', buffer.subarray(0, 8).toString().replace(/[^\x20-\x7e]/g, '.'));
  check('PDF is a real document (size)', buffer.length > 2000 && buffer.subarray(-6).toString().includes('EOF'), `${buffer.length} bytes`);
  check(
    'PDF attachment is named after the report',
    (download.headers.get('content-disposition') ?? '').includes('.pdf'),
    (download.headers.get('content-disposition') ?? '').slice(0, 60),
  );
}

console.log('\n— sharing —');
const officerEmail = process.env.FEMS_SMOKE_OFFICER_EMAIL ?? 'inspector-smoke@fems.cm';
const officerPassword = 'FemsSmoke-Rep7';
let officerPasswordUsed = officerPassword;
const officerLookup = await call('GET', `/users?search=${encodeURIComponent(officerEmail)}&limit=1`, { token });
let officer = Array.isArray(officerLookup.body?.data) ? officerLookup.body.data[0] : null;
if (!officer) {
  const created = await call('POST', '/users', {
    token,
    body: {
      firstName: 'Report',
      lastName: 'Smoke',
      email: officerEmail,
      role: 'FOREST_INSPECTOR',
      jobTitle: 'Chef de poste forestier',
      password: officerPassword,
    },
  });
  officer = created.body?.data?.user ?? null;
  check(
    'a forest service account exists to receive shared reports',
    Boolean(officer?.id),
    `HTTP ${created.status} ${created.body?.error?.code ?? ''} ${JSON.stringify(created.body?.error?.details ?? '').slice(0, 120)}`,
  );
} else {
  const reset = await call('POST', `/users/${officer.id}/reset-password`, { token, body: {} });
  officerPasswordUsed = reset.body?.data?.temporaryPassword ?? '';
}

const send = await call('POST', `/reports/${generated.COMPLIANCE_SUMMARY}/send`, {
  token,
  body: { audience: 'OFFICERS', message: 'Smoke: the scorecard is available for review.' },
});
check('POST /reports/:id/send → shared with the services', send.status === 201 && Number(send.body?.data?.delivered) > 0, `HTTP ${send.status} delivered=${send.body?.data?.delivered}`);
check('audience recorded', send.body?.data?.audience === 'OFFICERS', send.body?.data?.audience);

if (officerPasswordUsed) {
  const officerLogin = await call('POST', '/auth/login', { body: { email: officerEmail, password: officerPasswordUsed } });
  const officerToken = officerLogin.body?.data?.accessToken ?? officerLogin.body?.data?.tokens?.accessToken;
  if (officerToken) {
    const inbox = await call('GET', '/notifications?limit=10', { token: officerToken });
    const items = Array.isArray(inbox.body?.data) ? inbox.body.data : [];
    const shared = items.find((item) => item.entityId === generated.COMPLIANCE_SUMMARY);
    check(
      'the shared report reaches the officer inbox',
      Boolean(shared) && shared.type === 'REPORT_READY',
      shared ? `${shared.type}: ${shared.title}` : 'notification not found',
    );
  } else {
    check('the officer can sign in to read the share', false, `HTTP ${officerLogin.status}`);
  }
}

console.log('\n— company scope —');
let companyPassword = COMPANY_USER_PASSWORD;
let companyToken = null;
const companyLogin = await call('POST', '/auth/login', { body: { email: COMPANY_USER_EMAIL, password: companyPassword } });
companyToken = companyLogin.body?.data?.accessToken ?? companyLogin.body?.data?.tokens?.accessToken;
if (!companyToken) {
  const users = await call('GET', `/users?search=${encodeURIComponent(COMPANY_USER_EMAIL)}&limit=1`, { token });
  const existing = Array.isArray(users.body?.data) ? users.body.data[0] : null;
  if (existing?.id) {
    const reset = await call('POST', `/users/${existing.id}/reset-password`, { token, body: {} });
    companyPassword = reset.body?.data?.temporaryPassword ?? '';
    const retry = await call('POST', '/auth/login', { body: { email: COMPANY_USER_EMAIL, password: companyPassword } });
    companyToken = retry.body?.data?.accessToken ?? retry.body?.data?.tokens?.accessToken;
  }
}
check('company representative can sign in', Boolean(companyToken), companyToken ? 'token issued' : 'no token');

if (companyToken) {
  const companyPreview = await call('POST', '/reports/preview', { token: companyToken, body: { type: 'COMPLIANCE_SUMMARY' } });
  check('a company preview is generated', [200, 201].includes(companyPreview.status), `HTTP ${companyPreview.status}`);
  const rows = companyPreview.body?.data?.rows ?? [];
  check(
    'a company report only covers its own records',
    rows.length === 1,
    `${rows.length} row(s): ${rows.map((row) => row.companyName).join(', ')}`,
  );

  const foreignCompany = await call('POST', '/reports/preview', {
    token: companyToken,
    body: { type: 'PERMITS', companyId: '00000000-0000-4000-8000-000000000000' },
  });
  const foreignNames = [...new Set((foreignCompany.body?.data?.rows ?? []).map((row) => row.companyName))];
  check(
    'a company cannot ask for another organisation’s report',
    foreignCompany.status === 403 ||
      ([200, 201].includes(foreignCompany.status) && foreignNames.every((name) => rows.some((row) => row.companyName === name))),
    `HTTP ${foreignCompany.status} rows=${foreignCompany.body?.data?.rowCount ?? 'n/a'} companies=${foreignNames.join(', ') || 'none'}`,
  );

  const foreignReport = await call('GET', `/reports/${generated.AI_ALERTS}`, { token: companyToken });
  check(
    'a report generated for the administration is hidden from a company',
    foreignReport.status === 403 && foreignReport.body?.error?.code === 'REPORT_FORBIDDEN',
    `HTTP ${foreignReport.status} ${foreignReport.body?.error?.code}`,
  );

  const companyOwn = await call('POST', '/reports', {
    token: companyToken,
    body: { type: 'PAYMENTS', format: 'JSON', title: `Company payment statement ${STAMP}` },
  });
  check('a company can generate its own report', companyOwn.status === 201 && companyOwn.body?.data?.status === 'READY', `HTTP ${companyOwn.status}`);
  check(
    'the company report is stamped with the company',
    companyOwn.body?.data?.companyId === COMPANY,
    `companyId=${companyOwn.body?.data?.companyId}`,
  );
  const companyList = await call('GET', '/reports?limit=50', { token: companyToken });
  const items = Array.isArray(companyList.body?.data) ? companyList.body.data : [];
  check(
    'a company only lists the reports that concern it',
    items.every((item) => item.companyId === COMPANY),
    `${items.length} report(s), distinct companies=${[...new Set(items.map((item) => item.companyId))].length}`,
  );
}

console.log('\n— statistics and lifecycle —');
const stats = await call('GET', '/reports/statistics', { token });
check('GET /reports/statistics', stats.status === 200 && Number(stats.body?.data?.total) >= 10, `HTTP ${stats.status} total=${stats.body?.data?.total}`);
check(
  'statistics break the reports down by type',
  (stats.body?.data?.byType ?? []).length === 8,
  `types=${(stats.body?.data?.byType ?? []).length}`,
);

const deleted = await call('DELETE', `/reports/${generated.AI_ALERTS}`, { token });
check('DELETE /reports/:id', deleted.status === 200 && deleted.body?.data?.deleted === true, `HTTP ${deleted.status}`);
const afterDelete = await call('GET', `/reports/${generated.AI_ALERTS}`, { token });
check(
  'a deleted report is no longer readable',
  afterDelete.status === 404,
  `HTTP ${afterDelete.status} ${afterDelete.body?.error?.code}`,
);

const list = await call('GET', '/reports?limit=5', { token });
check(
  'GET /reports paginates',
  list.status === 200 && Array.isArray(list.body?.data) && list.body.data.length === 5 && Number(list.body?.meta?.total) >= 10,
  `items=${(list.body?.data ?? []).length} total=${list.body?.meta?.total}`,
);

console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
console.log(`pdfReport=${pdf.body?.data?.reference} csvReport=${csv.body?.data?.reference} scorecard=${generated.COMPLIANCE_SUMMARY}`);
process.exit(fail === 0 ? 0 : 1);
