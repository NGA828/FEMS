import { AlertStatus, AlertType, AiProvider, RiskLevel } from '@prisma/client';
import { haversineDistanceMeters } from '../common/utils/geo.util';
import type {
  ActivityRow,
  IntelligenceDataset,
  PermitRow,
  ProtectedAreaRow,
} from './ai-dataset';

/**
 * FEMS deterministic forest-intelligence engine.
 *
 * Every rule below is arithmetic over records that already exist in FEMS: no
 * model, no guessing, no internet. A rule only ever produces a *finding* — a
 * labelled signal with the figures that triggered it, an explicit risk level and
 * a confidence that is derived from the same figures. Findings are stored as
 * `AIAlert` rows with status NEW: an officer decides what they mean. The engine
 * has no code path that accuses anybody, and `toAlertRecord` enforces that by
 * construction.
 */

export const DETECTOR_VERSION = 'fems-rules/1.0';

/** Tunable thresholds — all exported so the API can show them and tests can pin them. */
export type AnalysisThresholds = {
  overHarvestTolerance: number;
  activityPlanTolerance: number;
  paymentArrearsDays: number;
  penaltyArrearsDays: number;
  protectedAreaBufferM: number;
  observationReviewDays: number;
  idleActivityDays: number;
  inspectionCoverageDays: number;
  minConfidence: number;
  maxFindings: number;
};

export const ANALYSIS_THRESHOLDS: AnalysisThresholds = {
  /** Harvesting more than 5 % above the approved volume is a finding. */
  overHarvestTolerance: 1.05,
  /** An activity that harvested more than 10 % above its own plan is a finding. */
  activityPlanTolerance: 1.1,
  /** A permit fee unpaid this long after the validity start is a finding. */
  paymentArrearsDays: 30,
  /** A penalty unpaid this long after it was decided is a finding. */
  penaltyArrearsDays: 30,
  /** Distance below which an activity/observation is considered encroaching. */
  protectedAreaBufferM: 1000,
  /** Observations with a serious severity are expected to be processed within this delay. */
  observationReviewDays: 7,
  /** A planned activity that never started after this delay is a finding. */
  idleActivityDays: 30,
  /** A forest with exploitation and no completed inspection within this delay is a finding. */
  inspectionCoverageDays: 90,
  /** Below this confidence, a finding is not raised at all. */
  minConfidence: 0.35,
  /** Hard ceiling on findings per analysis run. */
  maxFindings: 200,
};

export interface Finding {
  code: string;
  type: AlertType;
  riskLevel: RiskLevel;
  confidence: number;
  title: string;
  description: string;
  reasoning: string;
  entityType: string;
  entityId: string;
  forestId: string | null;
  zoneId: string | null;
  protectedAreaId: string | null;
  companyId: string | null;
  permitId: string | null;
  activityId: string | null;
  inspectionId: string | null;
  observationId: string | null;
  latitude: number | null;
  longitude: number | null;
  evidence: Array<{ label: string; value: string }>;
}

/**
 * Stable identity of a finding — one open signal per alert type and record.
 * The same identity is used when checking whether an equivalent alert is already
 * awaiting review, so a run can be repeated without flooding the console.
 */
export function findingFingerprint(finding: Pick<Finding, 'type' | 'entityType' | 'entityId'>): string {
  return `${finding.type}:${finding.entityType}:${finding.entityId}`;
}

