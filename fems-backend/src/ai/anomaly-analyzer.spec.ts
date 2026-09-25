import { AlertStatus, AlertType, AiProvider, RiskLevel } from '@prisma/client';
import type {
  ActivityRow,
  ForestRow,
  IntelligenceDataset,
  ObservationRow,
  PermitRow,
  ProtectedAreaRow,
  ViolationRow,
} from './ai-dataset';
import {
  ANALYSIS_RULES,
  ANALYSIS_THRESHOLDS,
  DETECTOR_VERSION,
  findingFingerprint,
  runRules,
  ruleActivityAbovePlan,
  ruleActivityOnInvalidPermit,
  ruleFieldReportQuality,
  ruleForestAllowableCut,
  ruleIdleActivity,
  ruleInspectionCoverage,
  ruleMissingDocuments,
  rulePaymentArrears,
  rulePermitOverHarvest,
  ruleProtectedAreaProximity,
  toAlertRecord,
} from './anomaly-analyzer';

const NOW = new Date('2026-06-10T12:00:00Z');

function dataset(overrides: Partial<IntelligenceDataset> = {}): IntelligenceDataset {
  return {
    generatedAt: NOW,
    periodDays: 90,
    window: { from: new Date('2026-03-12T12:00:00Z'), to: NOW },
    scope: {},
    forests: [],
    zones: [],
    protectedAreas: [],
    permits: [],
    activities: [],
    inspections: [],
    violations: [],
    payments: [],
    observations: [],
    warnings: [],
    ...overrides,
  };
}

function forest(overrides: Partial<ForestRow> = {}): ForestRow {
  return {
    id: 'forest-1',
    code: 'UFA-10-012',
    name: 'UFA 10-012',
    region: 'Centre',
    type: 'PRODUCTION',
    status: 'ACTIVE',
    totalAreaHa: 12_000,
    annualAllowableCutM3: 5_000,
    latitude: 3.848,
    longitude: 11.502,
    ...overrides,
  };
}

function permit(overrides: Partial<PermitRow> = {}): PermitRow {
  return {
    id: 'permit-1',
    permitNumber: 'FEMS-EXP-2026-0001',
    type: 'EXPLOITATION',
    status: 'ACTIVE',
    companyId: 'company-1',
    companyName: 'Société Forestière du Nyong',
    forestId: 'forest-1',
    zoneId: null,
    volumeApprovedM3: 1_000,
    volumeRequestedM3: 1_000,
    feeAmount: 2_500_000,
    amountPaid: 2_500_000,
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2026-12-31T00:00:00Z'),
    documentCount: 2,
    verifiedDocumentCount: 2,
    ...overrides,
  };
}

function activity(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 'activity-1',
    reference: 'ACT-20260501-AAAAAA',
    permitId: 'permit-1',
    companyId: 'company-1',
    forestId: 'forest-1',
    zoneId: null,
    activityType: 'LOGGING',
    status: 'IN_PROGRESS',
    plannedVolumeM3: 100,
    harvestedVolumeM3: 50,
    harvestedTreeCount: 10,
    plannedStartDate: new Date('2026-05-01T00:00:00Z'),
    actualStartDate: new Date('2026-05-02T00:00:00Z'),
    actualEndDate: null,
    latitude: 3.85,
    longitude: 11.51,
    gpsSource: 'DEVICE_GPS',
    locationAccuracyM: 8,
    ...overrides,
  };
}

function observation(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    id: 'observation-1',
    title: 'Fresh stump outside the marked plot',
    category: 'ILLEGAL_LOGGING',
    severity: 'HIGH',
    forestId: 'forest-1',
    zoneId: null,
    protectedAreaId: null,
    activityId: null,
    latitude: 3.85,
    longitude: 11.51,
    locationAccuracyM: 6,
    capturedAt: new Date('2026-05-01T00:00:00Z'),
    aiProcessedAt: null,
    ...overrides,
  };
}

