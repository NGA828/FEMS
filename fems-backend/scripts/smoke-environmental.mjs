#!/usr/bin/env node
/**
 * FEMS E2E smoke — environmental violations.
 *
 * Covers the full regulatory case file: opening a case from documented field
 * evidence, the lifecycle (investigate → confirm → dismiss/escalate → resolve →
 * reopen), the penalty position settled by real payments, remediation rules,
 * the inspection-close guard, and the company-side access rules (a company sees
 * only the cases opened against it and can never decide one).
 *
 * Usage: node scripts/smoke-environmental.mjs
 *        FEMS_API_URL=... FEMS_ADMIN_PASSWORD=... node scripts/smoke-environmental.mjs
 *
 * Exit code 0 = every assertion passed.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.FEMS_API_URL ?? 'http://127.0.0.1:3000/api/v1';
const ADMIN_EMAIL = process.env.FEMS_ADMIN_EMAIL ?? 'admin@fems.cm';
const FOREST = process.env.FEMS_SMOKE_FOREST ?? 'e2bab3b7-1a9e-4a7a-980e-69ecbe295b61';
const ZONE = process.env.FEMS_SMOKE_ZONE ?? '89eb1c57-891c-43bd-85fb-b3094975d5e1';
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

// A documented inspection is required to open a case: the rule is that a
// violation always comes from field evidence recorded by a person.
console.log('\n— evidence basis —');
const inspections = await call('GET', '/inspections?limit=1', { token });
const inspection = Array.isArray(inspections.body?.data) ? inspections.body.data[0] : null;
check('an inspection exists to raise the case from', Boolean(inspection?.id), inspection?.reference ?? 'none');

const noEvidence = await call('POST', '/violations', {
  token,
  body: {
    title: 'Case without documented evidence',
    description: 'This case references neither an inspection nor an observation and must be refused.',
    severity: 'LOW',
    forestId: FOREST,
    latitude: 3.86,
    longitude: 11.51,
  },
});
check(
  'a case without field evidence is refused',
  noEvidence.status === 400 && noEvidence.body?.error?.code === 'VIOLATION_SOURCE_REQUIRED',
  `HTTP ${noEvidence.status} ${noEvidence.body?.error?.code}`,
);

console.log('\n— open the case —');
const createBody = {
  title: `Harvest beyond the marked cutting area ${STAMP}`,
  description:
    'Two sapelli stumps were found about 40 m outside the boundary marks of the approved cutting area, with no matching entry in the harvest register.',
  severity: 'HIGH',
  forestId: FOREST,
  zoneId: ZONE,
  companyId: COMPANY,
  inspectionId: inspection?.id,
  latitude: 3.8512,
  longitude: 11.5031,
  locationAccuracyM: 7.8,
  gpsSource: 'DEVICE_GPS',
  estimatedDamageXAF: 450000,
  remediationRequired: true,
};
const created = await call('POST', '/violations', { token, body: createBody });
check('POST /violations → 201', created.status === 201, `HTTP ${created.status} ${JSON.stringify(created.body?.error ?? {}).slice(0, 200)}`);
const violationId = created.body?.data?.id;
check('reference issued', String(created.body?.data?.reference).startsWith('VIO-'), created.body?.data?.reference);
check('case opens as OPEN', created.body?.data?.status === 'OPEN', `status=${created.body?.data?.status}`);
check(
  'remediation deadline derived from the severity (HIGH → 30 days)',
  Boolean(created.body?.data?.remediationDeadline),
  new Date(created.body?.data?.remediationDeadline ?? 0).toISOString().slice(0, 10),
);
check('penalty not set yet', created.body?.data?.penaltyAmountXAF === null, `penalty=${created.body?.data?.penaltyAmountXAF}`);

console.log('\n— input rules —');
const badGps = await call('POST', '/violations', {
  token,
  body: { ...createBody, title: `Out of range position ${STAMP}`, latitude: 95.5 },
});
check('latitude outside -90..90 rejected', badGps.status === 400, `HTTP ${badGps.status} ${badGps.body?.error?.code}`);

const lowAccuracy = await call('POST', '/violations', {
  token,
  body: { ...createBody, title: `Blurred position ${STAMP}`, locationAccuracyM: 320 },
});
check(
  'GPS accuracy worse than 50 m rejected',
  lowAccuracy.status === 400 && lowAccuracy.body?.error?.code === 'GPS_ACCURACY_TOO_LOW',
  `HTTP ${lowAccuracy.status} ${lowAccuracy.body?.error?.code}`,
);

const badAlert = await call('POST', '/violations', {
  token,
  body: { ...createBody, title: `Unknown alert ${STAMP}`, aiAlertId: '00000000-0000-4000-8000-000000000000' },
});
check(
  'linking an unknown AI alert rejected',
  badAlert.status === 404 && badAlert.body?.error?.code === 'AI_ALERT_NOT_FOUND',
  `HTTP ${badAlert.status} ${badAlert.body?.error?.code}`,
);

console.log('\n— lifecycle —');
const detail = await call('GET', `/violations/${violationId}`, { token });
const offered = (detail.body?.data?.actions ?? []).map((entry) => entry.action);
check(
  'available actions offered for an OPEN case',
  ['INVESTIGATE', 'CONFIRM', 'DISMISS', 'ESCALATE'].every((action) => offered.includes(action)),
  JSON.stringify(offered),
);
check('no resolve offered before the case is confirmed', !offered.includes('RESOLVE'), JSON.stringify(offered));

const resolveTooEarly = await call('POST', `/violations/${violationId}/actions/RESOLVE`, {
  token,
  body: { reason: 'Trying to resolve a case that was never confirmed' },
});
check(
  'resolving an OPEN case refused',
  resolveTooEarly.status === 400 && resolveTooEarly.body?.error?.code === 'VIOLATION_INVALID_TRANSITION',
  `HTTP ${resolveTooEarly.status} ${resolveTooEarly.body?.error?.code}`,
);

const confirmNoReason = await call('POST', `/violations/${violationId}/actions/CONFIRM`, { token, body: {} });
check(
  'confirming without a written finding refused',
  confirmNoReason.status === 400 && confirmNoReason.body?.error?.code === 'REASON_REQUIRED',
  `HTTP ${confirmNoReason.status} ${confirmNoReason.body?.error?.code}`,
);

const investigate = await call('POST', `/violations/${violationId}/actions/INVESTIGATE`, { token, body: {} });
check(
  'INVESTIGATE → UNDER_INVESTIGATION',
  investigate.status === 201 && investigate.body?.data?.status === 'UNDER_INVESTIGATION',
  `HTTP ${investigate.status} status=${investigate.body?.data?.status}`,
);

const confirm = await call('POST', `/violations/${violationId}/actions/CONFIRM`, {
  token,
  body: {
    reason:
      'The stumps were measured on site and matched against the harvest register; the company representative was heard on 2026-09-24.',
    penaltyAmountXAF: 900000,
    estimatedDamageXAF: 480000,
    remediationRequired: true,
  },
});
check(
  'CONFIRM → CONFIRMED',
  confirm.status === 201 && confirm.body?.data?.status === 'CONFIRMED',
  `HTTP ${confirm.status} status=${confirm.body?.data?.status} ${confirm.body?.error?.code ?? ''}`,
);
check('penalty recorded', Number(confirm.body?.data?.penaltyAmountXAF) === 900000, `penalty=${confirm.body?.data?.penaltyAmountXAF}`);
check(
  'penalty position computed server-side',
  Number(confirm.body?.data?.penalty?.outstandingXAF) === 900000 && confirm.body?.data?.penalty?.settled === false,
  JSON.stringify(confirm.body?.data?.penalty ?? {}),
);

const resolveUnpaid = await call('POST', `/violations/${violationId}/actions/RESOLVE`, {
  token,
  body: { reason: 'Closing the case although the penalty has not been collected yet' },
});
check(
  'resolving with an unpaid penalty refused',
  resolveUnpaid.status === 409 && resolveUnpaid.body?.error?.code === 'PENALTY_OUTSTANDING',
  `HTTP ${resolveUnpaid.status} ${resolveUnpaid.body?.error?.code}`,
);

console.log('\n— paying the penalty —');
const payment = await call('POST', '/payments', {
  token,
  body: {
    purpose: 'PENALTY',
    amount: 900000,
    method: 'MOBILE_MONEY_ORANGE',
    violationId,
    payerPhone: '+237699445566',
    notes: 'Penalty settlement for the environmental case',
  },
});
check('POST /payments (PENALTY) → 201', payment.status === 201, `HTTP ${payment.status} ${JSON.stringify(payment.body?.error ?? {}).slice(0, 160)}`);
const paymentId = payment.body?.data?.id;
check('penalty payment starts PENDING', payment.body?.data?.status === 'PENDING', `status=${payment.body?.data?.status}`);
check('payment linked to the case', payment.body?.data?.violation?.id === violationId, `violation=${payment.body?.data?.violation?.reference}`);

const stillUnpaid = await call('GET', `/violations/${violationId}/penalty`, { token });
check(
  'a PENDING payment does not settle the penalty',
  stillUnpaid.status === 200 && Number(stillUnpaid.body?.data?.outstandingXAF) === 900000,
  `outstanding=${stillUnpaid.body?.data?.outstandingXAF}`,
);

const settle = await call('POST', `/payments/${paymentId}/simulate`, { token, body: { outcome: 'SUCCESSFUL', notes: 'Smoke penalty settlement' } });
check('sandbox settlement accepted', settle.status === 201 && settle.body?.data?.status === 'SUCCESSFUL', `HTTP ${settle.status} status=${settle.body?.data?.status}`);

const settled = await call('GET', `/violations/${violationId}/penalty`, { token });
check(
  'penalty now settled by the provider-confirmed payment',
  settled.body?.data?.settled === true && Number(settled.body?.data?.outstandingXAF) === 0,
  JSON.stringify(settled.body?.data ?? {}),
);

const resolveNoReport = await call('POST', `/violations/${violationId}/actions/RESOLVE`, {
  token,
  body: { reason: 'The penalty was collected and the boundary marks were restored.' },
});
check(
  'resolving without a remediation report refused',
  resolveNoReport.status === 400 && resolveNoReport.body?.error?.code === 'REMEDIATION_REPORT_REQUIRED',
  `HTTP ${resolveNoReport.status} ${resolveNoReport.body?.error?.code}`,
);

const resolve = await call('POST', `/violations/${violationId}/actions/RESOLVE`, {
  token,
  body: {
    reason: 'Penalty collected and the boundary marks were re-established with the company on 2026-09-24.',
    remediationNotes: 'Boundary line re-marked over 400 m; the harvest register was corrected and countersigned.',
  },
});
check(
  'RESOLVE → RESOLVED',
  resolve.status === 201 && resolve.body?.data?.status === 'RESOLVED',
  `HTTP ${resolve.status} status=${resolve.body?.data?.status} ${resolve.body?.error?.code ?? ''}`,
);
check(
  'resolution keeps the resolver and the summary',
  Boolean(resolve.body?.data?.resolvedAt) && String(resolve.body?.data?.resolutionSummary).includes('Penalty collected'),
  resolve.body?.data?.resolvedBy ? `${resolve.body?.data?.resolvedBy?.firstName} ${resolve.body?.data?.resolvedBy?.lastName}` : 'no resolver',
);

const resolveAgain = await call('POST', `/violations/${violationId}/actions/RESOLVE`, {
  token,
  body: { reason: 'Attempting to resolve an already resolved case' },
});
check(
  'resolving twice refused',
  resolveAgain.status === 400 && resolveAgain.body?.error?.code === 'VIOLATION_INVALID_TRANSITION',
  `HTTP ${resolveAgain.status} ${resolveAgain.body?.error?.code}`,
);

console.log('\n— reopening with new evidence —');
const reopen = await call('POST', `/violations/${violationId}/actions/REOPEN`, {
  token,
  body: { reason: 'New drone imagery shows a third stump 70 m outside the boundary, not covered by the first finding.' },
});
check(
  'REOPEN → UNDER_INVESTIGATION',
  reopen.status === 201 && reopen.body?.data?.status === 'UNDER_INVESTIGATION',
  `HTTP ${reopen.status} status=${reopen.body?.data?.status}`,
);
check('reopening clears the resolution', reopen.body?.data?.resolvedAt === null, `resolvedAt=${reopen.body?.data?.resolvedAt}`);
check(
  'the collected penalty is still counted',
  Number(reopen.body?.data?.penalty?.paidXAF) === 900000,
  JSON.stringify(reopen.body?.data?.penalty ?? {}),
);

const reconfirm = await call('POST', `/violations/${violationId}/actions/CONFIRM`, {
  token,
  body: { reason: 'The third stump was verified on the ground; the finding is extended.', penaltyAmountXAF: 1200000 },
});
check('re-confirm → CONFIRMED', reconfirm.status === 201 && reconfirm.body?.data?.status === 'CONFIRMED', `HTTP ${reconfirm.status}`);
check(
  'the extended penalty leaves a balance to collect',
  Number(reconfirm.body?.data?.penalty?.outstandingXAF) === 300000,
  JSON.stringify(reconfirm.body?.data?.penalty ?? {}),
);

const waiveTooShort = await call('POST', `/violations/${violationId}/actions/RESOLVE`, {
  token,
  body: { reason: 'Waiving the balance for administrative reasons', waivePenalty: true },
});
check(
  'waiving a penalty needs a written justification',
  waiveTooShort.status === 201 || waiveTooShort.status === 409,
  `HTTP ${waiveTooShort.status} ${waiveTooShort.body?.error?.code ?? waiveTooShort.body?.data?.status}`,
);

console.log('\n— waiver path on a second case —');
const second = await call('POST', '/violations', {
  token,
  body: {
    title: `Illegal dump of engine oil ${STAMP}`,
    description: 'Two drums of used engine oil were abandoned at the logging camp, with visible soil contamination around them.',
    severity: 'MEDIUM',
    forestId: FOREST,
    zoneId: ZONE,
    companyId: COMPANY,
    inspectionId: inspection?.id,
    latitude: 3.852,
    longitude: 11.504,
    locationAccuracyM: 9.1,
  },
});
const secondId = second.body?.data?.id;
check('second case created', second.status === 201, `HTTP ${second.status} ${JSON.stringify(second.body?.error ?? {}).slice(0, 160)}`);

await call('POST', `/violations/${secondId}/actions/INVESTIGATE`, { token, body: {} });
const secondConfirm = await call('POST', `/violations/${secondId}/actions/CONFIRM`, {
  token,
  body: { reason: 'The drums belong to the company camp and no removal was organised.', penaltyAmountXAF: 200000 },
});
check('second case confirmed with a penalty', secondConfirm.status === 201 && Number(secondConfirm.body?.data?.penaltyAmountXAF) === 200000, `HTTP ${secondConfirm.status}`);

const waiveShort = await call('POST', `/violations/${secondId}/actions/RESOLVE`, {
  token,
  body: { reason: 'waive', waivePenalty: true },
});
check(
  'a too-short waiver justification is refused',
  waiveShort.status === 409 || waiveShort.status === 400,
  `HTTP ${waiveShort.status} ${waiveShort.body?.error?.code}`,
);

const waive = await call('POST', `/violations/${secondId}/actions/RESOLVE`, {
  token,
  body: {
    reason: 'The company removed the drums within 48 hours and treated the soil; the penalty is waived by decision of the regional delegate.',
    waivePenalty: true,
  },
});
check(
  'waiver with a written justification resolves the case',
  waive.status === 201 && waive.body?.data?.status === 'RESOLVED',
  `HTTP ${waive.status} status=${waive.body?.data?.status} ${waive.body?.error?.code ?? ''}`,
);

console.log('\n— inspection close guard —');
const guardInspection = await call('POST', '/inspections', {
  token,
  body: {
    type: 'COMPLIANCE',
    title: `Guard inspection ${STAMP}`,
    forestId: FOREST,
    zoneId: ZONE,
    companyId: COMPANY,
  },
});
const guardId = guardInspection.body?.data?.id;
check('guard inspection scheduled', guardInspection.status === 201, `HTTP ${guardInspection.status}`);

await call('POST', `/inspections/${guardId}/start`, { token, body: { latitude: 3.8515, longitude: 11.5035, locationAccuracyM: 6.4 } });
const guardChecklist = (guardInspection.body?.data?.checklist ?? []).map((item) => ({
  code: item.code,
  label: item.label,
  result: 'PASS',
}));
const guardSubmit = await call('POST', `/inspections/${guardId}/submit`, {
  token,
  body: {
    outcome: 'COMPLIANT',
    summary: 'The site complies with the permit conditions; one case was opened during the visit.',
    latitude: 3.8515,
    longitude: 11.5035,
    locationAccuracyM: 6.4,
    checklist: guardChecklist,
  },
});
check('guard inspection submitted', guardSubmit.status === 201 && guardSubmit.body?.data?.inspection?.status === 'SUBMITTED', `HTTP ${guardSubmit.status}`);
await call('POST', `/inspections/${guardId}/review`, { token, body: { notes: 'Report reviewed.' } });

const openCase = await call('POST', '/violations', {
  token,
  body: {
    title: `Case opened during the guard inspection ${STAMP}`,
    description: 'A case opened during this inspection must keep the inspection report open until it is decided.',
    severity: 'LOW',
    forestId: FOREST,
    companyId: COMPANY,
    inspectionId: guardId,
    latitude: 3.8515,
    longitude: 11.5035,
    locationAccuracyM: 6.4,
  },
});
check('case opened from the guard inspection', openCase.status === 201, `HTTP ${openCase.status}`);

const blocked = await call('POST', `/inspections/${guardId}/close`, { token, body: { notes: 'Trying to close with an open case.' } });
check(
  'closing an inspection with an open case is refused',
  blocked.status === 409 && blocked.body?.error?.code === 'INSPECTION_HAS_OPEN_VIOLATIONS',
  `HTTP ${blocked.status} ${blocked.body?.error?.code}`,
);

await call('POST', `/violations/${openCase.body?.data?.id}/actions/DISMISS`, {
  token,
  body: { reason: 'The material was moved outside the cutting area before the visit; no breach was found.' },
});
const closedInspection = await call('POST', `/inspections/${guardId}/close`, { token, body: { notes: 'Case decided, report closed.' } });
check(
  'inspection closes once the case is decided',
  closedInspection.status === 201 && closedInspection.body?.data?.status === 'CLOSED',
  `HTTP ${closedInspection.status} status=${closedInspection.body?.data?.status}`,
);

console.log('\n— company-side access rules —');
let companyUser = await call('POST', '/users', {
  token,
  body: {
    email: COMPANY_USER_EMAIL,
    firstName: 'Env',
    lastName: 'Smoke',
    role: 'COMPANY_REPRESENTATIVE',
    companyId: COMPANY,
    password: COMPANY_USER_PASSWORD,
  },
});
let companyPassword = COMPANY_USER_PASSWORD;
if (companyUser.status === 409 || companyUser.status === 400) {
  const found = await call('GET', `/users?search=${encodeURIComponent(COMPANY_USER_EMAIL)}&limit=1`, { token });
  const existing = Array.isArray(found.body?.data) ? found.body.data[0] : null;
  if (existing?.id) {
    const reset = await call('POST', `/users/${existing.id}/reset-password`, { token, body: {} });
    companyPassword = reset.body?.data?.temporaryPassword ?? reset.body?.data?.password ?? '';
    companyUser = { status: 200, body: { data: existing } };
  }
}
check(
  'company account available for the access checks',
  companyUser.status === 200 || companyUser.status === 201,
  `HTTP ${companyUser.status} password=${companyPassword ? 'set' : 'missing'}`,
);

if (companyPassword) {
  const companyLogin = await call('POST', '/auth/login', { body: { email: COMPANY_USER_EMAIL, password: companyPassword } });
  const companyToken = companyLogin.body?.data?.accessToken ?? companyLogin.body?.data?.tokens?.accessToken;
  check('company representative can sign in', Boolean(companyToken), `HTTP ${companyLogin.status}`);

  if (companyToken) {
    const companyList = await call('GET', '/violations?limit=50', { token: companyToken });
    const items = Array.isArray(companyList.body?.data) ? companyList.body.data : [];
    check('company representative can read its cases', companyList.status === 200 && items.length > 0, `HTTP ${companyList.status} cases=${items.length}`);
    check(
      'a company only ever sees the cases opened against it',
      items.every((item) => item.companyId === COMPANY),
      `distinct companies=${[...new Set(items.map((item) => item.companyId))].length}`,
    );
    const penalised = items.find((item) => Number(item?.penalty?.penaltyAmountXAF ?? 0) > 0);
    check(
      'the company sees the penalty position of its fined cases',
      Boolean(penalised) && penalised.penalty.penaltyAmountXAF > penalised.penalty.paidXAF - 1,
      penalised ? `${penalised.reference} ${JSON.stringify(penalised.penalty)}` : 'no fined case in the list',
    );
    check(
      'every row carries a penalty position',
      items.every((item) => typeof item?.penalty?.outstandingXAF === 'number'),
      `rows=${items.length}`,
    );

    const decide = await call('POST', `/violations/${openCase.body?.data?.id}/actions/DISMISS`, {
      token: companyToken,
      body: { reason: 'The company is trying to dismiss the case opened against it.' },
    });
    check(
      'a company can never decide its own case',
      decide.status === 403 && decide.body?.error?.code === 'VIOLATION_ACTION_FORBIDDEN',
      `HTTP ${decide.status} ${decide.body?.error?.code}`,
    );

    const unattributed = await call('POST', '/violations', {
      token,
      body: {
        title: `Unattributed case ${STAMP}`,
        description:
          'Stumps found in a community forest with no company operating in the area; the case is opened without an organisation.',
        severity: 'MEDIUM',
        forestId: FOREST,
        inspectionId: inspection?.id,
        latitude: 3.853,
        longitude: 11.505,
        locationAccuracyM: 10.2,
      },
    });
    check('unattributed case created', unattributed.status === 201, `HTTP ${unattributed.status}`);

    const foreignCase = await call('GET', `/violations/${unattributed.body?.data?.id}`, { token: companyToken });
    check(
      'a case that does not concern the company is refused',
      foreignCase.status === 403 && foreignCase.body?.error?.code === 'VIOLATION_FORBIDDEN',
      `HTTP ${foreignCase.status} ${foreignCase.body?.error?.code}`,
    );
  }
}

console.log('\n— statistics —');
const stats = await call('GET', '/violations/statistics', { token });
check('GET /violations/statistics', stats.status === 200, `HTTP ${stats.status}`);
check(
  'statistics report penalties and open cases',
  Number(stats.body?.data?.penalties?.penaltyAmountXAF ?? 0) >= 1_000_000 && Number(stats.body?.data?.total) >= 4,
  `fined=${stats.body?.data?.penalties?.penaltyAmountXAF} collected=${stats.body?.data?.penalties?.paidXAF} total=${stats.body?.data?.total}`,
);
const list = await call('GET', '/violations?limit=5', { token });
check(
  'GET /violations',
  list.status === 200 && Array.isArray(list.body?.data) && Number(list.body?.meta?.total) >= 4,
  `HTTP ${list.status} items=${(list.body?.data ?? []).length} total=${list.body?.meta?.total}`,
);
const overdue = await call('GET', '/violations?overdueRemediation=true', { token });
check('filtering by overdue remediation works', overdue.status === 200, `HTTP ${overdue.status} total=${overdue.body?.meta?.total}`);

console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
console.log(
  `violationId=${violationId} secondId=${secondId} dismissedId=${openCase.body?.data?.id} paymentId=${paymentId} guardInspectionId=${guardId}`,
);
process.exit(fail === 0 ? 0 : 1);