/** The alert record shape, with the invariants the database must never break. */
export interface AlertRecordInput {
  type: AlertType;
  status: AlertStatus;
  riskLevel: RiskLevel;
  confidence: number;
  detector: AiProvider;
  title: string;
  description: string;
  reasoning: string;
  entityType: string;
  entityId: string;
  forestId: string | null;
  zoneId: string | null;
  protectedAreaId: string | null;
  companyId: string | null;
  permitId: string | null;
  activityId: string | null;
  inspectionId: string | null;
  observationId: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Converts a finding into an alert row. The status is pinned to NEW and the
 * detector to the rule engine: there is no input that can make the engine
 * produce a confirmed case about a company or a person.
 */
export function toAlertRecord(finding: Finding, detector: AiProvider = AiProvider.LOCAL_RULE_ENGINE): AlertRecordInput {
  return {
    type: finding.type,
    status: AlertStatus.NEW,
    riskLevel: finding.riskLevel,
    confidence: finding.confidence,
    detector,
    title: finding.title.slice(0, 191),
    description: finding.description,
    reasoning: finding.reasoning,
    entityType: finding.entityType,
    entityId: finding.entityId,
    forestId: finding.forestId,
    zoneId: finding.zoneId,
    protectedAreaId: finding.protectedAreaId,
    companyId: finding.companyId,
    permitId: finding.permitId,
    activityId: finding.activityId,
    inspectionId: finding.inspectionId,
    observationId: finding.observationId,
    latitude: finding.latitude,
    longitude: finding.longitude,
  };
}

const round = (value: number, digits = 2): number => Math.round(value * 10 ** digits) / 10 ** digits;
const ratio = (value: number, base: number): number => (base <= 0 ? 0 : value / base);
const clamp01 = (value: number): number => Math.min(0.97, Math.max(0.05, round(value, 2)));
const day = 86_400_000;

function riskFromRatio(value: number, moderate: number, high: number, critical: number): RiskLevel {
  if (value >= critical) return RiskLevel.CRITICAL;
  if (value >= high) return RiskLevel.HIGH;
  if (value >= moderate) return RiskLevel.MODERATE;
  return RiskLevel.LOW;
}

function daysSince(date: Date | null | undefined, now: Date): number {
  return date ? Math.floor((now.getTime() - date.getTime()) / day) : 0;
}

function baseFinding(input: Partial<Finding> & Pick<Finding, 'code' | 'type' | 'riskLevel' | 'confidence' | 'title' | 'description' | 'reasoning' | 'entityType' | 'entityId'>): Finding {
  return {
    forestId: null,
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
    ...input,
  };
}

export interface RuleContext {
  dataset: IntelligenceDataset;
  /** Now, injected so tests are deterministic. */
  now: Date;
  thresholds: AnalysisThresholds;
}

/** 1 — a permit harvested more than its approved volume. */
export function rulePermitOverHarvest(context: RuleContext): Finding[] {
  const { dataset, thresholds } = context;
  const harvestedByPermit = new Map<string, { volume: number; trees: number; activities: number }>();
  for (const activity of dataset.activities) {
    const entry = harvestedByPermit.get(activity.permitId) ?? { volume: 0, trees: 0, activities: 0 };
    entry.volume += activity.harvestedVolumeM3;
    entry.trees += activity.harvestedTreeCount;
    entry.activities += 1;
    harvestedByPermit.set(activity.permitId, entry);
  }

  const findings: Finding[] = [];
  for (const permit of dataset.permits) {
    const approved = permit.volumeApprovedM3 ?? 0;
    const harvested = harvestedByPermit.get(permit.id)?.volume ?? 0;
    if (approved <= 0 || harvested <= 0) continue;
    const used = ratio(harvested, approved);
    if (used < thresholds.overHarvestTolerance) continue;

    const risk = riskFromRatio(used, thresholds.overHarvestTolerance, 1.5, 3);
    const excess = round(harvested - approved);
    findings.push(
      baseFinding({
        code: 'PERMIT_OVER_HARVEST',
        type: AlertType.OVER_HARVESTING,
        riskLevel: risk,
        confidence: clamp01(0.6 + (used - 1) * 0.5),
        title: `Harvest above approved volume on permit ${permit.permitNumber}`,
        description:
          `Recorded harvest on ${permit.companyName}'s permit ${permit.permitNumber} reaches ${round(harvested)} m³ against an approved volume of ` +
          `${approved} m³ (${round(used * 100, 1)} % of the authorisation). This is a documented discrepancy for an officer to examine, not a finding of guilt.`,
        reasoning:
          `Sum of harvestedVolumeM3 over ${harvestedByPermit.get(permit.id)?.activities ?? 0} recorded activity(ies) = ${round(harvested)} m³; ` +
          `volumeApprovedM3 = ${approved} m³; ratio = ${round(used, 3)} (tolerance ${thresholds.overHarvestTolerance}).`,
        entityType: 'ExploitationPermit',
        entityId: permit.id,
        forestId: permit.forestId,
        zoneId: permit.zoneId,
        companyId: permit.companyId,
        permitId: permit.id,
        evidence: [
          { label: 'Approved volume', value: `${approved} m³` },
          { label: 'Recorded harvest', value: `${round(harvested)} m³` },
          { label: 'Excess', value: `${excess} m³` },
          { label: 'Trees felled', value: String(harvestedByPermit.get(permit.id)?.trees ?? 0) },
        ],
      }),
    );
  }
  return findings;
}

/** 2 — a forest harvested beyond its annual allowable cut. */
export function ruleForestAllowableCut(context: RuleContext): Finding[] {
  const { dataset } = context;
  const findings: Finding[] = [];
  const harvestedByForest = new Map<string, number>();
  for (const activity of dataset.activities) {
    harvestedByForest.set(activity.forestId, (harvestedByForest.get(activity.forestId) ?? 0) + activity.harvestedVolumeM3);
  }

  for (const forest of dataset.forests) {
    const allowance = forest.annualAllowableCutM3;
    const harvested = harvestedByForest.get(forest.id) ?? 0;
    if (allowance === null || allowance <= 0 || harvested <= 0) continue;
    const used = ratio(harvested, allowance);
    if (used < 1) continue;

    findings.push(
      baseFinding({
        code: 'FOREST_ALLOWABLE_CUT_EXCEEDED',
        type: AlertType.DEFORESTATION_RISK,
        riskLevel: riskFromRatio(used, 1, 1.25, 1.75),
        confidence: clamp01(0.55 + (used - 1) * 0.6),
        title: `Annual allowable cut reached in ${forest.name}`,
        description:
          `Harvest recorded in ${forest.name} (${forest.region}) since ${context.dataset.window.from.toISOString().slice(0, 10)} reaches ${round(harvested)} m³ ` +
          `against an annual allowable cut of ${allowance} m³. The comparison is arithmetic on recorded activities; rotation and regeneration are assessed by the forest service.`,
        reasoning: `Sum of harvestedVolumeM3 per forest = ${round(harvested)} m³; annualAllowableCutM3 = ${allowance} m³; ratio = ${round(used, 3)}.`,
        entityType: 'Forest',
        entityId: forest.id,
        forestId: forest.id,
        latitude: forest.latitude,
        longitude: forest.longitude,
        evidence: [
          { label: 'Annual allowable cut', value: `${allowance} m³` },
          { label: 'Recorded harvest', value: `${round(harvested)} m³` },
          { label: 'Area', value: `${forest.totalAreaHa} ha` },
        ],
      }),
    );
  }
  return findings;
}

const ACTIVE_ACTIVITY_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'SUSPENDED'];
const BLOCKING_PERMIT_STATUSES = ['SUSPENDED', 'REVOKED', 'EXPIRED', 'CANCELLED', 'REJECTED'];

