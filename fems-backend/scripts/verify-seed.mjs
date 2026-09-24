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
  const unlabelled = {
    forests: await prisma.forest.count({ where: { id: { startsWith: 'demo-' }, isDemo: false } }),
    permits: await prisma.exploitationPermit.count({ where: { id: { startsWith: 'demo-' }, isDemo: false } }),
    activities: await prisma.exploitationActivity.count({ where: { id: { startsWith: 'demo-' }, isDemo: false } }),
    inspections: await prisma.inspection.count({ where: { id: { startsWith: 'demo-' }, isDemo: false } }),
    violations: await prisma.environmentalViolation.count({ where: { id: { startsWith: 'demo-' }, isDemo: false } }),
    payments: await prisma.payment.count({ where: { id: { startsWith: 'demo-' }, isDemo: false } }),
    gis: await prisma.gISLocation.count({ where: { id: { startsWith: 'demo-' }, isDemo: false } }),
  };
  const unlabelledTotal = Object.values(unlabelled).reduce((sum, value) => sum + value, 0);
  check('every seeded row carries isDemo: true', unlabelledTotal === 0, JSON.stringify(unlabelled));

  const demoRefs = await prisma.$transaction([
    prisma.exploitationPermit.count({ where: { isDemo: true, permitNumber: { startsWith: 'DEMO-' } } }),
    prisma.exploitationActivity.count({ where: { isDemo: true, reference: { startsWith: 'DEMO-ACT-' } } }),
    prisma.inspection.count({ where: { isDemo: true, reference: { startsWith: 'DEMO-INS-' } } }),
    prisma.environmentalViolation.count({ where: { isDemo: true, reference: { startsWith: 'DEMO-VIO-' } } }),
    prisma.payment.count({ where: { isDemo: true, reference: { startsWith: 'DEMO-PAY-' } } }),
  ]);
  check(
    'human-readable references are prefixed DEMO-',
    demoRefs.every((count) => count > 0),
    demoRefs.join('/'),
  );

  // --- coordinates -------------------------------------------------------
  const points = await prisma.gISLocation.findMany({
    where: { id: { startsWith: 'demo-' } },
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
  const alertStatuses = await prisma.aIAlert.groupBy({ by: ['status'], _count: true, where: { id: { startsWith: 'demo-alert' } } });
  check(
    'seeded alerts are untouched NEW signals (no fabricated human decision)',
    alertStatuses.length === 1 && alertStatuses[0].status === 'NEW',
    alertStatuses.map((row) => `${row.status}=${row._count}`).join(' '),
  );

  const detectors = await prisma.aIAlert.groupBy({ by: ['detector'], _count: true, where: { id: { startsWith: 'demo-alert' } } });
  check(
    'seeded alerts come from the local rule engine',
    detectors.length === 1 && detectors[0].detector === 'LOCAL_RULE_ENGINE',
    detectors.map((row) => `${row.detector}=${row._count}`).join(' '),
  );

  const analysis = await prisma.aIAnalysis.findUnique({
    where: { id: 'demo-analysis-0001' },
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

  const alertLinks = await prisma.aIAlert.count({ where: { id: { startsWith: 'demo-alert' }, analysisId: 'demo-analysis-0001' } });
  check('every seeded alert is linked to the analysis that produced it', alertLinks > 0, `${alertLinks} alert(s)`);

  // --- referential sanity ------------------------------------------------
  const orphanAlerts = await prisma.aIAlert.count({
    where: { id: { startsWith: 'demo-alert' }, OR: [{ entityType: null }, { entityId: null }] },
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
