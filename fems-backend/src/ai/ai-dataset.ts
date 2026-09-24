import { Prisma, type RiskLevel } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The data a FEMS risk analysis runs on.
 *
 * Everything is read from the live database with the caller's scope already
 * applied (company, forest, zone, permit), converted to plain numbers and
 * capped — so the rule engine below is a pure function that can be unit-tested
 * without a database, and an officer can check every figure it used.
 */

export const MAX_ANALYSIS_ROWS = 1000;

export interface DatasetScope {
  forestId?: string;
  zoneId?: string;
  companyId?: string;
  permitId?: string;
  protectedAreaId?: string;
}

export interface DatasetOptions {
  periodDays: number;
  now?: Date;
  maxRows?: number;
}

export interface ForestRow {
  id: string;
  code: string;
  name: string;
  region: string;
  type: string;
  status: string;
  totalAreaHa: number;
  annualAllowableCutM3: number | null;
  latitude: number;
  longitude: number;
}

export interface ZoneRow {
  id: string;
  forestId: string;
  code: string;
  name: string;
  status: string;
  areaHa: number;
  maxAnnualYieldM3: number | null;
  isProtected: boolean;
  latitude: number;
  longitude: number;
}

export interface ProtectedAreaRow {
  id: string;
  code: string;
  name: string;
  type: string;
  region: string;
  areaHa: number;
  latitude: number;
  longitude: number;
  encroachmentRisk: RiskLevel;
}

export interface PermitRow {
  id: string;
  permitNumber: string;
  type: string;
  status: string;
  companyId: string;
  companyName: string;
  forestId: string;
  zoneId: string | null;
  volumeApprovedM3: number | null;
  volumeRequestedM3: number;
  feeAmount: number;
  amountPaid: number;
  startDate: Date;
  endDate: Date;
  documentCount: number;
  verifiedDocumentCount: number;
}

export interface ActivityRow {
  id: string;
  reference: string;
  permitId: string;
  companyId: string;
  forestId: string;
  zoneId: string | null;
  activityType: string;
  status: string;
  plannedVolumeM3: number;
  harvestedVolumeM3: number;
  harvestedTreeCount: number;
  plannedStartDate: Date;
  actualStartDate: Date | null;
  actualEndDate: Date | null;
  latitude: number;
  longitude: number;
  gpsSource: string;
  locationAccuracyM: number | null;
}

export interface InspectionRow {
  id: string;
  reference: string;
  type: string;
  status: string;
  outcome: string | null;
  complianceScore: number | null;
  forestId: string;
  zoneId: string | null;
  companyId: string | null;
  permitId: string | null;
  scheduledFor: Date | null;
  completedAt: Date | null;
}

export interface ViolationRow {
  id: string;
  reference: string;
  status: string;
  severity: string;
  companyId: string | null;
  forestId: string | null;
  detectedAt: Date;
  remediationRequired: boolean;
  remediationDeadline: Date | null;
  penaltyAmountXAF: number;
  penaltyPaidXAF: number;
}