/** 3 — exploitation recorded on a permit that is no longer valid. */
export function ruleActivityOnInvalidPermit(context: RuleContext): Finding[] {
  const { dataset } = context;
  const permits = new Map(dataset.permits.map((permit) => [permit.id, permit]));
  const findings: Finding[] = [];

  for (const activity of dataset.activities) {
    const permit = permits.get(activity.permitId);
    const started = activity.actualStartDate !== null || ACTIVE_ACTIVITY_STATUSES.includes(activity.status);
    if (!started) continue;

    if (!permit) {
      findings.push(
        baseFinding({
          code: 'ACTIVITY_WITHOUT_VALID_PERMIT',
          type: AlertType.UNAUTHORIZED_ACTIVITY,
          riskLevel: RiskLevel.CRITICAL,
          confidence: 0.85,
          title: `Exploitation recorded without an authorisation in scope (${activity.reference})`,
          description:
            `Activity ${activity.reference} (${activity.activityType}) is recorded as ${activity.status} but its permit could not be found in the analysed scope. ` +
            'An officer must confirm whether the authorisation exists outside this scope before concluding anything.',
          reasoning: `permitId ${activity.permitId} did not resolve to a permit row inside the analysis scope and window.`,
          entityType: 'ExploitationActivity',
          entityId: activity.id,
          forestId: activity.forestId,
          zoneId: activity.zoneId,
          companyId: activity.companyId,
          permitId: activity.permitId,
          activityId: activity.id,
          latitude: activity.latitude,
          longitude: activity.longitude,
          evidence: [
            { label: 'Activity status', value: activity.status },
            { label: 'Harvested', value: `${activity.harvestedVolumeM3} m³` },
            { label: 'Recorded GPS source', value: activity.gpsSource },
          ],
        }),
      );
      continue;
    }

    if (BLOCKING_PERMIT_STATUSES.includes(permit.status) && activity.status !== 'CANCELLED') {
      findings.push(
        baseFinding({
          code: 'ACTIVITY_ON_INVALID_PERMIT',
          type: AlertType.PERMIT_VIOLATION,
          riskLevel: permit.status === 'REVOKED' || permit.status === 'EXPIRED' ? RiskLevel.HIGH : RiskLevel.MODERATE,
          confidence: 0.8,
          title: `Exploitation recorded while permit ${permit.permitNumber} is ${permit.status.toLowerCase()}`,
          description:
            `Activity ${activity.reference} by ${permit.companyName} is recorded as ${activity.status} while permit ${permit.permitNumber} is ${permit.status}. ` +
            'Only an officer can decide whether this is a breach — the rule simply compares two recorded statuses.',
          reasoning: `permit.status = ${permit.status}; activity.status = ${activity.status}; activity.permitId = ${permit.id}.`,
          entityType: 'ExploitationActivity',
          entityId: activity.id,
          forestId: activity.forestId,
          zoneId: activity.zoneId,
          companyId: activity.companyId,
          permitId: permit.id,
          activityId: activity.id,
          latitude: activity.latitude,
          longitude: activity.longitude,
          evidence: [
            { label: 'Permit status', value: permit.status },
            { label: 'Permit validity', value: `${permit.startDate.toISOString().slice(0, 10)} → ${permit.endDate.toISOString().slice(0, 10)}` },
            { label: 'Activity status', value: activity.status },
          ],
        }),
      );
    }

    const outsideValidity =
      (activity.actualStartDate !== null && activity.actualStartDate < permit.startDate) ||
      (activity.actualEndDate !== null && activity.actualEndDate > permit.endDate);
    if (outsideValidity && !BLOCKING_PERMIT_STATUSES.includes(permit.status)) {
      findings.push(
        baseFinding({
          code: 'ACTIVITY_OUTSIDE_PERMIT_PERIOD',
          type: AlertType.PERMIT_VIOLATION,
          riskLevel: RiskLevel.MODERATE,
          confidence: 0.7,
          title: `Activity ${activity.reference} falls outside the permit validity period`,
          description:
            `The recorded working dates of ${activity.reference} do not fit inside the validity of permit ${permit.permitNumber}.`,
          reasoning:
            `activity ${activity.actualStartDate?.toISOString().slice(0, 10) ?? '—'} → ${activity.actualEndDate?.toISOString().slice(0, 10) ?? '—'}; ` +
            `permit ${permit.startDate.toISOString().slice(0, 10)} → ${permit.endDate.toISOString().slice(0, 10)}.`,
          entityType: 'ExploitationActivity',
          entityId: activity.id,
          forestId: activity.forestId,
          zoneId: activity.zoneId,
          companyId: activity.companyId,
          permitId: permit.id,
          activityId: activity.id,
          latitude: activity.latitude,
          longitude: activity.longitude,
          evidence: [
            { label: 'Activity start', value: activity.actualStartDate?.toISOString().slice(0, 10) ?? '—' },
            { label: 'Activity end', value: activity.actualEndDate?.toISOString().slice(0, 10) ?? '—' },
            { label: 'Permit validity', value: `${permit.startDate.toISOString().slice(0, 10)} → ${permit.endDate.toISOString().slice(0, 10)}` },
          ],
        }),
      );
    }
  }
  return findings;
}

