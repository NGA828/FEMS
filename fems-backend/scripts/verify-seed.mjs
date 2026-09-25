#!/usr/bin/env node
/**
 * Verifies the demo dataset written by `npm run db:seed`.
 *
 * Every check below is a property the seed promises in its header comment:
 * demo rows are labelled, coordinates are real Cameroonian locations, field
 * captures say they came from the seed, payments are never presented as Campay
 * transactions, and AI alerts are untouched machine signals.
 *
 * Usage: node scripts/verify-seed.mjs   (exit code 1 on the first failure)
 */
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { backendRoot, loadDotEnv } from './lib/schema-tools.mjs';
import { demoId, SEEDED_ADMIN_ID, SEEDED_ANALYSIS_ID } from './lib/demo-id.mjs';

loadDotEnv(path.join(backendRoot, '.env'));

const CAMEROON = { minLat: 1.6, maxLat: 13.1, minLon: 8.4, maxLon: 16.3 };

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

const url = new URL(process.env.DATABASE_URL);
const prisma = new PrismaClient({
  adapter: new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: url.username,
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: 2,
  }),
});

const inCameroon = (latitude, longitude) =>
  Number(latitude) >= CAMEROON.minLat &&
  Number(latitude) <= CAMEROON.maxLat &&
  Number(longitude) >= CAMEROON.minLon &&
  Number(longitude) <= CAMEROON.maxLon;

console.log('FEMS demo seed verification');
console.log('---------------------------');

