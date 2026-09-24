#!/usr/bin/env node
/**
 * FEMS E2E smoke — inspections, field observations and evidence.
 *
 * Self-contained and re-runnable: schedules an inspection, runs the field steps
 * with real GPS rules (accuracy, invalid coordinates, distance to the inspected
 * activity), submits and reviews the report, then exercises observations
 * (including an offline replay) and evidence attachment.
 *
 * Usage: node scripts/smoke-inspections.mjs
 *        FEMS_API_URL=... FEMS_ADMIN_PASSWORD=... node scripts/smoke-inspections.mjs
 *
 * Exit code 0 = every assertion passed.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.FEMS_API_URL ?? 'http://127.0.0.1:3000/api/v1';
const ADMIN_EMAIL = process.env.FEMS_ADMIN_EMAIL ?? 'admin@fems.cm';
const FOREST = process.env.FEMS_SMOKE_FOREST ?? 'e2bab3b7-1a9e-4a7a-980e-69ecbe295b61';
const ZONE = process.env.FEMS_SMOKE_ZONE ?? '89eb1c57-891c-43bd-85fb-b3094975d5e1';
const COMPANY = process.env.FEMS_SMOKE_COMPANY ?? '83a65695-931b-4714-8d62-50b4692cd8f5';
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

async function call(method, path, { token, body, form } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(form ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
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

// An activity to inspect gives us a real target position for the distance rule.
const activities = await call('GET', '/activities?limit=1', { token });
const activity = Array.isArray(activities.body?.data) ? activities.body.data[0] ?? null : null;
if (activity) console.log(`\nInspecting activity ${activity.reference} at ${activity.latitude}, ${activity.longitude}`);

console.log('\n— schedule the inspection —');
const create = await call('POST', '/inspections', {
  token,
  body: {
    type: 'ROUTINE',
    title: `Smoke routine inspection ${STAMP}`,
    forestId: FOREST,
    zoneId: ZONE,
    companyId: COMPANY,
    activityId: activity?.id,
    scheduledFor: new Date(Date.now() + 3600_000).toISOString(),
  },
});
const inspectionId = create.body?.data?.id;
check('POST /inspections → 201', create.status === 201, `HTTP ${create.status} ${JSON.stringify(create.body?.error ?? {}).slice(0, 160)}`);
check('reference issued', String(create.body?.data?.reference).startsWith('INS-'), create.body?.data?.reference);
check('status is SCHEDULED', create.body?.data?.status === 'SCHEDULED', `status=${create.body?.data?.status}`);
check(
  'checklist template applied',
  (create.body?.data?.checklist ?? []).length >= 4,
  `${(create.body?.data?.checklist ?? []).length} items`,
);

console.log('\n— field rules —');
const earlySubmit = await call('POST', `/inspections/${inspectionId}/submit`, {
  token,
  body: { outcome: 'COMPLIANT', latitude: 3.848, longitude: 11.502, locationAccuracyM: 8 },
});
check(
  'cannot submit before starting the field work',
  earlySubmit.status === 400 && earlySubmit.body?.error?.code === 'INSPECTION_INVALID_TRANSITION',
  `HTTP ${earlySubmit.status} ${earlySubmit.body?.error?.code}`,
);

const badLatitude = await call('POST', `/inspections/${inspectionId}/start`, {
  token,
  body: { latitude: 95.5, longitude: 11.5, locationAccuracyM: 5 },
});
check('latitude outside -90..90 rejected', badLatitude.status === 400, `HTTP ${badLatitude.status} ${badLatitude.body?.error?.code}`);

const lowAccuracy = await call('POST', `/inspections/${inspectionId}/start`, {
  token,
  body: { latitude: 3.848, longitude: 11.502, locationAccuracyM: 240 },
});
check(
  'GPS accuracy worse than 50 m rejected',
  lowAccuracy.status === 400 && lowAccuracy.body?.error?.code === 'GPS_ACCURACY_TOO_LOW',
  `HTTP ${lowAccuracy.status} ${lowAccuracy.body?.error?.code}`,
);

// ~2.2 km north of the inspected activity: accepted, but flagged.
const startPosition = activity ? { latitude: Number(activity.latitude) + 0.02, longitude: Number(activity.longitude) } : { latitude: 3.868, longitude: 11.502 };
const start = await call('POST', `/inspections/${inspectionId}/start`, {
  token,
  body: { ...startPosition, locationAccuracyM: 9.5, gpsSource: 'DEVICE_GPS' },
});
check('POST /inspections/:id/start → 201', start.status === 201, `HTTP ${start.status} ${JSON.stringify(start.body?.error ?? {}).slice(0, 160)}`);
check('status is IN_PROGRESS', start.body?.data?.inspection?.status === 'IN_PROGRESS', `status=${start.body?.data?.inspection?.status}`);
if (activity) {
  const distance = Number(start.body?.data?.inspection?.distanceFromTargetM ?? 0);
  check('distance to the inspected activity is measured', distance > 1500 && distance < 3000, `${distance} m`);
  check('off-site position is reported as a warning', Boolean(start.body?.data?.gpsWarning), String(start.body?.data?.gpsWarning).slice(0, 90));
}

console.log('\n— submit the report —');
const conflict = await call('POST', `/inspections/${inspectionId}/submit`, {
  token,
  body: {
    outcome: 'COMPLIANT',
    latitude: startPosition.latitude,
    longitude: startPosition.longitude,
    locationAccuracyM: 9.5,
    checklist: [{ code: 'ROU-01', label: 'Permit displayed and valid on site', result: 'FAIL', notes: 'Permit not on site' }],
  },
});
check(
  'COMPLIANT outcome with a failed item rejected',
  conflict.status === 400 && conflict.body?.error?.code === 'INSPECTION_OUTCOME_CONFLICT',
  `HTTP ${conflict.status} ${conflict.body?.error?.code}`,
);

const clientRef = `insp-smoke-${STAMP}`;
const submitBody = {
  outcome: 'MINOR_NON_COMPLIANCE',
  summary: 'Permit was produced only after a phone call to the company office; the rest of the site is in order.',
  recommendations: 'Keep a laminated copy of the permit at the base camp.',
  latitude: startPosition.latitude,
  longitude: startPosition.longitude,
  locationAccuracyM: 9.5,
  verifiedHarvestedVolumeM3: 42.5,
  verifiedTreeCount: 11,
  discrepancies: 'Harvest register shows 43.0 m³ against 42.5 m³ measured on site.',
  clientRef,
  checklist: [
    { code: 'ROU-01', label: 'Permit displayed and valid on site', result: 'FAIL', notes: 'Shown 20 minutes after arrival' },
    { code: 'ROU-02', label: 'Boundary marks of the cutting area respected', result: 'PASS' },
    { code: 'ROU-03', label: 'Harvest volumes match the activity register', result: 'PASS' },
    { code: 'ROU-04', label: 'Felled trees marked and recorded', result: 'PASS' },
    { code: 'ROU-05', label: 'Access road and drainages maintained', result: 'NOT_APPLICABLE' },
  ],
};
const submit = await call('POST', `/inspections/${inspectionId}/submit`, { token, body: submitBody });
check('POST /inspections/:id/submit → 201', submit.status === 201, `HTTP ${submit.status} ${JSON.stringify(submit.body?.error ?? {}).slice(0, 200)}`);
check('status is SUBMITTED', submit.body?.data?.inspection?.status === 'SUBMITTED', `status=${submit.body?.data?.inspection?.status}`);
check('compliance score computed server-side', submit.body?.data?.inspection?.complianceScore === 75, `score=${submit.body?.data?.inspection?.complianceScore}`);

const replay = await call('POST', `/inspections/${inspectionId}/submit`, { token, body: submitBody });
check(
  'replaying the same clientRef returns the stored report',
  replay.status === 201 && replay.body?.data?.duplicate === true,
  `HTTP ${replay.status} duplicate=${replay.body?.data?.duplicate}`,
);

const resubmit = await call('POST', `/inspections/${inspectionId}/submit`, {
  token,
  body: { ...submitBody, clientRef: `${clientRef}-other` },
});
check(
  'a second submission is refused',
  resubmit.status === 400 && resubmit.body?.error?.code === 'INSPECTION_INVALID_TRANSITION',
  `HTTP ${resubmit.status} ${resubmit.body?.error?.code}`,
);

console.log('\n— review and close —');
const review = await call('POST', `/inspections/${inspectionId}/review`, {
  token,
  body: { notes: 'Report reviewed; the recommendation is passed to the company.' },
});
check('POST /inspections/:id/review → 201', review.status === 201 && review.body?.data?.status === 'REVIEWED', `HTTP ${review.status} status=${review.body?.data?.status}`);

const close = await call('POST', `/inspections/${inspectionId}/close`, { token, body: { notes: 'Closed after the field report was validated.' } });
check('POST /inspections/:id/close → 201', close.status === 201 && close.body?.data?.status === 'CLOSED', `HTTP ${close.status} status=${close.body?.data?.status}`);

const cancel = await call('POST', `/inspections/${inspectionId}/cancel`, { token, body: { reason: 'Attempting to cancel a closed inspection' } });
check(
  'a closed inspection cannot be cancelled',
  cancel.status === 400 && cancel.body?.error?.code === 'INSPECTION_INVALID_TRANSITION',
  `HTTP ${cancel.status} ${cancel.body?.error?.code}`,
);

console.log('\n— second inspection: cancel flow —');
const second = await call('POST', '/inspections', {
  token,
  body: { type: 'ENVIRONMENTAL', title: `Smoke environmental inspection ${STAMP}`, forestId: FOREST, zoneId: ZONE },
});
const secondId = second.body?.data?.id;
const cancelMissingReason = await call('POST', `/inspections/${secondId}/cancel`, { token, body: {} });
check(
  'cancel without reason rejected',
  cancelMissingReason.status === 400 && cancelMissingReason.body?.error?.code === 'REASON_REQUIRED',
  `HTTP ${cancelMissingReason.status} ${cancelMissingReason.body?.error?.code}`,
);
const cancelOk = await call('POST', `/inspections/${secondId}/cancel`, { token, body: { reason: 'Access road flooded after heavy rain' } });
check('cancel with reason → CANCELLED', cancelOk.status === 201 && cancelOk.body?.data?.status === 'CANCELLED', `HTTP ${cancelOk.status} status=${cancelOk.body?.data?.status}`);

console.log('\n— evidence —');
const uploadForm = new FormData();
uploadForm.append('file', new Blob([`FEMS smoke evidence ${STAMP}`], { type: 'image/jpeg' }), 'smoke-evidence.jpg');
const upload = await call('POST', '/files/upload?folder=inspections/evidence', { token, form: uploadForm });
check('POST /files/upload → 201', upload.status === 201, `HTTP ${upload.status} ${JSON.stringify(upload.body?.error ?? {}).slice(0, 160)}`);
const fileKey = upload.body?.data?.key ?? upload.body?.data?.fileKey;

if (fileKey) {
  const evidence = await call('POST', '/inspections/evidence', {
    token,
    body: {
      type: 'PHOTO',
      source: 'DEVICE_CAMERA',
      fileKey,
      mimeType: 'image/jpeg',
      sizeBytes: 24,
      caption: 'Boundary mark at the north-west corner',
      inspectionId,
      latitude: startPosition.latitude,
      longitude: startPosition.longitude,
      locationAccuracyM: 9.5,
    },
  });
  check('POST /inspections/evidence → 201', evidence.status === 201, `HTTP ${evidence.status} ${JSON.stringify(evidence.body?.error ?? {}).slice(0, 200)}`);
  check(
    'evidence download URL derived server-side',
    String(evidence.body?.data?.fileUrl ?? '').includes('/files/download?key='),
    evidence.body?.data?.fileUrl,
  );

  const missingFile = await call('POST', '/inspections/evidence', {
    token,
    body: { type: 'PHOTO', fileKey: 'evidence/2026/does-not-exist.jpg', mimeType: 'image/jpeg', sizeBytes: 10, inspectionId },
  });
  check(
    'evidence for a non-existent file rejected',
    missingFile.status === 404 && missingFile.body?.error?.code === 'FILE_NOT_FOUND',
    `HTTP ${missingFile.status} ${missingFile.body?.error?.code}`,
  );

  const list = await call('GET', `/inspections/evidence?inspectionId=${inspectionId}`, { token });
  check('GET /inspections/evidence lists the file', list.status === 200 && (list.body?.data ?? []).length >= 1, `HTTP ${list.status} count=${(list.body?.data ?? []).length}`);
}

console.log('\n— observations —');
const observationBody = {
  category: 'ILLEGAL_LOGGING',
  title: `Smoke observation — fresh stumps ${STAMP}`,
  description: 'Two freshly cut sapelli stumps about 40 m beyond the boundary marks, no felling licence number.',
  forestId: FOREST,
  zoneId: ZONE,
  activityId: activity?.id,
  severity: 'HIGH',
  latitude: Number(startPosition.latitude) + 0.001,
  longitude: Number(startPosition.longitude) + 0.001,
  locationAccuracyM: 11.2,
  clientRef: `obs-smoke-${STAMP}`,
};
const observation = await call('POST', '/observations', { token, body: observationBody });
check('POST /observations → 201', observation.status === 201, `HTTP ${observation.status} ${JSON.stringify(observation.body?.error ?? {}).slice(0, 200)}`);
check('severity stored', observation.body?.data?.severity === 'HIGH', `severity=${observation.body?.data?.severity}`);
check('observation kept as recorded (no accusation)', observation.body?.data?.violations?.length === 0, 'no violation opened automatically');

const duplicateObservation = await call('POST', '/observations', { token, body: observationBody });
check(
  'same clientRef returns the stored observation',
  duplicateObservation.status === 201 && duplicateObservation.body?.data?.duplicate === true,
  `duplicate=${duplicateObservation.body?.data?.duplicate}`,
);

const badAccuracy = await call('POST', '/observations', {
  token,
  body: { ...observationBody, clientRef: undefined, locationAccuracyM: 300 },
});
check(
  'observation with poor GPS accuracy rejected',
  badAccuracy.status === 400 && badAccuracy.body?.error?.code === 'GPS_ACCURACY_TOO_LOW',
  `HTTP ${badAccuracy.status} ${badAccuracy.body?.error?.code}`,
);

const syncBatch = {
  records: [
    {
      clientRef: `obs-offline-${STAMP}`,
      category: 'TREE_CONDITION',
      title: `Offline observation ${STAMP}`,
      description: 'Diseased sapelli stand recorded while out of network coverage.',
      forestId: FOREST,
      zoneId: ZONE,
      severity: 'MEDIUM',
      latitude: 3.9,
      longitude: 11.55,
      locationAccuracyM: 15,
    },
    {
      clientRef: `obs-offline-bad-${STAMP}`,
      category: 'OTHER',
      title: 'Invalid offline record',
      description: 'This record carries an impossible position and must be rejected individually.',
      forestId: FOREST,
      latitude: 130,
      longitude: 11.55,
    },
  ],
};
const sync = await call('POST', '/observations/offline-sync', { token, body: syncBatch });
check(
  'offline batch: 1 created, 1 rejected',
  sync.status === 201 && sync.body?.data?.created === 1 && sync.body?.data?.rejected === 1,
  JSON.stringify(sync.body?.data ?? {}).slice(0, 180),
);
const syncAgain = await call('POST', '/observations/offline-sync', { token, body: syncBatch });
check(
  'replaying the batch reports DUPLICATE',
  syncAgain.status === 201 && syncAgain.body?.data?.duplicates === 1 && syncAgain.body?.data?.created === 0,
  JSON.stringify(syncAgain.body?.data ?? {}).slice(0, 180),
);

console.log('\n— reading back —');
const detail = await call('GET', `/inspections/${inspectionId}`, { token });
check('GET /inspections/:id', detail.status === 200 && (detail.body?.data?.checklist ?? []).length >= 5, `HTTP ${detail.status} checklist=${(detail.body?.data?.checklist ?? []).length}`);
const list = await call('GET', '/inspections?limit=5', { token });
check(
  'GET /inspections',
  list.status === 200 && Array.isArray(list.body?.data) && list.body.data.length >= 2 && Number(list.body?.meta?.total) >= 3,
  `HTTP ${list.status} items=${(list.body?.data ?? []).length} total=${list.body?.meta?.total}`,
);
const stats = await call('GET', '/inspections/statistics', { token });
check('GET /inspections/statistics', stats.status === 200 && stats.body?.data?.total >= 2, `HTTP ${stats.status} total=${stats.body?.data?.total}`);
const obsStats = await call('GET', '/observations/statistics', { token });
check('GET /observations/statistics', obsStats.status === 200 && obsStats.body?.data?.total >= 3, `HTTP ${obsStats.status} total=${obsStats.body?.data?.total}`);

console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
console.log(`inspectionId=${inspectionId} cancelledInspectionId=${secondId} observationId=${observation.body?.data?.id} fileKey=${fileKey ?? 'n/a'}`);
process.exit(fail === 0 ? 0 : 1);