/** 4 — an activity that harvested well above its own plan. */
export function ruleActivityAbovePlan(context: RuleContext): Finding[] {
  const { dataset, thresholds } = context;
  return dataset.activities
    .filter((activity) => activity.plannedVolumeM3 > 0 && activity.harvestedVolumeM3 > 0)
    .filter((activity) => ratio(activity.harvestedVolumeM3, activity.plannedVolumeM3) > thresholds.activityPlanTolerance)
    .map((activity) => {
      const used = ratio(activity.harvestedVolumeM3, activity.plannedVolumeM3);
      return baseFinding({
        code: 'ACTIVITY_ABOVE_PLAN',
        type: AlertType.OPERATIONAL_ANOMALY,
        riskLevel: used > 2 ? RiskLevel.HIGH : RiskLevel.MODERATE,
        confidence: clamp01(0.5 + (used - thresholds.activityPlanTolerance) * 0.4),
        title: `Activity ${activity.reference} harvested above its declared plan`,
        description:
          `Activity ${activity.reference} declared a plan of ${activity.plannedVolumeM3} m³ and recorded ${activity.harvestedVolumeM3} m³ harvested ` +
          `(${round(used * 100, 1)} % of plan).`,
        reasoning: `harvestedVolumeM3 / plannedVolumeM3 = ${round(activity.harvestedVolumeM3, 2)} / ${round(activity.plannedVolumeM3, 2)} = ${round(used, 3)}.`,
        entityType: 'ExploitationActivity',
        entityId: activity.id,
        forestId: activity.forestId,
        zoneId: activity.zoneId,
        companyId: activity.companyId,
        permitId: activity.permitId,
        activityId: activity.id,
        latitude: activity.latitude,
        longitude: activity.longitude,
        evidence: [
          { label: 'Planned volume', value: `${activity.plannedVolumeM3} m³` },
          { label: 'Harvested volume', value: `${activity.harvestedVolumeM3} m³` },
          { label: 'Trees felled', value: String(activity.harvestedTreeCount) },
        ],
      });
    });
}

/** 5 — a planned activity that never started. */
export function ruleIdleActivity(context: RuleContext): Finding[] {
  const { dataset, thresholds, now } = context;
  return dataset.activities
    .filter((activity) => activity.status === 'PLANNED' && activity.actualStartDate === null)
    .filter((activity) => daysSince(activity.plannedStartDate, now) > thresholds.idleActivityDays)
    .map((activity) => {
      const overdue = daysSince(activity.plannedStartDate, now);
      return baseFinding({
        code: 'ACTIVITY_NOT_STARTED',
        type: AlertType.OPERATIONAL_ANOMALY,
        riskLevel: RiskLevel.LOW,
        confidence: 0.45,
        title: `Activity ${activity.reference} never started`,
        description: `The activity was planned for ${activity.plannedStartDate.toISOString().slice(0, 10)} and is still recorded as PLANNED ${overdue} days later.`,
        reasoning: `activity.status = PLANNED; plannedStartDate = ${activity.plannedStartDate.toISOString().slice(0, 10)}; delay = ${overdue} days (threshold ${thresholds.idleActivityDays}).`,
        entityType: 'ExploitationActivity',
        entityId: activity.id,
        forestId: activity.forestId,
        zoneId: activity.zoneId,
        companyId: activity.companyId,
        permitId: activity.permitId,
        activityId: activity.id,
        latitude: activity.latitude,
        longitude: activity.longitude,
        evidence: [
          { label: 'Planned start', value: activity.plannedStartDate.toISOString().slice(0, 10) },
          { label: 'Delay', value: `${overdue} days` },
        ],
      });
    });
}