export interface PaymentRow {
  id: string;
  reference: string;
  purpose: string;
  status: string;
  amount: number;
  currency: string;
  permitId: string | null;
  companyId: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface ObservationRow {
  id: string;
  title: string;
  category: string;
  severity: string;
  forestId: string;
  zoneId: string | null;
  protectedAreaId: string | null;
  activityId: string | null;
  latitude: number;
  longitude: number;
  locationAccuracyM: number | null;
  capturedAt: Date;
  aiProcessedAt: Date | null;
}

export interface IntelligenceDataset {
  generatedAt: Date;
  periodDays: number;
  window: { from: Date; to: Date };
  scope: DatasetScope;
  forests: ForestRow[];
  zones: ZoneRow[];
  protectedAreas: ProtectedAreaRow[];
  permits: PermitRow[];
  activities: ActivityRow[];
  inspections: InspectionRow[];
  violations: ViolationRow[];
  payments: PaymentRow[];
  observations: ObservationRow[];
  /** Anything that limits the analysis (row caps, missing reference data). */
  warnings: string[];
}

const num = (value: Prisma.Decimal | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Math.round(Number(value) * 100) / 100;

const day = 86_400_000;

/**
 * Reads the analysis window from the database. `scope.companyId` is the caller's
 * own company when the caller is a company account — the service sets it, never
 * the client.
 */
export async function buildIntelligenceDataset(
  prisma: PrismaService,
  scope: DatasetScope,
  options: DatasetOptions,
): Promise<IntelligenceDataset> {
  const now = options.now ?? new Date();
  const maxRows = options.maxRows ?? MAX_ANALYSIS_ROWS;
  const from = new Date(now.getTime() - options.periodDays * day);
  const warnings: string[] = [];

  const permitWhere: Prisma.ExploitationPermitWhereInput = {
    deletedAt: null,
    id: scope.permitId,
    forestId: scope.forestId,
    zoneId: scope.zoneId,
    companyId: scope.companyId,
    endDate: { gte: from },
  };

  const permitsRaw = await prisma.exploitationPermit.findMany({
    where: permitWhere,
    include: {
      company: { select: { id: true, name: true } },
      documents: { where: { deletedAt: null }, select: { id: true, isVerified: true } },
      payments: { where: { status: 'SUCCESSFUL' }, select: { amount: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: maxRows + 1,
  });
  if (permitsRaw.length > maxRows) {
    warnings.push(`Only the ${maxRows} most recent permits were analysed.`);
  }
  const permits: PermitRow[] = permitsRaw.slice(0, maxRows).map((permit) => ({
    id: permit.id,
    permitNumber: permit.permitNumber,
    type: permit.type,
    status: permit.status,
    companyId: permit.companyId,
    companyName: permit.company?.name ?? '—',
    forestId: permit.forestId,
    zoneId: permit.zoneId,
    volumeApprovedM3: permit.volumeApprovedM3 === null ? null : num(permit.volumeApprovedM3),
    volumeRequestedM3: num(permit.volumeRequestedM3),
    feeAmount: num(permit.feeAmount),
    amountPaid: permit.payments.reduce((sum, payment) => sum + num(payment.amount), 0),
    startDate: permit.startDate,
    endDate: permit.endDate,
    documentCount: permit.documents.length,
    verifiedDocumentCount: permit.documents.filter((document) => document.isVerified).length,
  }));

  const forestWhere: Prisma.ForestWhereInput = {
    deletedAt: null,
    id: scope.forestId ?? (permits.length ? { in: [...new Set(permits.map((permit) => permit.forestId))] } : undefined),
  };
  const forestsRaw = await prisma.forest.findMany({
    where: forestWhere,
    orderBy: { name: 'asc' },
    take: maxRows,
  });
  const forests: ForestRow[] = forestsRaw.map((forest) => ({
    id: forest.id,
    code: forest.code,
    name: forest.name,
    region: forest.region,
    type: forest.type,
    status: forest.status,
    totalAreaHa: num(forest.totalAreaHa),
    annualAllowableCutM3: forest.annualAllowableCutM3 === null ? null : num(forest.annualAllowableCutM3),
    latitude: Number(forest.latitude),
    longitude: Number(forest.longitude),
  }));

  const scopeForestIds = forests.length ? forests.map((forest) => forest.id) : undefined;

  const zonesRaw = await prisma.forestZone.findMany({
    where: { deletedAt: null, forestId: scope.forestId ?? (scopeForestIds ? { in: scopeForestIds } : undefined), id: scope.zoneId },
    take: maxRows,
  });
  const zones: ZoneRow[] = zonesRaw.map((zone) => ({
    id: zone.id,
    forestId: zone.forestId,
    code: zone.code,
    name: zone.name,
    status: zone.status,
    areaHa: num(zone.areaHa),
    maxAnnualYieldM3: zone.maxAnnualYieldM3 === null ? null : num(zone.maxAnnualYieldM3),
    isProtected: zone.isProtected,
    latitude: Number(zone.latitude),
    longitude: Number(zone.longitude),
  }));

  const protectedAreasRaw = await prisma.protectedArea.findMany({
    where: { deletedAt: null, status: 'ACTIVE', id: scope.protectedAreaId },
    take: 200,
  });
  const protectedAreas: ProtectedAreaRow[] = protectedAreasRaw.map((area) => ({
    id: area.id,
    code: area.code,
    name: area.name,
    type: area.type,
    region: area.region,
    areaHa: num(area.areaHa),
    latitude: Number(area.latitude),
    longitude: Number(area.longitude),
    encroachmentRisk: area.encroachmentRisk,
  }));

  const activitiesRaw = await prisma.exploitationActivity.findMany({
    where: {
      deletedAt: null,
      permitId: scope.permitId,
      forestId: scope.forestId ?? (scopeForestIds ? { in: scopeForestIds } : undefined),
      zoneId: scope.zoneId,
      companyId: scope.companyId,
      OR: [{ actualEndDate: null }, { actualEndDate: { gte: from } }],
    },
    orderBy: { plannedStartDate: 'desc' },
    take: maxRows + 1,
  });
  if (activitiesRaw.length > maxRows) {
    warnings.push(`Only the ${maxRows} most recent exploitation activities were analysed.`);
  }
  const activities: ActivityRow[] = activitiesRaw.slice(0, maxRows).map((activity) => ({
    id: activity.id,
    reference: activity.reference,
    permitId: activity.permitId,
    companyId: activity.companyId,
    forestId: activity.forestId,
    zoneId: activity.zoneId,
    activityType: activity.activityType,
    status: activity.status,
    plannedVolumeM3: num(activity.plannedVolumeM3),
    harvestedVolumeM3: num(activity.harvestedVolumeM3),
    harvestedTreeCount: activity.harvestedTreeCount,
    plannedStartDate: activity.plannedStartDate,
    actualStartDate: activity.actualStartDate,
    actualEndDate: activity.actualEndDate,
    latitude: Number(activity.latitude),
    longitude: Number(activity.longitude),
    gpsSource: activity.gpsSource,
    locationAccuracyM: activity.locationAccuracyM === null ? null : num(activity.locationAccuracyM),
  }));

  const inspectionsRaw = await prisma.inspection.findMany({
    where: {
      deletedAt: null,
      forestId: scope.forestId ?? (scopeForestIds ? { in: scopeForestIds } : undefined),
      zoneId: scope.zoneId,
      companyId: scope.companyId,
      permitId: scope.permitId,
      OR: [
        { scheduledFor: { gte: from } },
        { completedAt: { gte: from } },
        { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: maxRows,
  });

  const violationsRaw = await prisma.environmentalViolation.findMany({
    where: {
      deletedAt: null,
      forestId: scope.forestId ?? (scopeForestIds ? { in: scopeForestIds } : undefined),
      zoneId: scope.zoneId,
      companyId: scope.companyId,
      permitId: scope.permitId,
      detectedAt: { gte: from },
    },
    include: { payments: { where: { status: 'SUCCESSFUL' }, select: { amount: true } } },
    orderBy: { detectedAt: 'desc' },
    take: maxRows,
  });
  const violations: ViolationRow[] = violationsRaw.map((violation) => ({
    id: violation.id,
    reference: violation.reference,
    status: violation.status,
    severity: violation.severity,
    companyId: violation.companyId,
    forestId: violation.forestId,
    detectedAt: violation.detectedAt,
    remediationRequired: violation.remediationRequired,
    remediationDeadline: violation.remediationDeadline,
    penaltyAmountXAF: num(violation.penaltyAmountXAF),
    penaltyPaidXAF: violation.payments.reduce((sum, payment) => sum + num(payment.amount), 0),
  }));

  const paymentsRaw = await prisma.payment.findMany({
    where: {
      permitId: scope.permitId,
      companyId: scope.companyId,
      OR: [{ paidAt: { gte: from } }, { createdAt: { gte: from } }],
    },
    orderBy: { createdAt: 'desc' },
    take: maxRows,
  });
  const payments: PaymentRow[] = paymentsRaw.map((payment) => ({
    id: payment.id,
    reference: payment.reference,
    purpose: payment.purpose,
    status: payment.status,
    amount: num(payment.amount),
    currency: payment.currency,
    permitId: payment.permitId,
    companyId: payment.companyId,
    paidAt: payment.paidAt,
    createdAt: payment.createdAt,
  }));

  const observationsRaw = await prisma.fieldObservation.findMany({
    where: {
      forestId: scope.forestId ?? (scopeForestIds ? { in: scopeForestIds } : undefined),
      zoneId: scope.zoneId,
      protectedAreaId: scope.protectedAreaId,
      capturedAt: { gte: from },
    },
    orderBy: { capturedAt: 'desc' },
    take: maxRows,
  });

  return {
    generatedAt: now,
    periodDays: options.periodDays,
    window: { from, to: now },
    scope,
    forests,
    zones,
    protectedAreas,
    permits,
    activities,
    inspections: inspectionsRaw.map((inspection) => ({
      id: inspection.id,
      reference: inspection.reference,
      type: inspection.type,
      status: inspection.status,
      outcome: inspection.outcome,
      complianceScore: inspection.complianceScore,
      forestId: inspection.forestId,
      zoneId: inspection.zoneId,
      companyId: inspection.companyId,
      permitId: inspection.permitId,
      scheduledFor: inspection.scheduledFor,
      completedAt: inspection.completedAt,
    })),
    violations,
    payments,
    observations: observationsRaw.map((observation) => ({
      id: observation.id,
      title: observation.title,
      category: observation.category,
      severity: observation.severity,
      forestId: observation.forestId,
      zoneId: observation.zoneId,
      protectedAreaId: observation.protectedAreaId,
      activityId: observation.activityId,
      latitude: Number(observation.latitude),
      longitude: Number(observation.longitude),
      locationAccuracyM: observation.locationAccuracyM === null ? null : num(observation.locationAccuracyM),
      capturedAt: observation.capturedAt,
      aiProcessedAt: observation.aiProcessedAt,
    })),
    warnings,
  };
}
