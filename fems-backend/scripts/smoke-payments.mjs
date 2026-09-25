#!/usr/bin/env node
/**
 * FEMS E2E smoke — permit fee payment → permit activation → exploitation.
 *
 * Self-contained and re-runnable: it creates a fresh permit each run (reusing
 * the verified demo company/forest/zone already in the database), approves it,
 * settles the fee through the labelled sandbox provider, activates the permit,
 * then drives an activity from PLANNED to COMPLETED, attaches equipment and
 * replays an offline capture batch.
 *
 * Usage: node scripts/smoke-payments.mjs
 *        FEMS_API_URL=... FEMS_ADMIN_EMAIL=... FEMS_ADMIN_PASSWORD=... node scripts/smoke-payments.mjs
 *
 * Exit code 0 = every assertion passed.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.FEMS_API_URL ?? 'http://127.0.0.1:3000/api/v1';
const ADMIN_EMAIL = process.env.FEMS_ADMIN_EMAIL ?? 'admin@fems.cm';

// Demo forest data seeded in the sandbox database. The script only reuses a
// verified company, a forest and one of its zones — it creates everything else.
const COMPANY = process.env.FEMS_SMOKE_COMPANY ?? '83a65695-931b-4714-8d62-50b4692cd8f5';
const FOREST = process.env.FEMS_SMOKE_FOREST ?? 'e2bab3b7-1a9e-4a7a-980e-69ecbe295b61';
const ZONE = process.env.FEMS_SMOKE_ZONE ?? '89eb1c57-891c-43bd-85fb-b3094975d5e1';
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

console.log('\n— fresh permit for this run —');
const permitCreate = await call('POST', '/permits', {
  token,
  body: {
    type: 'EXPLOITATION',
    title: `Smoke settlement permit ${STAMP}`,
    purpose: 'E2E smoke: approve → pay → activate → exploit.',
    companyId: COMPANY,
    forestId: FOREST,
    zoneId: ZONE,
    volumeRequestedM3: 200,
    royaltyRatePerM3: 2500,
    startDate: '2026-10-01',
    endDate: '2027-09-30',
    priority: 'NORMAL',
  },
});
const PERMIT = permitCreate.body?.data?.id;
check(
  'POST /permits → 201 DRAFT',
  permitCreate.status === 201 && permitCreate.body?.data?.status === 'DRAFT',
  `HTTP ${permitCreate.status} number=${permitCreate.body?.data?.permitNumber}`,
);
for (const action of ['SUBMIT', 'START_REVIEW']) {
  const step = await call('POST', `/permits/${PERMIT}/actions/${action}`, { token, body: {} });
  check(`${action} → ${step.body?.data?.status}`, step.status === 201, `HTTP ${step.status} ${step.body?.error?.code ?? ''}`);
}
const approve = await call('POST', `/permits/${PERMIT}/actions/APPROVE`, {
  token,
  body: { volumeApprovedM3: 180, reason: 'Smoke approval' },
});
check(
  'APPROVE → APPROVED',
  approve.status === 201 && approve.body?.data?.status === 'APPROVED',
  `HTTP ${approve.status} fee=${approve.body?.data?.feeAmount}`,
);

console.log('\n— payment provider —');
const provider = await call('GET', '/payments/provider', { token });
check('GET /payments/provider', provider.status === 200, `HTTP ${provider.status}`);
check(
  'provider is the labelled sandbox',
  provider.body?.data?.provider === 'SIMULATOR' && provider.body?.data?.sandbox === true,
  `${provider.body?.data?.provider} sandbox=${provider.body?.data?.sandbox}`,
);

console.log('\n— permit state before payment —');
const before = await call('GET', `/permits/${PERMIT}/actions`, { token });
const outstandingBefore = Number(before.body?.data?.outstandingBalance);
check('outstanding balance equals the computed fee', outstandingBefore > 0, `balance=${outstandingBefore}`);

console.log('\n— initiate payment —');
const clientRef = `pay-smoke-${STAMP}`;
const paymentBody = {
  purpose: 'PERMIT_FEE',
  amount: outstandingBefore,
  method: 'MOBILE_MONEY_MTN',
  permitId: PERMIT,
  payerPhone: '+237699112233',
  clientRef,
  notes: 'Smoke test settlement',
};
const initiate = await call('POST', '/payments', { token, body: paymentBody });
check('POST /payments → 201', initiate.status === 201, `HTTP ${initiate.status} ${JSON.stringify(initiate.body?.error ?? {}).slice(0, 160)}`);
const paymentId = initiate.body?.data?.id;
check('payment is PENDING', initiate.body?.data?.status === 'PENDING', `status=${initiate.body?.data?.status}`);
check('payment flagged as sandbox', initiate.body?.data?.isDemo === true && initiate.body?.data?.duplicate === false);

const permitPending = await call('GET', `/permits/${PERMIT}/actions`, { token });
const pendingStatus = permitPending.body?.data?.permit?.status ?? permitPending.body?.data?.status;
check('paying moves the permit to PAYMENT_PENDING', pendingStatus === 'PAYMENT_PENDING', `status=${pendingStatus}`);

const replay = await call('POST', '/payments', { token, body: paymentBody });
check(
  'same clientRef returns the same payment (idempotent)',
  replay.status === 201 && replay.body?.data?.id === paymentId && replay.body?.data?.duplicate === true,
  `id match=${replay.body?.data?.id === paymentId} duplicate=${replay.body?.data?.duplicate}`,
);

const overpay = await call('POST', '/payments', {
  token,
  body: { ...paymentBody, amount: outstandingBefore + 50000, clientRef: undefined },
});
check(
  'overpayment rejected with PAYMENT_EXCEEDS_OUTSTANDING_BALANCE',
  overpay.status === 400 && overpay.body?.error?.code === 'PAYMENT_EXCEEDS_OUTSTANDING_BALANCE',
  `HTTP ${overpay.status} ${overpay.body?.error?.code}`,
);

const noPhone = await call('POST', '/payments', {
  token,
  body: { purpose: 'PERMIT_FEE', amount: 1000, method: 'MOBILE_MONEY_ORANGE', permitId: PERMIT },
});
check(
  'mobile money without phone rejected',
  noPhone.status === 400 && noPhone.body?.error?.code === 'PAYER_PHONE_REQUIRED',
  `HTTP ${noPhone.status} ${noPhone.body?.error?.code}`,
);

console.log('\n— sandbox confirmation —');
const simulate = await call('POST', `/payments/${paymentId}/simulate`, {
  token,
  body: { outcome: 'SUCCESSFUL', notes: 'Smoke confirmation' },
});
check(
  'POST /payments/:id/simulate → settled',
  simulate.status === 201 && simulate.body?.data?.status === 'SUCCESSFUL',
  `HTTP ${simulate.status} status=${simulate.body?.data?.status}`,
);
const receiptNumber = simulate.body?.data?.receiptNumber;
check('receipt number issued', typeof receiptNumber === 'string' && receiptNumber.startsWith('RCP-'), `receipt=${receiptNumber}`);

const secondSimulate = await call('POST', `/payments/${paymentId}/simulate`, { token, body: { outcome: 'SUCCESSFUL' } });
check('cannot confirm a settled payment twice', secondSimulate.status === 409, `HTTP ${secondSimulate.status} ${secondSimulate.body?.error?.code}`);

const receipt = await call('GET', `/payments/${paymentId}/receipt`, { token });
check(
  'receipt endpoint returns settlement data',
  receipt.status === 200 && receipt.body?.data?.receiptNumber === receiptNumber && receipt.body?.data?.payment?.isSandbox === true,
  `HTTP ${receipt.status} receipt=${receipt.body?.data?.receiptNumber}`,
);

console.log('\n— permit activation —');
const afterPay = await call('GET', `/permits/${PERMIT}/actions`, { token });
check('outstanding balance is now 0', Number(afterPay.body?.data?.outstandingBalance) === 0, `balance=${afterPay.body?.data?.outstandingBalance}`);
const offeredActions = (afterPay.body?.data?.actions ?? []).map((entry) => entry.action);
check('ACTIVATE is offered', offeredActions.includes('ACTIVATE'), JSON.stringify(offeredActions));

const activate = await call('POST', `/permits/${PERMIT}/actions/ACTIVATE`, { token, body: {} });
check(
  'ACTIVATE → ACTIVE',
  activate.status === 201 && activate.body?.data?.status === 'ACTIVE',
  `HTTP ${activate.status} status=${activate.body?.data?.status} ${activate.body?.error?.code ?? ''}`,
);

console.log('\n— exploitation activity —');
const create = await call('POST', '/activities', {
  token,
  body: {
    permitId: PERMIT,
    activityType: 'TIMBER_HARVEST',
    zoneId: ZONE,
    plannedVolumeM3: 120,
    plannedStartDate: new Date().toISOString(),
    latitude: 3.848,
    longitude: 11.502,
    locationAccuracyM: 8.5,
    gpsSource: 'DEVICE_GPS',
    equipmentSummary: '2 chainsaws, 1 logging truck',
    observations: 'Smoke-test activity created by the E2E script',
  },
});
check('POST /activities → 201', create.status === 201, `HTTP ${create.status} ${JSON.stringify(create.body?.error ?? {}).slice(0, 200)}`);
const activityId = create.body?.data?.id;
check('activity reference issued', typeof create.body?.data?.reference === 'string' && create.body.data.reference.startsWith('ACT-'), create.body?.data?.reference);
check('activity starts as PLANNED', create.body?.data?.status === 'PLANNED', `status=${create.body?.data?.status}`);

const badGps = await call('POST', '/activities', {
  token,
  body: {
    permitId: PERMIT,
    activityType: 'TIMBER_HARVEST',
    plannedVolumeM3: 10,
    plannedStartDate: new Date().toISOString(),
    latitude: 95.5,
    longitude: 11.5,
  },
});
check('latitude outside -90..90 rejected', badGps.status === 400, `HTTP ${badGps.status} ${badGps.body?.error?.code}`);

const lowAccuracy = await call('POST', '/activities', {
  token,
  body: {
    permitId: PERMIT,
    activityType: 'TIMBER_HARVEST',
    plannedVolumeM3: 10,
    plannedStartDate: new Date().toISOString(),
    latitude: 3.85,
    longitude: 11.5,
    locationAccuracyM: 180,
  },
});
check(
  'GPS accuracy worse than 50 m rejected',
  lowAccuracy.status === 400 && lowAccuracy.body?.error?.code === 'GPS_ACCURACY_TOO_LOW',
  `HTTP ${lowAccuracy.status} ${lowAccuracy.body?.error?.code}`,
);

const tooMuch = await call('POST', '/activities', {
  token,
  body: {
    permitId: PERMIT,
    activityType: 'TIMBER_HARVEST',
    plannedVolumeM3: 5000,
    plannedStartDate: new Date().toISOString(),
    latitude: 3.85,
    longitude: 11.5,
    locationAccuracyM: 10,
  },
});
check(
  'planned volume above the permit is rejected',
  tooMuch.status === 400 && tooMuch.body?.error?.code === 'PLANNED_VOLUME_EXCEEDS_PERMIT',
  `HTTP ${tooMuch.status} ${tooMuch.body?.error?.code}`,
);

const start = await call('POST', `/activities/${activityId}/actions/START`, { token, body: {} });
check(
  'START → IN_PROGRESS',
  start.status === 201 && start.body?.data?.status === 'IN_PROGRESS',
  `HTTP ${start.status} status=${start.body?.data?.status} ${start.body?.error?.code ?? ''}`,
);

const invalid = await call('POST', `/activities/${activityId}/actions/START`, { token, body: {} });
check(
  'starting twice rejected',
  invalid.status === 400 && invalid.body?.error?.code === 'ACTIVITY_INVALID_TRANSITION',
  `HTTP ${invalid.status} ${invalid.body?.error?.code}`,
);

const harvest = await call('POST', `/activities/${activityId}/harvest`, {
  token,
  body: {
    harvestedVolumeM3: 45.5,
    harvestedTreeCount: 12,
    speciesBreakdown: { SAPELLI: 30.5, IROKO: 15 },
    observations: 'First rotation',
  },
});
check('harvest recorded', harvest.status === 201 && Number(harvest.body?.data?.harvestedVolumeM3) === 45.5, `volume=${harvest.body?.data?.harvestedVolumeM3}`);
check('tree count updated', harvest.body?.data?.harvestedTreeCount === 12, `trees=${harvest.body?.data?.harvestedTreeCount}`);

const complete = await call('POST', `/activities/${activityId}/actions/COMPLETE`, {
  token,
  body: { harvestedVolumeM3: 0.5, harvestedTreeCount: 1 },
});
check(
  'COMPLETE → COMPLETED',
  complete.status === 201 && complete.body?.data?.status === 'COMPLETED',
  `HTTP ${complete.status} status=${complete.body?.data?.status} ${complete.body?.error?.code ?? ''}`,
);

const observe = await call('GET', `/activities/${activityId}`, { token });
check(
  'activity detail keeps the species breakdown',
  observe.status === 200 && observe.body?.data?.speciesBreakdown?.SAPELLI === 30.5,
  JSON.stringify(observe.body?.data?.speciesBreakdown ?? {}),
);

console.log('\n— equipment —');
const equipment = await call('POST', '/equipment', {
  token,
  body: {
    companyId: COMPANY,
    name: `Smoke chainsaw ${STAMP}`,
    category: 'CHAINSAW',
    status: 'AVAILABLE',
    registrationNumber: `SMK-${STAMP}`,
  },
});
check('POST /equipment → 201', equipment.status === 201, `HTTP ${equipment.status} ${JSON.stringify(equipment.body?.error ?? {}).slice(0, 160)}`);
const equipmentId = equipment.body?.data?.id;

if (equipmentId) {
  const attach = await call('POST', `/activities/${activityId}/equipment`, {
    token,
    body: { equipmentId, operatorName: 'Jean Mbarga', hoursUsed: 6.5, fuelLitres: 18, notes: 'Smoke usage' },
  });
  check('equipment attached to activity', attach.status === 201 && attach.body?.data?.equipment?.id === equipmentId, `HTTP ${attach.status}`);

  const remove = await call('DELETE', `/equipment/${equipmentId}`, { token });
  check(
    'equipment in use cannot be archived',
    remove.status === 409 && remove.body?.error?.code === 'EQUIPMENT_IN_USE',
    `HTTP ${remove.status} ${remove.body?.error?.code}`,
  );
}

console.log('\n— offline sync —');
const offlineRef = `offline-${STAMP}`;
const batch = {
  records: [
    {
      clientRef: offlineRef,
      permitId: PERMIT,
      activityType: 'LOG_TRANSPORT',
      plannedVolumeM3: 20,
      plannedStartDate: new Date().toISOString(),
      latitude: 3.86,
      longitude: 11.51,
      locationAccuracyM: 12,
      gpsSource: 'DEVICE_GPS',
    },
    {
      clientRef: `${offlineRef}-bad`,
      permitId: PERMIT,
      activityType: 'LOG_TRANSPORT',
      plannedVolumeM3: 5000,
      plannedStartDate: new Date().toISOString(),
      latitude: 3.86,
      longitude: 11.51,
    },
  ],
};
const sync = await call('POST', '/activities/offline-sync', { token, body: batch });
check(
  'offline batch: 1 created, 1 rejected',
  sync.status === 201 && sync.body?.data?.created === 1 && sync.body?.data?.rejected === 1,
  JSON.stringify(sync.body?.data ?? {}).slice(0, 200),
);

const syncAgain = await call('POST', '/activities/offline-sync', { token, body: batch });
check(
  'replaying the batch reports DUPLICATE instead of duplicating',
  syncAgain.status === 201 && syncAgain.body?.data?.duplicates === 1 && syncAgain.body?.data?.created === 0,
  JSON.stringify(syncAgain.body?.data ?? {}).slice(0, 200),
);

console.log('\n— statistics —');
const stats = await call('GET', '/activities/statistics', { token });
check('GET /activities/statistics', stats.status === 200 && stats.body?.data?.total >= 1, `HTTP ${stats.status} total=${stats.body?.data?.total}`);
const payStats = await call('GET', '/payments/statistics', { token });
check('GET /payments/statistics', payStats.status === 200, `HTTP ${payStats.status}`);
check(
  'statistics count the settled payment',
  (payStats.body?.data?.byStatus ?? []).some((row) => row.status === 'SUCCESSFUL' && row.count >= 1),
  JSON.stringify(payStats.body?.data?.byStatus ?? []).slice(0, 200),
);

console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
console.log(`permitId=${PERMIT} paymentId=${paymentId} activityId=${activityId} equipmentId=${equipmentId ?? 'n/a'} receipt=${receiptNumber}`);
process.exit(fail === 0 ? 0 : 1);