/** 6 — fieldwork close to, or inside, a protected area. */
export function ruleProtectedAreaProximity(context: RuleContext): Finding[] {
  const { dataset, thresholds } = context;
  const protectedZones = new Set(dataset.zones.filter((zone) => zone.isProtected).map((zone) => zone.id));
  const findings: Finding[] = [];

  const nearest = (latitude: number, longitude: number): { area: ProtectedAreaRow; distanceM: number } | null => {
    let best: { area: ProtectedAreaRow; distanceM: number } | null = null;
    for (const area of dataset.protectedAreas) {
      const distanceM = haversineDistanceMeters({ latitude, longitude }, { latitude: area.latitude, longitude: area.longitude });
      if (!best || distanceM < best.distanceM) best = { area, distanceM };
    }
    return best;
  };

  const riskFor = (distanceM: number): RiskLevel =>
    distanceM <= 300 ? RiskLevel.CRITICAL : distanceM <= 600 ? RiskLevel.HIGH : RiskLevel.MODERATE;

  for (const activity of dataset.activities) {
    if (protectedZones.has(activity.zoneId ?? '')) {
      const zone = dataset.zones.find((item) => item.id === activity.zoneId);
      findings.push(
        baseFinding({
          code: 'ACTIVITY_IN_PROTECTED_ZONE',
          type: AlertType.PROTECTED_AREA_ENCROACHMENT,
          riskLevel: RiskLevel.HIGH,
          confidence: 0.75,
          title: `Exploitation recorded inside the protected zone ${zone?.name ?? ''}`.trim(),
          description:
            `Activity ${activity.reference} is recorded in zone ${zone?.code ?? activity.zoneId}, which the forest register marks as protected.`,
          reasoning: `zone.isProtected = true; activity.zoneId = ${activity.zoneId}; activity.status = ${activity.status}.`,
          entityType: 'ExploitationActivity',
          entityId: activity.id,
          forestId: activity.forestId,
          zoneId: activity.zoneId,
          companyId: activity.companyId,
          permitId: activity.permitId,
          activityId: activity.id,
          latitude: activity.latitude,
          longitude: activity.longitude,
          evidence: [
            { label: 'Zone', value: `${zone?.code ?? '—'} — ${zone?.name ?? '—'}` },
            { label: 'Activity status', value: activity.status },
          ],
        }),
      );
      continue;
    }

    const close = nearest(activity.latitude, activity.longitude);
    if (close && close.distanceM <= thresholds.protectedAreaBufferM) {
      findings.push(
        baseFinding({
          code: 'ACTIVITY_NEAR_PROTECTED_AREA',
          type: AlertType.PROTECTED_AREA_ENCROACHMENT,
          riskLevel: riskFor(close.distanceM),
          confidence: clamp01(close.distanceM <= 300 ? 0.85 : close.distanceM <= 600 ? 0.7 : 0.55),
          title: `Activity ${activity.reference} recorded ${Math.round(close.distanceM)} m from ${close.area.name}`,
          description:
            `Device GPS places ${activity.reference} (${activity.activityType}) ${Math.round(close.distanceM)} m from the reference point of ${close.area.name} ` +
            `(${close.area.type}, ${close.area.region}). The distance is computed with the Haversine formula from the coordinates stored on the record.`,
          reasoning:
            `haversine(activity ${activity.latitude}, ${activity.longitude} → area ${close.area.latitude}, ${close.area.longitude}) = ${Math.round(close.distanceM)} m; ` +
            `buffer = ${thresholds.protectedAreaBufferM} m.`,
          entityType: 'ExploitationActivity',
          entityId: activity.id,
          forestId: activity.forestId,
          zoneId: activity.zoneId,
          protectedAreaId: close.area.id,
          companyId: activity.companyId,
          permitId: activity.permitId,
          activityId: activity.id,
          latitude: activity.latitude,
          longitude: activity.longitude,
          evidence: [
            { label: 'Protected area', value: `${close.area.name} (${close.area.areaHa} ha)` },
            { label: 'Distance', value: `${Math.round(close.distanceM)} m` },
            { label: 'GPS source', value: activity.gpsSource },
          ],
        }),
      );
    }
  }

  for (const observation of dataset.observations) {
    const close = nearest(observation.latitude, observation.longitude);
    if (!close || close.distanceM > 600) continue;
    findings.push(
      baseFinding({
        code: 'OBSERVATION_NEAR_PROTECTED_AREA',
        type: AlertType.PROTECTED_AREA_ENCROACHMENT,
        riskLevel: riskFor(close.distanceM),
        confidence: clamp01(close.distanceM <= 300 ? 0.8 : 0.6),
        title: `Field observation recorded ${Math.round(close.distanceM)} m from ${close.area.name}`,
        description: `Observation "${observation.title}" (${observation.category}, severity ${observation.severity}) sits close to ${close.area.name}.`,
        reasoning: `haversine(observation → ${close.area.name}) = ${Math.round(close.distanceM)} m; captured ${observation.capturedAt.toISOString().slice(0, 10)}.`,
        entityType: 'FieldObservation',
        entityId: observation.id,
        forestId: observation.forestId,
        zoneId: observation.zoneId,
        protectedAreaId: close.area.id,
        observationId: observation.id,
        latitude: observation.latitude,
        longitude: observation.longitude,
        evidence: [
          { label: 'Category', value: observation.category },
          { label: 'Severity', value: observation.severity },
          { label: 'Distance', value: `${Math.round(close.distanceM)} m` },
        ],
      }),
    );
  }

  return findings;
}