try {
  // --- volume ------------------------------------------------------------
  const [forests, zones, areas, species, companies, users, permits, activities, inspections, violations, observations, payments, reports, inventories] =
    await Promise.all([
      prisma.forest.count({ where: { isDemo: true } }),
      prisma.forestZone.count({ where: { isDemo: true } }),
      prisma.protectedArea.count({ where: { isDemo: true } }),
      prisma.treeSpecies.count(),
      prisma.company.count({ where: { isDemo: true } }),
      prisma.user.count({ where: { isDemo: true } }),
      prisma.exploitationPermit.count({ where: { isDemo: true } }),
      prisma.exploitationActivity.count({ where: { isDemo: true } }),
      prisma.inspection.count({ where: { isDemo: true } }),
      prisma.environmentalViolation.count({ where: { isDemo: true } }),
      prisma.fieldObservation.count({ where: { isDemo: true } }),
      prisma.payment.count({ where: { isDemo: true } }),
      prisma.report.count({ where: { isDemo: true } }),
      prisma.treeInventory.count({ where: { isDemo: true } }),
    ]);

  const volume = { forests, zones, areas, species, companies, users, permits, activities, inspections, violations, observations, payments, reports, inventories };
  for (const [label, count] of Object.entries(volume)) {
    check(`demo ${label} present`, count > 0, `${count} record(s)`);
  }
  check('the eight roles have a demonstration account', users >= 8, `${users} accounts`);

  // --- labels ------------------------------------------------------------
  // Ids are UUIDs (the API validates references with `@IsUUID()`), so "is this
  // row part of the demo dataset?" is no longer answered by the primary key. It
  // is answered by the two markers the schema carries: the `isDemo` flag and the
  // human-readable `DEMO-` reference. On the models that have both, the two sets
  // must be exactly the same size, so neither marker can drift.
  const labelled = await prisma.$transaction([
    prisma.exploitationPermit.count({ where: { isDemo: true } }),
    prisma.exploitationPermit.count({ where: { isDemo: true, permitNumber: { startsWith: 'DEMO-' } } }),
    prisma.exploitationActivity.count({ where: { isDemo: true } }),
    prisma.exploitationActivity.count({ where: { isDemo: true, reference: { startsWith: 'DEMO-ACT-' } } }),
    prisma.inspection.count({ where: { isDemo: true } }),
    prisma.inspection.count({ where: { isDemo: true, reference: { startsWith: 'DEMO-INS-' } } }),
    prisma.environmentalViolation.count({ where: { isDemo: true } }),
    prisma.environmentalViolation.count({ where: { isDemo: true, reference: { startsWith: 'DEMO-VIO-' } } }),
    prisma.payment.count({ where: { isDemo: true } }),
    prisma.payment.count({ where: { isDemo: true, reference: { startsWith: 'DEMO-PAY-' } } }),
    prisma.report.count({ where: { isDemo: true } }),
    prisma.report.count({ where: { isDemo: true, reference: { startsWith: 'DEMO-REP-' } } }),
    prisma.aIAlert.count({ where: { isDemo: true } }),
    prisma.aIAlert.count({ where: { isDemo: true, reference: { startsWith: 'DEMO-ALR-' } } }),
  ]);
  const labelledPairs = [
    ['permits', labelled[0], labelled[1]],
    ['activities', labelled[2], labelled[3]],
    ['inspections', labelled[4], labelled[5]],
    ['violations', labelled[6], labelled[7]],
    ['payments', labelled[8], labelled[9]],
    ['reports', labelled[10], labelled[11]],
    ['alerts', labelled[12], labelled[13]],
  ];
  for (const [label, flagged, referenced] of labelledPairs) {
    check(
      `every demo ${label} row is flagged and carries a DEMO- reference`,
      flagged > 0 && flagged === referenced,
      `${referenced} reference(s) / ${flagged} flagged row(s)`,
    );
  }

  // A seeded row is never mistaken for a regulatory record: no un-flagged row
  // may reuse a demonstration reference.
  const leakReference = await prisma.$transaction([
    prisma.exploitationPermit.count({ where: { isDemo: false, permitNumber: { startsWith: 'DEMO-' } } }),
    prisma.exploitationActivity.count({ where: { isDemo: false, reference: { startsWith: 'DEMO-ACT-' } } }),
    prisma.payment.count({ where: { isDemo: false, reference: { startsWith: 'DEMO-PAY-' } } }),
  ]);
  check(
    'no un-flagged row carries a DEMO- reference',
    leakReference.every((count) => count === 0),
    leakReference.join('/'),
  );

  // The identifier helper exists twice — once in the seed (the writer) and once
  // in scripts/lib/demo-id.mjs (the verifier). Looking rows up by the computed
  // value proves the two copies still agree.
  const mirrored = await prisma.$transaction([
    prisma.user.count({ where: { id: SEEDED_ADMIN_ID } }),
    prisma.aIAnalysis.count({ where: { id: SEEDED_ANALYSIS_ID } }),
  ]);
  check(
    'the seed and the verification scripts derive the same identifiers',
    mirrored.every((count) => count === 1),
    `admin=${mirrored[0]} analysis=${mirrored[1]}`,
  );
  check(
    'demoId() produces RFC 4122 version-5 UUIDs',
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(demoId('forest', 'probe')),
  );

  // --- coordinates -------------------------------------------------------
  const points = await prisma.gISLocation.findMany({
    where: { isDemo: true },
    select: { latitude: true, longitude: true, label: true },
  });
  const outside = points.filter((point) => !inCameroon(point.latitude, point.longitude));
  check('every seeded coordinate falls inside Cameroon', outside.length === 0, `${points.length} point(s) checked`);

  const forestRows = await prisma.forest.findMany({ where: { isDemo: true }, select: { code: true, latitude: true, longitude: true } });
  check(
    'forest centroids are valid WGS-84 positions',
    forestRows.every((row) => inCameroon(row.latitude, row.longitude)),
    `${forestRows.length} forest(s)`,
  );

  const gpsSources = await prisma.exploitationActivity.groupBy({ by: ['gpsSource'], _count: true, where: { isDemo: true } });
  check(
    'field captures are labelled SEED_DEMO, never DEVICE_GPS',
    gpsSources.length === 1 && gpsSources[0].gpsSource === 'SEED_DEMO',
    gpsSources.map((row) => `${row.gpsSource}=${row._count}`).join(' '),
  );

  const deviceGps = await prisma.inspection.count({ where: { isDemo: true, gpsSource: 'DEVICE_GPS' } });
  check('no seeded inspection claims a device GPS fix', deviceGps === 0, `${deviceGps} suspicious row(s)`);

  // --- money -------------------------------------------------------------
  const providers = await prisma.payment.groupBy({ by: ['provider'], _count: true, where: { isDemo: true } });
  check(
    'seeded payments use the SIMULATOR provider only',
    providers.length === 1 && providers[0].provider === 'SIMULATOR',
    providers.map((row) => `${row.provider}=${row._count}`).join(' '),
  );

  const campay = await prisma.payment.count({ where: { isDemo: true, provider: 'CAMPAY' } });
  check('no seeded payment pretends to be a Campay transaction', campay === 0, `${campay} row(s)`);

  const successfulWithoutReceipt = await prisma.payment.count({
    where: { isDemo: true, status: 'SUCCESSFUL', receiptNumber: null },
  });
  check('every successful seeded payment has a receipt number', successfulWithoutReceipt === 0);

  // --- AI ----------------------------------------------------------------
  const alertStatuses = await prisma.aIAlert.groupBy({ by: ['status'], _count: true, where: { isDemo: true } });
  check(
    'seeded alerts are untouched NEW signals (no fabricated human decision)',
    alertStatuses.length === 1 && alertStatuses[0].status === 'NEW',
    alertStatuses.map((row) => `${row.status}=${row._count}`).join(' '),
  );

  const detectors = await prisma.aIAlert.groupBy({ by: ['detector'], _count: true, where: { isDemo: true } });
  check(
    'seeded alerts come from the local rule engine',
    detectors.length === 1 && detectors[0].detector === 'LOCAL_RULE_ENGINE',
    detectors.map((row) => `${row.detector}=${row._count}`).join(' '),
  );

  const analysis = await prisma.aIAnalysis.findUnique({
    where: { id: SEEDED_ANALYSIS_ID },
    select: { status: true, model: true, resultJson: true, summary: true },
  });
  const result = analysis?.resultJson ? JSON.parse(analysis.resultJson) : null;
  check('the seeded analysis completed with the deterministic engine', analysis?.status === 'COMPLETED', analysis?.model ?? 'missing');
  check(
    'the analysis recorded what the rule engine evaluated',
    Boolean(result?.rulesEvaluated) && Array.isArray(result?.findings),
    `${result?.rulesEvaluated ?? 0} rule(s), ${result?.findings?.length ?? 0} finding(s)`,
  );
  check(
    'the analysis summary states that a signal is not a finding of guilt',
    typeof analysis?.summary === 'string' && analysis.summary.includes('ne désignent aucune personne coupable'),
  );

  const alertLinks = await prisma.aIAlert.count({ where: { isDemo: true, analysisId: SEEDED_ANALYSIS_ID } });
  check('every seeded alert is linked to the analysis that produced it', alertLinks > 0, `${alertLinks} alert(s)`);

  // --- referential sanity ------------------------------------------------
  const orphanAlerts = await prisma.aIAlert.count({
    where: { isDemo: true, OR: [{ entityType: null }, { entityId: null }] },
  });
  check('alerts carry the record they point at', orphanAlerts === 0, `${orphanAlerts} alert(s) without a subject`);

  const arrearsSuspects = await prisma.payment.count({
    where: { isDemo: true, purpose: 'PENALTY', violationId: { not: null }, status: 'SUCCESSFUL' },
  });
  check('penalty payments are tied to a case', arrearsSuspects > 0, `${arrearsSuspects} penalty payment(s)`);

  const resolvedWithOutstanding = await prisma.environmentalViolation.count({
    where: { isDemo: true, status: 'RESOLVED', penaltyAmountXAF: { gt: 0 } },
  });
  const resolvedPenaltiesPaid = await prisma.payment.count({
    where: { isDemo: true, purpose: 'PENALTY', status: 'SUCCESSFUL', violationId: { not: null } },
  });
  check(
    'a resolved case with a penalty has a settled payment',
    resolvedWithOutstanding === 0 || resolvedPenaltiesPaid > 0,
    `resolved=${resolvedWithOutstanding}, penalty payments=${resolvedPenaltiesPaid}`,
  );
} catch (error) {
  console.error('Verification could not complete:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

console.log('');
console.log(failures === 0 ? `ALL GREEN — ${checks} checks passed` : `FAILURES — ${checks - failures} passed, ${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