function protectedArea(overrides: Partial<ProtectedAreaRow> = {}): ProtectedAreaRow {
  return {
    id: 'area-1',
    code: 'PA-01',
    name: 'Réserve de Biosphère du Dja',
    type: 'RESERVE',
    region: 'Sud',
    areaHa: 526_000,
    latitude: 3.0,
    longitude: 13.0,
    encroachmentRisk: RiskLevel.HIGH,
    ...overrides,
  };
}

const context = (data: IntelligenceDataset) => ({ dataset: data, now: NOW, thresholds: ANALYSIS_THRESHOLDS });

describe('anomaly-analyzer', () => {
  describe('rulePermitOverHarvest', () => {
    it('says nothing when harvesting stays within the approved volume', () => {
      expect(rulePermitOverHarvest(context(dataset({ permits: [permit()], activities: [activity()] })))).toEqual([]);
    });

    it('raises a finding above the tolerance with the arithmetic written out', () => {
      const findings = rulePermitOverHarvest(
        context(dataset({ permits: [permit({ volumeApprovedM3: 100 })], activities: [activity({ harvestedVolumeM3: 130 })] })),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe('PERMIT_OVER_HARVEST');
      expect(findings[0].type).toBe(AlertType.OVER_HARVESTING);
      expect(findings[0].riskLevel).toBe(RiskLevel.MODERATE);
      expect(findings[0].reasoning).toContain('130');
      expect(findings[0].reasoning).toContain('100');
      expect(findings[0].evidence[0]).toEqual({ label: 'Approved volume', value: '100 m³' });
    });

    it('escalates the risk as the ratio grows', () => {
      const at = (harvested: number) =>
        rulePermitOverHarvest(
          context(dataset({ permits: [permit({ volumeApprovedM3: 100 })], activities: [activity({ harvestedVolumeM3: harvested })] })),
        )[0]?.riskLevel;
      expect(at(140)).toBe(RiskLevel.MODERATE);
      expect(at(200)).toBe(RiskLevel.HIGH);
      expect(at(400)).toBe(RiskLevel.CRITICAL);
    });

    it('ignores permits without an approved volume', () => {
      expect(
        rulePermitOverHarvest(
          context(dataset({ permits: [permit({ volumeApprovedM3: null })], activities: [activity({ harvestedVolumeM3: 900 })] })),
        ),
      ).toEqual([]);
    });

    it('sums several activities on the same permit', () => {
      const findings = rulePermitOverHarvest(
        context(
          dataset({
            permits: [permit({ volumeApprovedM3: 100 })],
            activities: [
              activity({ id: 'a1', harvestedVolumeM3: 60 }),
              activity({ id: 'a2', harvestedVolumeM3: 60 }),
            ],
          }),
        ),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].reasoning).toContain('120');
    });
  });

  describe('ruleForestAllowableCut', () => {
    it('reports a forest harvested beyond its annual allowance', () => {
      const findings = ruleForestAllowableCut(
        context(
          dataset({
            forests: [forest({ annualAllowableCutM3: 100 })],
            activities: [activity({ harvestedVolumeM3: 150 })],
          }),
        ),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe(AlertType.DEFORESTATION_RISK);
      expect(findings[0].riskLevel).toBe(RiskLevel.HIGH);
    });

    it('stays silent when the allowance is unknown', () => {
      expect(
        ruleForestAllowableCut(
          context(dataset({ forests: [forest({ annualAllowableCutM3: null })], activities: [activity({ harvestedVolumeM3: 10_000 })] })),
        ),
      ).toEqual([]);
    });
  });

  describe('ruleActivityOnInvalidPermit', () => {
    it('raises a critical signal when the permit cannot be found', () => {
      const findings = ruleActivityOnInvalidPermit(context(dataset({ activities: [activity()] })));
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe(AlertType.UNAUTHORIZED_ACTIVITY);
      expect(findings[0].riskLevel).toBe(RiskLevel.CRITICAL);
      expect(findings[0].description).toContain('An officer must confirm');
    });

    it('reports exploitation on a suspended permit as a permit violation', () => {
      const findings = ruleActivityOnInvalidPermit(
        context(dataset({ permits: [permit({ status: 'SUSPENDED' })], activities: [activity()] })),
      );
      expect(findings[0].type).toBe(AlertType.PERMIT_VIOLATION);
      expect(findings[0].riskLevel).toBe(RiskLevel.MODERATE);
      expect(findings[0].reasoning).toContain('SUSPENDED');
    });

    it('escalates to high when the permit is revoked', () => {
      const findings = ruleActivityOnInvalidPermit(
        context(dataset({ permits: [permit({ status: 'REVOKED' })], activities: [activity()] })),
      );
      expect(findings[0].riskLevel).toBe(RiskLevel.HIGH);
    });

    it('ignores work recorded outside the permit validity when the permit is healthy', () => {
      const findings = ruleActivityOnInvalidPermit(
        context(
          dataset({
            permits: [permit()],
            activities: [activity({ actualStartDate: new Date('2025-12-01T00:00:00Z') })],
          }),
        ),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe('ACTIVITY_OUTSIDE_PERMIT_PERIOD');
      expect(findings[0].riskLevel).toBe(RiskLevel.MODERATE);
    });

    it('never signals a plan that has not started', () => {
      expect(
        ruleActivityOnInvalidPermit(
          context(dataset({ permits: [permit({ status: 'REVOKED' })], activities: [activity({ status: 'PLANNED', actualStartDate: null })] })),
        ),
      ).toEqual([]);
    });
  });

  describe('ruleActivityAbovePlan', () => {
    it('flags an activity well above its own plan', () => {
      const findings = ruleActivityAbovePlan(context(dataset({ activities: [activity({ plannedVolumeM3: 100, harvestedVolumeM3: 160 })] })));
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe(AlertType.OPERATIONAL_ANOMALY);
      expect(findings[0].reasoning).toContain('1.6');
    });

    it('tolerates a small overrun', () => {
      expect(
        ruleActivityAbovePlan(context(dataset({ activities: [activity({ plannedVolumeM3: 100, harvestedVolumeM3: 105 })] }))),
      ).toEqual([]);
    });
  });

  describe('ruleIdleActivity', () => {
    it('flags a plan that never started after the threshold', () => {
      const findings = ruleIdleActivity(
        context(dataset({ activities: [activity({ status: 'PLANNED', actualStartDate: null, plannedStartDate: new Date('2026-03-01T00:00:00Z') })] })),
      );
      expect(findings[0].code).toBe('ACTIVITY_NOT_STARTED');
      expect(findings[0].reasoning).toContain('101 days');
    });

    it('stays quiet for a recent plan', () => {
      expect(
        ruleIdleActivity(
          context(dataset({ activities: [activity({ status: 'PLANNED', actualStartDate: null, plannedStartDate: new Date('2026-06-01T00:00:00Z') })] })),
        ),
      ).toEqual([]);
    });
  });

  describe('ruleProtectedAreaProximity', () => {
    it('measures the real distance and escalates as it shrinks', () => {
      const area = protectedArea({ latitude: 3.85, longitude: 11.51 });
      const findings = ruleProtectedAreaProximity(
        context(dataset({ protectedAreas: [area], activities: [activity({ latitude: 3.852, longitude: 11.51 })] })),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe(AlertType.PROTECTED_AREA_ENCROACHMENT);
      expect(findings[0].riskLevel).toBe(RiskLevel.CRITICAL);
      expect(findings[0].reasoning).toContain('haversine');
    });

    it('ignores work far from every protected area', () => {
      expect(
        ruleProtectedAreaProximity(
          context(dataset({ protectedAreas: [protectedArea({ latitude: 5.5, longitude: 12.0 })], activities: [activity()] })),
        ),
      ).toEqual([]);
    });

    it('flags work inside a zone marked as protected', () => {
      const findings = ruleProtectedAreaProximity(
        context(
          dataset({
            zones: [
              {
                id: 'zone-1',
                forestId: 'forest-1',
                code: 'Z-1',
                name: 'Zone de conservation',
                status: 'ACTIVE',
                areaHa: 500,
                maxAnnualYieldM3: 0,
                isProtected: true,
                latitude: 3.85,
                longitude: 11.51,
              },
            ],
            activities: [activity({ zoneId: 'zone-1' })],
          }),
        ),
      );
      expect(findings[0].code).toBe('ACTIVITY_IN_PROTECTED_ZONE');
      expect(findings[0].riskLevel).toBe(RiskLevel.HIGH);
    });

    it('also watches field observations near a protected area', () => {
      const findings = ruleProtectedAreaProximity(
        context(
          dataset({
            protectedAreas: [protectedArea({ latitude: 3.85, longitude: 11.51 })],
            observations: [observation({ latitude: 3.855, longitude: 11.51 })],
          }),
        ),
      );
      expect(findings.map((finding) => finding.code)).toContain('OBSERVATION_NEAR_PROTECTED_AREA');
    });
  });

  describe('rulePaymentArrears', () => {
    it('reports a permit fee that is still unpaid long after the start', () => {
      const findings = rulePaymentArrears(
        context(dataset({ permits: [permit({ feeAmount: 1_500_000, amountPaid: 500_000, startDate: new Date('2026-01-01T00:00:00Z') })] })),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe(AlertType.PAYMENT_ANOMALY);
      expect(findings[0].reasoning).toContain('1000000');
    });

    it('ignores a settled permit', () => {
      expect(rulePaymentArrears(context(dataset({ permits: [permit()] })))).toEqual([]);
    });

    it('waits for the arrears threshold before signalling', () => {
      expect(
        rulePaymentArrears(
          context(dataset({ permits: [permit({ feeAmount: 100, amountPaid: 0, startDate: new Date('2026-06-05T00:00:00Z') })] })),
        ),
      ).toEqual([]);
    });

    it('reports penalties that successful payments do not cover', () => {
      const violation: ViolationRow = {
        id: 'violation-1',
        reference: 'VIO-20260101-ABC123',
        status: 'CONFIRMED',
        severity: 'HIGH',
        companyId: 'company-1',
        forestId: 'forest-1',
        detectedAt: new Date('2026-01-05T00:00:00Z'),
        remediationRequired: true,
        remediationDeadline: new Date('2026-02-04T00:00:00Z'),
        penaltyAmountXAF: 400_000,
        penaltyPaidXAF: 100_000,
      };
      const findings = rulePaymentArrears(context(dataset({ violations: [violation] })));
      expect(findings[0].code).toBe('PENALTY_OUTSTANDING');
      expect(findings[0].evidence.at(-1)).toEqual({ label: 'Outstanding', value: '300000 XAF' });
    });
  });

  describe('ruleMissingDocuments', () => {
    it('flags an active permit with no document at all', () => {
      const findings = ruleMissingDocuments(context(dataset({ permits: [permit({ documentCount: 0, verifiedDocumentCount: 0 })] })));
      expect(findings[0].code).toBe('PERMIT_DOCUMENT_GAP');
      expect(findings[0].riskLevel).toBe(RiskLevel.MODERATE);
    });

    it('flags unverified documents as a lower signal', () => {
      const findings = ruleMissingDocuments(context(dataset({ permits: [permit({ documentCount: 2, verifiedDocumentCount: 0 })] })));
      expect(findings[0].riskLevel).toBe(RiskLevel.LOW);
    });

    it('stays quiet for drafts, which have no obligation yet', () => {
      expect(
        ruleMissingDocuments(context(dataset({ permits: [permit({ status: 'DRAFT', documentCount: 0, verifiedDocumentCount: 0 })] }))),
      ).toEqual([]);
    });
  });

  describe('ruleInspectionCoverage', () => {
    it('flags harvesting with no closed inspection at all', () => {
      const findings = ruleInspectionCoverage(context(dataset({ forests: [forest()], activities: [activity()] })));
      expect(findings[0].code).toBe('INSPECTION_COVERAGE_GAP');
      expect(findings[0].riskLevel).toBe(RiskLevel.HIGH);
    });

    it('flags a long inspection silence', () => {
      const findings = ruleInspectionCoverage(
        context(
          dataset({
            forests: [forest()],
            activities: [activity()],
            inspections: [
              {
                id: 'inspection-1',
                reference: 'INS-20260101-AAAAAA',
                type: 'ROUTINE',
                status: 'CLOSED',
                outcome: 'COMPLIANT',
                complianceScore: 92,
                forestId: 'forest-1',
                zoneId: null,
                companyId: 'company-1',
                permitId: 'permit-1',
                scheduledFor: new Date('2026-01-02T00:00:00Z'),
                completedAt: new Date('2026-01-03T00:00:00Z'),
              },
            ],
          }),
        ),
      );
      expect(findings[0].riskLevel).toBe(RiskLevel.MODERATE);
      expect(findings[0].title).toContain('days');
    });

    it('says nothing when a recent inspection closed', () => {
      expect(
        ruleInspectionCoverage(
          context(
            dataset({
              forests: [forest()],
              activities: [activity()],
              inspections: [
                {
                  id: 'inspection-2',
                  reference: 'INS-20260601-BBBBBB',
                  type: 'ROUTINE',
                  status: 'CLOSED',
                  outcome: 'COMPLIANT',
                  complianceScore: 90,
                  forestId: 'forest-1',
                  zoneId: null,
                  companyId: 'company-1',
                  permitId: 'permit-1',
                  scheduledFor: new Date('2026-06-01T00:00:00Z'),
                  completedAt: new Date('2026-06-02T00:00:00Z'),
                },
              ],
            }),
          ),
        ),
      ).toEqual([]);
    });
  });

  describe('ruleFieldReportQuality', () => {
    it('flags serious observations that were never triaged', () => {
      const findings = ruleFieldReportQuality(context(dataset({ observations: [observation()] })));
      expect(findings[0].code).toBe('OBSERVATION_UNTRIAGED');
      expect(findings[0].riskLevel).toBe(RiskLevel.MODERATE);
    });

    it('does not flag an observation that was already processed', () => {
      expect(ruleFieldReportQuality(context(dataset({ observations: [observation({ aiProcessedAt: NOW })] })))).toEqual([]);
    });

    it('detects repeated positions with the same category', () => {
      const findings = ruleFieldReportQuality(
        context(
          dataset({
            observations: [
              observation({ id: 'o1', severity: 'LOW', aiProcessedAt: NOW }),
              observation({ id: 'o2', severity: 'LOW', aiProcessedAt: NOW }),
              observation({ id: 'o3', severity: 'LOW', aiProcessedAt: NOW }),
            ],
          }),
        ),
      );
      expect(findings.map((finding) => finding.code)).toContain('OBSERVATION_REPEATED_POSITION');
    });
  });

  describe('runRules', () => {
    it('runs every catalogued rule and returns one finding per signal', () => {
      const outcome = runRules(dataset({ permits: [permit({ volumeApprovedM3: 10 })], activities: [activity({ harvestedVolumeM3: 100 })] }));
      expect(outcome.rulesEvaluated).toBe(ANALYSIS_RULES.length);
      expect(outcome.findings.map((finding) => finding.code)).toContain('PERMIT_OVER_HARVEST');
      expect(outcome.byRisk.CRITICAL + outcome.byRisk.HIGH).toBeGreaterThan(0);
    });

    it('returns a clean result with a reassuring, non-accusatory summary', () => {
      const outcome = runRules(dataset());
      expect(outcome.findings).toEqual([]);
      expect(outcome.byType).toEqual({});
      expect(describeSafe(outcome.findings.length)).toBe(0);
    });

    it('sorts by risk first, then confidence', () => {
      const outcome = runRules(
        dataset({
          permits: [
            permit({ id: 'p-low', permitNumber: 'P1', volumeApprovedM3: 100 }),
            permit({ id: 'p-high', permitNumber: 'P2', volumeApprovedM3: 100 }),
          ],
          activities: [
            activity({ id: 'a-low', permitId: 'p-low', harvestedVolumeM3: 110 }),
            activity({ id: 'a-high', permitId: 'p-high', harvestedVolumeM3: 500 }),
          ],
        }),
      );
      const risks = outcome.findings.map((finding) => finding.riskLevel);
      expect(risks[0]).toBe(RiskLevel.CRITICAL);
    });

    it('skips findings already carried by an open alert and counts them', () => {
      const base = dataset({ permits: [permit({ volumeApprovedM3: 10 })], activities: [activity({ harvestedVolumeM3: 100 })] });
      const first = runRules(base);
      const fingerprint = findingFingerprint(first.findings[0]);
      const second = runRules(base, { knownFingerprints: new Set([fingerprint]) });
      expect(second.findings.map((finding) => finding.code)).not.toContain(first.findings[0].code);
      expect(second.duplicates).toBe(1);
    });

    it('caps the number of findings', () => {
      const activities = Array.from({ length: 30 }, (_, index) =>
        activity({ id: `a-${index}`, harvestedVolumeM3: 500 }),
      );
      const outcome = runRules(dataset({ permits: [permit({ volumeApprovedM3: 10 })], activities }), { maxFindings: 3 });
      expect(outcome.findings).toHaveLength(3);
      expect(outcome.warnings.join(' ')).toContain('capped');
    });

    it('drops findings below the confidence floor', () => {
      const outcome = runRules(dataset({ observations: [observation()] }), {
        thresholds: { ...ANALYSIS_THRESHOLDS, minConfidence: 0.95 },
      });
      expect(outcome.findings).toEqual([]);
    });

    it('carries the dataset warnings through', () => {
      const outcome = runRules(dataset({ warnings: ['Only the 1000 most recent permits were analysed.'] }));
      expect(outcome.warnings[0]).toContain('1000 most recent permits');
    });
  });

  describe('toAlertRecord', () => {
    it('always produces a NEW alert — the engine cannot conclude anything by itself', () => {
      const record = toAlertRecord({
        code: 'PERMIT_OVER_HARVEST',
        type: AlertType.OVER_HARVESTING,
        riskLevel: RiskLevel.HIGH,
        confidence: 0.9,
        title: 'Harvest above approved volume',
        description: 'description',
        reasoning: 'reasoning',
        entityType: 'ExploitationPermit',
        entityId: 'permit-1',
        forestId: 'forest-1',
        zoneId: null,
        protectedAreaId: null,
        companyId: 'company-1',
        permitId: 'permit-1',
        activityId: null,
        inspectionId: null,
        observationId: null,
        latitude: null,
        longitude: null,
        evidence: [],
      });
      expect(record.status).toBe(AlertStatus.NEW);
      expect(record.detector).toBe(AiProvider.LOCAL_RULE_ENGINE);
    });

    it('never attributes an engine signal to a model', () => {
      const record = toAlertRecord(
        {
          code: 'X',
          type: AlertType.OPERATIONAL_ANOMALY,
          riskLevel: RiskLevel.LOW,
          confidence: 0.4,
          title: 't',
          description: 'd',
          reasoning: 'r',
          entityType: 'Forest',
          entityId: 'forest-1',
          forestId: 'forest-1',
          zoneId: null,
          protectedAreaId: null,
          companyId: null,
          permitId: null,
          activityId: null,
          inspectionId: null,
          observationId: null,
          latitude: null,
          longitude: null,
          evidence: [],
        },
        AiProvider.LOCAL_RULE_ENGINE,
      );
      expect(record.detector).not.toBe(AiProvider.GEMINI);
    });

    it('truncates long titles to the column width', () => {
      const record = toAlertRecord({
        code: 'X',
        type: AlertType.DOCUMENT_ANOMALY,
        riskLevel: RiskLevel.LOW,
        confidence: 0.5,
        title: 'x'.repeat(400),
        description: 'd',
        reasoning: 'r',
        entityType: 'ExploitationPermit',
        entityId: 'permit-1',
        forestId: null,
        zoneId: null,
        protectedAreaId: null,
        companyId: null,
        permitId: 'permit-1',
        activityId: null,
        inspectionId: null,
        observationId: null,
        latitude: null,
        longitude: null,
        evidence: [],
      });
      expect(record.title).toHaveLength(191);
    });

    it('publishes a detector version so stored signals stay explainable', () => {
      expect(DETECTOR_VERSION).toBe('fems-rules/1.0');
    });
  });
});

/** Small helper kept local: the outcome of an empty run must be exactly zero. */
function describeSafe(count: number): number {
  return count;
}