/** 7 — money that should have been collected. */
export function rulePaymentArrears(context: RuleContext): Finding[] {
  const { dataset, thresholds, now } = context;
  const findings: Finding[] = [];

  for (const permit of dataset.permits) {
    const outstanding = round(permit.feeAmount - permit.amountPaid);
    if (outstanding <= 0) continue;
    const started = permit.startDate <= now;
    const overdueDays = daysSince(permit.startDate, now);
    if (!started || overdueDays < thresholds.paymentArrearsDays) continue;
    if (!['ACTIVE', 'PAYMENT_PENDING', 'APPROVED'].includes(permit.status)) continue;

    findings.push(
      baseFinding({
        code: 'PERMIT_FEE_OUTSTANDING',
        type: AlertType.PAYMENT_ANOMALY,
        riskLevel: overdueDays > 90 ? RiskLevel.HIGH : RiskLevel.MODERATE,
        confidence: clamp01(0.6 + overdueDays / 900),
        title: `Permit fee still unpaid ${overdueDays} days after the validity start (${permit.permitNumber})`,
        description:
          `${permit.companyName} still shows ${outstanding} XAF outstanding on permit ${permit.permitNumber} ` +
          `(${permit.feeAmount} XAF invoiced, ${permit.amountPaid} XAF settled by successful payments only).`,
        reasoning:
          `feeAmount − sum(successful payments) = ${permit.feeAmount} − ${permit.amountPaid} = ${outstanding} XAF; ` +
          `validity started ${permit.startDate.toISOString().slice(0, 10)} (${overdueDays} days ago, threshold ${thresholds.paymentArrearsDays}).`,
        entityType: 'ExploitationPermit',
        entityId: permit.id,
        forestId: permit.forestId,
        zoneId: permit.zoneId,
        companyId: permit.companyId,
        permitId: permit.id,
        evidence: [
          { label: 'Invoiced', value: `${permit.feeAmount} XAF` },
          { label: 'Settled', value: `${permit.amountPaid} XAF` },
          { label: 'Outstanding', value: `${outstanding} XAF` },
        ],
      }),
    );
  }

  for (const violation of dataset.violations) {
    const outstanding = round(violation.penaltyAmountXAF - violation.penaltyPaidXAF);
    if (outstanding <= 0 || !violation.companyId) continue;
    const overdueDays = daysSince(violation.detectedAt, now);
    if (overdueDays < thresholds.penaltyArrearsDays) continue;
    if (!['CONFIRMED', 'ESCALATED', 'RESOLVED'].includes(violation.status)) continue;

    findings.push(
      baseFinding({
        code: 'PENALTY_OUTSTANDING',
        type: AlertType.PAYMENT_ANOMALY,
        riskLevel: overdueDays > 120 ? RiskLevel.HIGH : RiskLevel.MODERATE,
        confidence: clamp01(0.55 + overdueDays / 1200),
        title: `Penalty of ${outstanding} XAF still outstanding on case ${violation.reference}`,
        description: `Case ${violation.reference} (${violation.status}) decided a penalty that successful payments do not yet cover.`,
        reasoning: `penaltyAmountXAF − settled penalty payments = ${violation.penaltyAmountXAF} − ${violation.penaltyPaidXAF} = ${outstanding} XAF; opening ${overdueDays} days ago.`,
        entityType: 'EnvironmentalViolation',
        entityId: violation.id,
        forestId: violation.forestId,
        companyId: violation.companyId,
        evidence: [
          { label: 'Case', value: violation.reference },
          { label: 'Severity', value: violation.severity },
          { label: 'Outstanding', value: `${outstanding} XAF` },
        ],
      }),
    );
  }

  return findings;
}

/** 8 — permits moving forward without their paperwork. */
export function ruleMissingDocuments(context: RuleContext): Finding[] {
  const { dataset, thresholds } = context;
  return dataset.permits
    .filter((permit) => ['ACTIVE', 'APPROVED', 'PAYMENT_PENDING'].includes(permit.status))
    .filter((permit) => permit.documentCount === 0 || permit.verifiedDocumentCount === 0)
    .map((permit) => {
      const missing = permit.documentCount === 0;
      return baseFinding({
        code: 'PERMIT_DOCUMENT_GAP',
        type: AlertType.DOCUMENT_ANOMALY,
        riskLevel: missing ? RiskLevel.MODERATE : RiskLevel.LOW,
        confidence: missing ? 0.7 : 0.5,
        title: missing
          ? `Permit ${permit.permitNumber} is ${permit.status.toLowerCase()} with no document on file`
          : `Permit ${permit.permitNumber} has no verified document`,
        description: missing
          ? `Permit ${permit.permitNumber} (${permit.companyName}) reached status ${permit.status} without any attachment in FEMS.`
          : `Permit ${permit.permitNumber} (${permit.companyName}) holds ${permit.documentCount} document(s) but none has been verified by an officer.`,
        reasoning: `documents = ${permit.documentCount}; verified = ${permit.verifiedDocumentCount}; permit.status = ${permit.status}.`,
        entityType: 'ExploitationPermit',
        entityId: permit.id,
        forestId: permit.forestId,
        zoneId: permit.zoneId,
        companyId: permit.companyId,
        permitId: permit.id,
        evidence: [
          { label: 'Documents', value: String(permit.documentCount) },
          { label: 'Verified', value: String(permit.verifiedDocumentCount) },
          { label: 'Status', value: permit.status },
        ],
      });
    })
    .filter((finding) => finding.confidence >= thresholds.minConfidence);
}

/** 9 — exploitation happening without field verification. */
export function ruleInspectionCoverage(context: RuleContext): Finding[] {
  const { dataset, thresholds, now } = context;
  const findings: Finding[] = [];

  for (const forest of dataset.forests) {
    const activities = dataset.activities.filter((activity) => activity.forestId === forest.id && activity.harvestedVolumeM3 > 0);
    if (activities.length === 0) continue;

    const lastInspection = dataset.inspections
      .filter((inspection) => inspection.forestId === forest.id && inspection.status === 'CLOSED' && inspection.completedAt)
      .map((inspection) => inspection.completedAt as Date)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const silenceDays = lastInspection ? daysSince(lastInspection, now) : null;
    if (lastInspection && silenceDays !== null && silenceDays <= thresholds.inspectionCoverageDays) continue;

    findings.push(
      baseFinding({
        code: 'INSPECTION_COVERAGE_GAP',
        type: AlertType.OPERATIONAL_ANOMALY,
        riskLevel: lastInspection ? RiskLevel.MODERATE : RiskLevel.HIGH,
        confidence: lastInspection ? 0.55 : 0.65,
        title: lastInspection
          ? `No inspection in ${forest.name} for ${silenceDays} days while harvesting continues`
          : `Harvesting recorded in ${forest.name} without any closed inspection`,
        description:
          `${activities.length} activity(ies) recorded harvest in ${forest.name} since ${dataset.window.from.toISOString().slice(0, 10)}, but ` +
          (lastInspection
            ? `the last closed inspection dates from ${lastInspection.toISOString().slice(0, 10)}.`
            : 'no closed inspection exists in the analysed period.'),
        reasoning: `activities with harvest = ${activities.length}; last closed inspection = ${lastInspection?.toISOString().slice(0, 10) ?? 'none'}; threshold = ${thresholds.inspectionCoverageDays} days.`,
        entityType: 'Forest',
        entityId: forest.id,
        forestId: forest.id,
        latitude: forest.latitude,
        longitude: forest.longitude,
        evidence: [
          { label: 'Harvesting activities', value: String(activities.length) },
          { label: 'Last closed inspection', value: lastInspection?.toISOString().slice(0, 10) ?? 'none' },
        ],
      }),
    );
  }

  return findings;
}

/** 10 — field reports that were never triaged, or that repeat the same position. */
export function ruleFieldReportQuality(context: RuleContext): Finding[] {
  const { dataset, thresholds, now } = context;
  const findings: Finding[] = [];

  const serious = dataset.observations.filter(
    (observation) =>
      ['HIGH', 'CRITICAL'].includes(observation.severity) &&
      observation.aiProcessedAt === null &&
      daysSince(observation.capturedAt, now) > thresholds.observationReviewDays,
  );

  for (const observation of serious) {
    findings.push(
      baseFinding({
        code: 'OBSERVATION_UNTRIAGED',
        type: AlertType.FIELD_REPORT_ANOMALY,
        riskLevel: observation.severity === 'CRITICAL' ? RiskLevel.HIGH : RiskLevel.MODERATE,
        confidence: 0.6,
        title: `Serious field observation not triaged for ${daysSince(observation.capturedAt, now)} days`,
        description:
          `Observation "${observation.title}" was captured with severity ${observation.severity} and has not been processed since.`,
        reasoning: `severity = ${observation.severity}; capturedAt = ${observation.capturedAt.toISOString().slice(0, 10)}; aiProcessedAt = null; threshold = ${thresholds.observationReviewDays} days.`,
        entityType: 'FieldObservation',
        entityId: observation.id,
        forestId: observation.forestId,
        zoneId: observation.zoneId,
        protectedAreaId: observation.protectedAreaId,
        observationId: observation.id,
        latitude: observation.latitude,
        longitude: observation.longitude,
        evidence: [
          { label: 'Category', value: observation.category },
          { label: 'Severity', value: observation.severity },
          { label: 'Days since capture', value: String(daysSince(observation.capturedAt, now)) },
        ],
      }),
    );
  }

  // The same position reported several times with the same category is either a
  // genuine hotspot or a copy-paste in the field app — either way an officer
  // should know that the records are not independent.
  const clusters = new Map<string, typeof dataset.observations>();
  for (const observation of dataset.observations) {
    const key = `${observation.category}:${round(observation.latitude, 3)}:${round(observation.longitude, 3)}`;
    clusters.set(key, [...(clusters.get(key) ?? []), observation]);
  }
  for (const [, group] of clusters) {
    if (group.length < 3) continue;
    const sample = group[0];
    findings.push(
      baseFinding({
        code: 'OBSERVATION_REPEATED_POSITION',
        type: AlertType.FIELD_REPORT_ANOMALY,
        riskLevel: RiskLevel.LOW,
        confidence: 0.4,
        title: `${group.length} observations share the same position and category`,
        description:
          `Category ${sample.category} was reported ${group.length} times from the same coordinates in ${sample.forestId ? 'the same forest' : 'the field'}. ` +
          'If they are not independent captures, the evidence base is weaker than it looks.',
        reasoning: `grouped by category + rounded coordinates (3 decimals ≈ 100 m): ${group.length} records.`,
        entityType: 'FieldObservation',
        entityId: sample.id,
        forestId: sample.forestId,
        zoneId: sample.zoneId,
        observationId: sample.id,
        latitude: sample.latitude,
        longitude: sample.longitude,
        evidence: [
          { label: 'Records in cluster', value: String(group.length) },
          { label: 'Category', value: sample.category },
          { label: 'Position', value: `${sample.latitude}, ${sample.longitude}` },
        ],
      }),
    );
  }

  return findings;
}

export interface AnalysisRule {
  code: string;
  label: string;
  alertType: AlertType;
  run: (context: RuleContext) => Finding[];
}

/** The catalogue of rules, in the order they are evaluated. */
export const ANALYSIS_RULES: AnalysisRule[] = [
  { code: 'PERMIT_OVER_HARVEST', label: 'Harvest above the approved volume', alertType: AlertType.OVER_HARVESTING, run: rulePermitOverHarvest },
  { code: 'FOREST_ALLOWABLE_CUT_EXCEEDED', label: 'Annual allowable cut reached', alertType: AlertType.DEFORESTATION_RISK, run: ruleForestAllowableCut },
  { code: 'ACTIVITY_ON_INVALID_PERMIT', label: 'Exploitation on an invalid permit', alertType: AlertType.PERMIT_VIOLATION, run: ruleActivityOnInvalidPermit },
  { code: 'ACTIVITY_ABOVE_PLAN', label: 'Activity above its declared plan', alertType: AlertType.OPERATIONAL_ANOMALY, run: ruleActivityAbovePlan },
  { code: 'ACTIVITY_NOT_STARTED', label: 'Planned activity never started', alertType: AlertType.OPERATIONAL_ANOMALY, run: ruleIdleActivity },
  { code: 'PROTECTED_AREA_PROXIMITY', label: 'Work close to a protected area', alertType: AlertType.PROTECTED_AREA_ENCROACHMENT, run: ruleProtectedAreaProximity },
  { code: 'PAYMENT_ARREARS', label: 'Fees or penalties outstanding', alertType: AlertType.PAYMENT_ANOMALY, run: rulePaymentArrears },
  { code: 'PERMIT_DOCUMENT_GAP', label: 'Permit without verified documents', alertType: AlertType.DOCUMENT_ANOMALY, run: ruleMissingDocuments },
  { code: 'INSPECTION_COVERAGE_GAP', label: 'Exploitation without field verification', alertType: AlertType.OPERATIONAL_ANOMALY, run: ruleInspectionCoverage },
  { code: 'FIELD_REPORT_QUALITY', label: 'Field reports awaiting triage', alertType: AlertType.FIELD_REPORT_ANOMALY, run: ruleFieldReportQuality },
];

export interface AnalysisOutcome {
  findings: Finding[];
  /** Findings that were dropped because they were already raised for the same record. */
  duplicates: number;
  byRisk: Record<RiskLevel, number>;
  byType: Record<string, number>;
  rulesEvaluated: number;
  warnings: string[];
}

export interface RunRulesOptions {
  thresholds?: AnalysisThresholds;
  /** Fingerprints already carried by an open alert — those findings are not re-raised. */
  knownFingerprints?: Set<string>;
  maxFindings?: number;
}

/**
 * Runs every rule over a scoped dataset, removes duplicates and sorts the
 * findings by risk then confidence. Pure: same dataset in, same findings out.
 */
export function runRules(dataset: IntelligenceDataset, options: RunRulesOptions = {}): AnalysisOutcome {
  const thresholds = options.thresholds ?? ANALYSIS_THRESHOLDS;
  const known = options.knownFingerprints ?? new Set<string>();
  const context: RuleContext = { dataset, now: dataset.generatedAt, thresholds };

  const collected: Finding[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const rule of ANALYSIS_RULES) {
    for (const finding of rule.run(context)) {
      if (finding.confidence < thresholds.minConfidence) continue;
      const fingerprint = findingFingerprint(finding);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      if (known.has(fingerprint)) {
        duplicates += 1;
        continue;
      }
      collected.push(finding);
    }
  }

  const maxFindings = options.maxFindings ?? thresholds.maxFindings;
  const sorted = collected.sort(
    (a, b) => riskWeight(b.riskLevel) - riskWeight(a.riskLevel) || b.confidence - a.confidence,
  );
  const findings = sorted.slice(0, maxFindings);

  const byRisk = { LOW: 0, MODERATE: 0, HIGH: 0, CRITICAL: 0 } as Record<RiskLevel, number>;
  const byType: Record<string, number> = {};
  for (const finding of findings) {
    byRisk[finding.riskLevel] += 1;
    byType[finding.type] = (byType[finding.type] ?? 0) + 1;
  }

  return {
    findings,
    duplicates,
    byRisk,
    byType,
    rulesEvaluated: ANALYSIS_RULES.length,
    warnings: [
      ...dataset.warnings,
      ...(sorted.length > findings.length ? [`Findings capped at ${maxFindings} (${sorted.length - findings.length} more were produced).`] : []),
    ],
  };
}

function riskWeight(level: RiskLevel): number {
  return level === RiskLevel.CRITICAL ? 3 : level === RiskLevel.HIGH ? 2 : level === RiskLevel.MODERATE ? 1 : 0;
}

/** Human summary of a run, used by the API, the reports and the PDF export. */
export function describeOutcome(outcome: AnalysisOutcome): string {
  const parts = Object.entries(outcome.byRisk)
    .filter(([, count]) => count > 0)
    .map(([level, count]) => `${count} ${level.toLowerCase()}`);
  if (outcome.findings.length === 0) {
    return `No anomaly found by the ${outcome.rulesEvaluated} rule(s) over the analysed records. This is not a certificate of compliance.`;
  }
  return `${outcome.findings.length} signal(s) raised by the deterministic rule engine (${parts.join(', ')}); each one awaits a human review.`;
}

/** Risk level of a whole run — the highest level among its findings. */
export function outcomeRisk(outcome: AnalysisOutcome): RiskLevel {
  const order: RiskLevel[] = [RiskLevel.LOW, RiskLevel.MODERATE, RiskLevel.HIGH, RiskLevel.CRITICAL];
  return order.reduce((worst, level) => (outcome.byRisk[level] > 0 ? level : worst), RiskLevel.LOW as RiskLevel);
}

/** Deterministic confidence of a run: mean confidence of its findings. */
export function outcomeConfidence(outcome: AnalysisOutcome): number {
  if (outcome.findings.length === 0) return 0;
  const total = outcome.findings.reduce((sum, finding) => sum + finding.confidence, 0);
  return Math.round((total / outcome.findings.length) * 100) / 100;
}

export type { ActivityRow, PermitRow };
