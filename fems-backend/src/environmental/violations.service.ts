import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AuditAction,
  AuditSeverity,
  GpsSource,
  NotificationType,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  ViolationSeverity,
  ViolationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GisService } from '../gis/gis.service';
import { References, uniqueReference } from '../common/utils/reference.util';
import { assertCoordinates, evaluateGpsAccuracy, GPS_MAX_ACCURACY_M } from '../common/utils/geo.util';
import {
  assertCanManuallyCorrectCoordinates,
  canReadAll,
  hasAnyPermission,
} from '../common/utils/access-scope.util';
import { resolveOrderBy } from '../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/decorators';
import {
  ACTIVE_VIOLATION_STATUSES,
  VIOLATION_TRANSITIONS,
  checkRemediationReported,
  checkResolvable,
  checkViolationTransition,
  computePenaltyStatus,
  isRemediationOverdue,
  recommendedRemediationDeadline,
  type ViolationAction,
} from './violation-state';
import type {
  CreateViolationDto,
  UpdateViolationDto,
  ViolationActionDto,
  ViolationQueryDto,
} from './dto/violation.dto';

const VIOLATION_INCLUDE = {
  forest: { select: { id: true, code: true, name: true, region: true } },
  zone: { select: { id: true, code: true, name: true } },
  protectedArea: { select: { id: true, name: true, type: true } },
  company: { select: { id: true, name: true, status: true } },
  permit: { select: { id: true, permitNumber: true, status: true } },
  activity: { select: { id: true, reference: true, activityType: true, status: true } },
  inspection: { select: { id: true, reference: true, status: true, outcome: true } },
  observation: { select: { id: true, title: true, category: true, severity: true } },
  detectedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  resolvedBy: { select: { id: true, firstName: true, lastName: true } },
  evidences: { where: { deletedAt: null }, select: { id: true, type: true, fileUrl: true, caption: true, capturedAt: true } },
  payments: {
    where: { status: PaymentStatus.SUCCESSFUL },
    select: { id: true, reference: true, amount: true, currency: true, paidAt: true, receiptNumber: true },
  },
} satisfies Prisma.EnvironmentalViolationInclude;

/**
 * Environmental violations.
 *
 * A violation is opened from documented field evidence, investigated, then
 * confirmed or dismissed by an officer. Everything that matters is enforced
 * here rather than in the app: the lifecycle table, the penalty position
 * (settled by real payments, never by client input), the remediation deadline,
 * and the rule that only a human decides whether an organisation is in breach.
 */
@Injectable()
export class ViolationsService {
  private readonly logger = new Logger(ViolationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly gis: GisService,
  ) {}

  // ------------------------------------------------------------------ reads

  async list(user: AuthenticatedUser, query: ViolationQueryDto) {
    const where: Prisma.EnvironmentalViolationWhereInput = {
      deletedAt: null,
      status: query.status,
      severity: query.severity,
      forestId: query.forestId,
      permitId: query.permitId,
      activityId: query.activityId,
      inspectionId: query.inspectionId,
      observationId: query.observationId,
      ...this.scope(user, { companyId: query.companyId, detectedById: query.detectedById }),
      detectedAt:
        query.from || query.to
          ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
          : undefined,
      ...(query.overdueRemediation === 'true'
        ? { remediationRequired: true, remediationDeadline: { lt: new Date() }, status: { in: ACTIVE_VIOLATION_STATUSES } }
        : {}),
      ...(query.search
        ? { OR: [{ reference: { contains: query.search } }, { title: { contains: query.search } }] }
        : {}),
    };

    const [rows, total, penalties] = await Promise.all([
      this.prisma.environmentalViolation.findMany({
        where,
        include: VIOLATION_INCLUDE,
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, ['detectedAt', 'severity', 'status'], 'detectedAt'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.environmentalViolation.count({ where }),
      this.penaltySummary(where),
    ]);

    const items = rows.map((violation) => ({
      ...violation,
      penalty: this.penaltyOf(violation),
      remediationOverdue: isRemediationOverdue(violation),
    }));

    return { items, total, penalties };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const violation = await this.prisma.environmentalViolation.findFirst({
      where: { id, deletedAt: null },
      include: VIOLATION_INCLUDE,
    });
    if (!violation) throw new NotFoundException({ code: 'VIOLATION_NOT_FOUND', message: 'Violation not found.' });
    this.assertVisible(user, violation);

    const penalty = computePenaltyStatus(
      violation.penaltyAmountXAF === null ? 0 : Number(violation.penaltyAmountXAF),
      violation.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    );

    // AI alerts only ever *reference* a case a human opened — the alert never
    // creates the violation, so the link is read from the alert side.
    const linkedAlerts = await this.prisma.aIAlert.findMany({
      where: { violationId: id },
      select: { id: true, reference: true, type: true, status: true, riskLevel: true, detectedAt: true, reviewedAt: true },
      orderBy: { detectedAt: 'desc' },
      take: 20,
    });

    return {
      ...violation,
      penalty,
      linkedAlerts,
      remediationOverdue: isRemediationOverdue(violation),
      actions: this.availableActions(user, violation),
    };
  }

  /** Actions the caller is allowed to perform, exactly like GET /permits/:id/actions. */
  listActions(user: AuthenticatedUser, violation: { status: ViolationStatus }) {
    return this.availableActions(user, violation);
  }

  // --------------------------------------------------------------- lifecycle

  async create(user: AuthenticatedUser, dto: CreateViolationDto) {
    if (!dto.inspectionId && !dto.observationId) {
      throw new BadRequestException({
        code: 'VIOLATION_SOURCE_REQUIRED',
        message:
          'A violation must be raised from documented field evidence: provide the inspection or the observation that recorded the facts.',
      });
    }

    const forest = await this.prisma.forest.findFirst({
      where: { id: dto.forestId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!forest) throw new NotFoundException({ code: 'FOREST_NOT_FOUND', message: 'Forest not found.' });

    if (dto.inspectionId) {
      const inspection = await this.prisma.inspection.findFirst({
        where: { id: dto.inspectionId, deletedAt: null },
        select: { id: true, forestId: true, reference: true, companyId: true },
      });
      if (!inspection) throw new NotFoundException({ code: 'INSPECTION_NOT_FOUND', message: 'Inspection not found.' });
      if (inspection.forestId !== dto.forestId) {
        throw new BadRequestException({
          code: 'INSPECTION_FOREST_MISMATCH',
          message: `Inspection ${inspection.reference} was carried out in another forest.`,
        });
      }
    }
    if (dto.observationId) {
      const observation = await this.prisma.fieldObservation.findUnique({
        where: { id: dto.observationId },
        select: { id: true, forestId: true, title: true },
      });
      if (!observation) throw new NotFoundException({ code: 'OBSERVATION_NOT_FOUND', message: 'Observation not found.' });
      if (observation.forestId !== dto.forestId) {
        throw new BadRequestException({
          code: 'OBSERVATION_FOREST_MISMATCH',
          message: `Observation "${observation.title}" was recorded in another forest.`,
        });
      }
    }
    if (dto.aiAlertId) {
      const alert = await this.prisma.aIAlert.findUnique({ where: { id: dto.aiAlertId }, select: { id: true } });
      if (!alert) throw new NotFoundException({ code: 'AI_ALERT_NOT_FOUND', message: 'AI alert not found.' });
    }
    if (dto.permitId) {
      const permit = await this.prisma.exploitationPermit.findFirst({
        where: { id: dto.permitId, deletedAt: null },
        select: { companyId: true, id: true },
      });
      if (!permit) throw new NotFoundException({ code: 'PERMIT_NOT_FOUND', message: 'Permit not found.' });
    }
    if (dto.companyId) {
      const company = await this.prisma.company.findFirst({ where: { id: dto.companyId, deletedAt: null }, select: { id: true } });
      if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });
    }

    assertCoordinates(dto.latitude, dto.longitude, 'violation position');
    const gpsSource = dto.gpsSource ?? GpsSource.DEVICE_GPS;
    if (gpsSource !== GpsSource.DEVICE_GPS && gpsSource !== GpsSource.SEED_DEMO) {
      assertCanManuallyCorrectCoordinates(user, 'environmental');
    }
    const accuracy = evaluateGpsAccuracy(dto.locationAccuracyM);
    if (!accuracy.accepted) {
      throw new BadRequestException({
        code: 'GPS_ACCURACY_TOO_LOW',
        message: accuracy.warning,
        details: { accuracyM: dto.locationAccuracyM, requiredAccuracyM: GPS_MAX_ACCURACY_M },
      });
    }

    const detectedAt = dto.detectedAt ? new Date(dto.detectedAt) : new Date();
    const remediationRequired = dto.remediationRequired ?? false;
    const remediationDeadline = remediationRequired
      ? dto.remediationDeadline
        ? new Date(dto.remediationDeadline)
        : recommendedRemediationDeadline(dto.severity, detectedAt)
      : null;

    const reference = await uniqueReference(
      () => References.violation(),
      async (candidate) => (await this.prisma.environmentalViolation.count({ where: { reference: candidate } })) === 0,
    );

    const violation = await this.prisma.environmentalViolation.create({
      data: {
        reference,
        title: dto.title,
        description: dto.description,
        severity: dto.severity,
        status: ViolationStatus.OPEN,
        forestId: dto.forestId,
        zoneId: dto.zoneId,
        protectedAreaId: dto.protectedAreaId,
        companyId: dto.companyId,
        permitId: dto.permitId,
        activityId: dto.activityId,
        inspectionId: dto.inspectionId,
        observationId: dto.observationId,
        aiAlertId: dto.aiAlertId,
        latitude: new Prisma.Decimal(dto.latitude),
        longitude: new Prisma.Decimal(dto.longitude),
        detectedAt,
        detectedById: user.id,
        estimatedDamageXAF:
          dto.estimatedDamageXAF === undefined ? null : new Prisma.Decimal(dto.estimatedDamageXAF),
        penaltyAmountXAF: dto.penaltyAmountXAF === undefined ? null : new Prisma.Decimal(dto.penaltyAmountXAF),
        remediationRequired,
        remediationDeadline,
        remediationNotes: dto.remediationNotes,
        investigationNotes: dto.investigationNotes,
      },
      include: VIOLATION_INCLUDE,
    });

    await this.gis.recordFeature({
      featureType: 'ENVIRONMENTAL_VIOLATION',
      entityId: violation.id,
      label: `${violation.reference} — ${violation.title}`,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracyM: dto.locationAccuracyM ?? null,
      source: gpsSource,
      forestId: violation.forestId,
      zoneId: violation.zoneId,
      protectedAreaId: violation.protectedAreaId,
      violationId: violation.id,
      recordedById: user.id,
      metadata: { severity: violation.severity, status: violation.status },
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      severity:
        dto.severity === ViolationSeverity.HIGH || dto.severity === ViolationSeverity.CRITICAL
          ? AuditSeverity.CRITICAL
          : AuditSeverity.WARNING,
      entityType: 'EnvironmentalViolation',
      entityId: violation.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Recorded violation ${violation.reference} (${violation.severity}) on ${forest.name}`,
      after: {
        severity: violation.severity,
        status: violation.status,
        companyId: violation.companyId,
        estimatedDamageXAF: violation.estimatedDamageXAF === null ? null : Number(violation.estimatedDamageXAF),
        penaltyAmountXAF: violation.penaltyAmountXAF === null ? null : Number(violation.penaltyAmountXAF),
        inspectionId: violation.inspectionId,
        observationId: violation.observationId,
        aiAlertId: violation.aiAlertId,
      },
    });

    await this.notifyOpening(violation, forest.name);

    return violation;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateViolationDto) {
    const violation = await this.prisma.environmentalViolation.findFirst({ where: { id, deletedAt: null } });
    if (!violation) throw new NotFoundException({ code: 'VIOLATION_NOT_FOUND', message: 'Violation not found.' });
    this.assertVisible(user, violation);

    if (violation.status === ViolationStatus.RESOLVED && dto.severity) {
      throw new BadRequestException({
        code: 'VIOLATION_NOT_EDITABLE',
        message: 'A resolved case is closed record: reopen it before changing its severity.',
      });
    }

    const remediationRequired = dto.remediationRequired ?? violation.remediationRequired;
    const remediationDeadline = dto.remediationDeadline
      ? new Date(dto.remediationDeadline)
      : dto.remediationRequired === true && !violation.remediationDeadline
        ? recommendedRemediationDeadline(dto.severity ?? violation.severity)
        : undefined;

    const updated = await this.prisma.environmentalViolation.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        severity: dto.severity,
        zoneId: dto.zoneId,
        companyId: dto.companyId,
        permitId: dto.permitId,
        activityId: dto.activityId,
        estimatedDamageXAF: dto.estimatedDamageXAF === undefined ? undefined : new Prisma.Decimal(dto.estimatedDamageXAF),
        penaltyAmountXAF: dto.penaltyAmountXAF === undefined ? undefined : new Prisma.Decimal(dto.penaltyAmountXAF),
        remediationRequired: dto.remediationRequired === undefined ? undefined : remediationRequired,
        remediationDeadline,
        remediationNotes: dto.remediationNotes,
        investigationNotes: dto.investigationNotes,
      },
      include: VIOLATION_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'EnvironmentalViolation',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Updated violation ${violation.reference}`,
      before: { severity: violation.severity, status: violation.status },
      after: { severity: updated.severity, status: updated.status },
    });

    return updated;
  }

  async action(user: AuthenticatedUser, id: string, action: string, dto: ViolationActionDto) {
    const normalised = action.toUpperCase();
    const violation = await this.prisma.environmentalViolation.findFirst({
      where: { id, deletedAt: null },
      include: VIOLATION_INCLUDE,
    });
    if (!violation) throw new NotFoundException({ code: 'VIOLATION_NOT_FOUND', message: 'Violation not found.' });
    this.assertVisible(user, violation);

    const unknownAction = checkViolationTransition(normalised, violation.status, dto.reason);
    if (unknownAction.code === 'VIOLATION_ACTION_UNKNOWN') {
      throw new BadRequestException({ code: unknownAction.code, message: unknownAction.message });
    }

    // Authorization comes before the state machine: a caller who may not perform
    // the action never learns anything about the current status of the case.
    const spec = VIOLATION_TRANSITIONS[normalised as ViolationAction];
    if (!hasAnyPermission(user, spec.permissions)) {
      throw new ForbiddenException({
        code: 'VIOLATION_ACTION_FORBIDDEN',
        message: `Action ${spec.action} requires one of: ${spec.permissions.join(', ')}.`,
      });
    }

    const transition = checkViolationTransition(normalised, violation.status, dto.reason);
    if (!transition.ok || !transition.transition) {
      throw new BadRequestException({
        code: transition.code,
        message: transition.message,
        details: { currentStatus: violation.status, action: normalised, expectedFrom: transition.transition?.from ?? [] },
      });
    }

    const penalty = computePenaltyStatus(
      violation.penaltyAmountXAF === null ? 0 : Number(violation.penaltyAmountXAF),
      violation.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    );

    if (spec.action === 'RESOLVE') {
      const resolvable = checkResolvable(penalty, { waivePenalty: dto.waivePenalty, reason: dto.reason });
      if (!resolvable.ok) {
        throw new ConflictException({
          code: resolvable.code,
          message: resolvable.message,
          details: { outstandingXAF: resolvable.outstandingXAF, penaltyAmountXAF: penalty.penaltyAmountXAF },
        });
      }
      const remediation = checkRemediationReported({
        remediationRequired: violation.remediationRequired,
        remediationNotes: dto.remediationNotes ?? violation.remediationNotes,
      });
      if (!remediation.ok) {
        throw new BadRequestException({ code: remediation.code, message: remediation.message });
      }
    }

    const now = new Date();
    const severity = dto.severity ?? violation.severity;
    const remediationRequired = dto.remediationRequired ?? violation.remediationRequired;

    const updated = await this.prisma.environmentalViolation.update({
      where: { id },
      data: {
        status: spec.to,
        severity: dto.severity,
        estimatedDamageXAF:
          dto.estimatedDamageXAF === undefined ? undefined : new Prisma.Decimal(dto.estimatedDamageXAF),
        penaltyAmountXAF:
          dto.penaltyAmountXAF === undefined ? undefined : new Prisma.Decimal(dto.penaltyAmountXAF),
        remediationRequired: dto.remediationRequired === undefined ? undefined : remediationRequired,
        remediationDeadline: dto.remediationDeadline
          ? new Date(dto.remediationDeadline)
          : dto.remediationRequired === true && !violation.remediationDeadline
            ? recommendedRemediationDeadline(severity, now)
            : undefined,
        remediationNotes: dto.remediationNotes ?? violation.remediationNotes,
        investigationNotes: this.appendNote(violation.investigationNotes, spec.action, dto.reason, dto.investigationNotes),
        resolvedAt: spec.action === 'RESOLVE' ? now : spec.action === 'REOPEN' ? null : undefined,
        resolvedById: spec.action === 'RESOLVE' ? user.id : spec.action === 'REOPEN' ? null : undefined,
        resolutionSummary: spec.action === 'RESOLVE' ? dto.reason : undefined,
      },
      include: VIOLATION_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      severity:
        spec.action === 'DISMISS'
          ? AuditSeverity.WARNING
          : spec.action === 'CONFIRM' || spec.action === 'ESCALATE'
            ? AuditSeverity.CRITICAL
            : AuditSeverity.INFO,
      entityType: 'EnvironmentalViolation',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `${spec.action}: violation ${violation.reference} ${violation.status} → ${spec.to}`,
      before: { status: violation.status, severity: violation.severity },
      after: {
        status: spec.to,
        severity: updated.severity,
        reason: dto.reason ?? null,
        penaltyAmountXAF: updated.penaltyAmountXAF === null ? null : Number(updated.penaltyAmountXAF),
        waivePenalty: dto.waivePenalty ?? false,
        outstandingPenaltyXAF: spec.action === 'RESOLVE' ? penalty.outstandingXAF : undefined,
      },
    });

    await this.notifyTransition(updated, spec.action, dto.reason);

    return { ...updated, penalty: this.penaltyOf(updated) };
  }

  async remove(user: AuthenticatedUser, id: string) {
    const violation = await this.prisma.environmentalViolation.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { payments: true, evidences: true } } },
    });
    if (!violation) throw new NotFoundException({ code: 'VIOLATION_NOT_FOUND', message: 'Violation not found.' });
    if (violation.status !== ViolationStatus.OPEN) {
      throw new ConflictException({
        code: 'VIOLATION_NOT_DELETABLE',
        message: `Only an OPEN case can be withdrawn (current status: ${violation.status}). Dismiss a case that has already been reviewed instead.`,
      });
    }
    if (violation._count.payments > 0) {
      throw new ConflictException({
        code: 'VIOLATION_HAS_PAYMENTS',
        message: 'This case has payments attached and cannot be withdrawn.',
      });
    }

    await this.prisma.environmentalViolation.update({
      where: { id },
      data: { deletedAt: new Date(), status: ViolationStatus.DISMISSED },
    });

    await this.audit.record({
      action: AuditAction.DELETE,
      severity: AuditSeverity.WARNING,
      entityType: 'EnvironmentalViolation',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Withdrew violation ${violation.reference} (recorded in error)`,
      before: { status: violation.status, title: violation.title },
    });

    return { id, deleted: true };
  }

  /** Penalty position of a case, based on payments that the provider settled. */
  async penaltyPosition(violationId: string) {
    const violation = await this.prisma.environmentalViolation.findFirst({
      where: { id: violationId, deletedAt: null },
      select: { penaltyAmountXAF: true, payments: { where: { status: PaymentStatus.SUCCESSFUL }, select: { amount: true } } },
    });
    if (!violation) throw new NotFoundException({ code: 'VIOLATION_NOT_FOUND', message: 'Violation not found.' });
    return computePenaltyStatus(
      violation.penaltyAmountXAF === null ? 0 : Number(violation.penaltyAmountXAF),
      violation.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    );
  }

  // -------------------------------------------------------------- statistics

  async statistics(user: AuthenticatedUser, query: ViolationQueryDto) {
    const where: Prisma.EnvironmentalViolationWhereInput = { deletedAt: null, ...this.scope(user, {}) };

    const [byStatus, bySeverity, totals, penalties, byRegion, monthly] = await Promise.all([
      this.prisma.environmentalViolation.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.environmentalViolation.groupBy({ by: ['severity'], where, _count: { _all: true } }),
      this.prisma.environmentalViolation.aggregate({
        where,
        _count: { _all: true },
        _sum: { estimatedDamageXAF: true },
        _max: { detectedAt: true },
      }),
      this.penaltySummary(where),
      this.prisma.environmentalViolation.groupBy({
        by: ['forestId'],
        where,
        _count: { _all: true },
        orderBy: { _count: { forestId: 'desc' } },
        take: query.limit,
      }),
      this.prisma.$queryRaw<Array<{ month: string; count: bigint | number }>>`
        SELECT DATE_FORMAT(detectedAt, '%Y-%m') AS month, COUNT(*) AS count
        FROM environmental_violations
        WHERE deletedAt IS NULL AND detectedAt >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
        GROUP BY month
        ORDER BY month ASC
      `,
    ]);

    const forestIds = byRegion.map((row) => row.forestId);
    const forests = forestIds.length
      ? await this.prisma.forest.findMany({ where: { id: { in: forestIds } }, select: { id: true, name: true, code: true } })
      : [];

    const overdue = await this.prisma.environmentalViolation.count({
      where: { ...where, remediationRequired: true, remediationDeadline: { lt: new Date() }, status: { in: ACTIVE_VIOLATION_STATUSES } },
    });

    return {
      total: totals._count._all,
      estimatedDamageXAF: Number(totals._sum.estimatedDamageXAF ?? 0),
      lastDetectedAt: totals._max.detectedAt,
      openCases: byStatus
        .filter((row) => ACTIVE_VIOLATION_STATUSES.includes(row.status))
        .reduce((sum, row) => sum + row._count._all, 0),
      overdueRemediation: overdue,
      penalties,
      byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
      bySeverity: bySeverity.map((row) => ({ severity: row.severity, count: row._count._all })),
      byForest: byRegion.map((row) => ({
        forestId: row.forestId,
        forestName: forests.find((forest) => forest.id === row.forestId)?.name ?? 'Unknown',
        forestCode: forests.find((forest) => forest.id === row.forestId)?.code ?? null,
        count: row._count._all,
      })),
      monthly: monthly.map((row) => ({ month: row.month, count: Number(row.count) })),
    };
  }

  /**
   * Nightly remediation sweep.
   *
   * Uses one-day windows so a case produces exactly one "deadline approaching"
   * reminder and one "deadline passed" notice, however often the sweep runs.
   */
  @Cron('30 5 * * *')
  async runRemediationSweep(now = new Date()): Promise<{ dueSoon: number; overdue: number }> {
    const day = 86_400_000;
    const active: Prisma.EnvironmentalViolationWhereInput = {
      deletedAt: null,
      remediationRequired: true,
      status: { in: ACTIVE_VIOLATION_STATUSES },
    };

    const [dueSoon, overdue] = await Promise.all([
      this.prisma.environmentalViolation.findMany({
        where: { ...active, remediationDeadline: { gte: new Date(now.getTime() + 6 * day), lte: new Date(now.getTime() + 7 * day) } },
        select: { id: true, reference: true, title: true, remediationDeadline: true, severity: true },
      }),
      this.prisma.environmentalViolation.findMany({
        where: { ...active, remediationDeadline: { gte: new Date(now.getTime() - day), lt: now } },
        select: { id: true, reference: true, title: true, remediationDeadline: true, severity: true },
      }),
    ]);

    for (const violation of dueSoon) {
      // eslint-disable-next-line no-await-in-loop
      await this.notifications.notifyRoles(['ENVIRONMENTAL_OFFICER', 'GOVERNMENT_FOREST_OFFICER'], {
        type: NotificationType.VIOLATION_RECORDED,
        title: 'Remediation deadline in 7 days',
        message: `${violation.reference} — ${violation.title}: the company must report remediation by ${violation.remediationDeadline?.toLocaleDateString('fr-FR')}.`,
        entityType: 'EnvironmentalViolation',
        entityId: violation.id,
        actionUrl: `/violations/${violation.id}`,
      });
    }
    for (const violation of overdue) {
      // eslint-disable-next-line no-await-in-loop
      await this.notifications.notifyRoles(['ENVIRONMENTAL_OFFICER', 'GOVERNMENT_FOREST_OFFICER'], {
        type: NotificationType.VIOLATION_RECORDED,
        title: 'Remediation deadline passed',
        message: `${violation.reference} — ${violation.title}: remediation was due on ${violation.remediationDeadline?.toLocaleDateString('fr-FR')} and has not been confirmed.`,
        entityType: 'EnvironmentalViolation',
        entityId: violation.id,
        actionUrl: `/violations/${violation.id}`,
        severity: AuditSeverity.WARNING,
      });
    }

    if (dueSoon.length || overdue.length) {
      this.logger.log(`Remediation sweep: ${dueSoon.length} reminder(s), ${overdue.length} overdue notice(s)`);
    }
    return { dueSoon: dueSoon.length, overdue: overdue.length };
  }

  // ----------------------------------------------------------------- helpers

  private availableActions(user: AuthenticatedUser, violation: { status: ViolationStatus }) {
    return Object.values(VIOLATION_TRANSITIONS)
      .filter((spec) => spec.from.includes(violation.status) && hasAnyPermission(user, spec.permissions))
      .map((spec) => ({
        action: spec.action,
        label: spec.label,
        description: spec.description,
        targetStatus: spec.to,
        requiresReason: spec.requiresReason,
      }));
  }

  private penaltyOf(violation: {
    penaltyAmountXAF: Prisma.Decimal | null;
    payments: Array<{ amount: Prisma.Decimal }>;
  }) {
    return computePenaltyStatus(
      violation.penaltyAmountXAF === null ? 0 : Number(violation.penaltyAmountXAF),
      violation.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    );
  }

  private async penaltySummary(where: Prisma.EnvironmentalViolationWhereInput) {
    const [fined, collected] = await Promise.all([
      this.prisma.environmentalViolation.aggregate({ where, _sum: { penaltyAmountXAF: true } }),
      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.SUCCESSFUL,
          purpose: PaymentPurpose.PENALTY,
          violation: { is: { ...where, deletedAt: null } },
        },
        _sum: { amount: true },
      }),
    ]);
    return computePenaltyStatus(
      Number(fined._sum.penaltyAmountXAF ?? 0),
      Number(collected._sum.amount ?? 0),
    );
  }

  private appendNote(
    existing: string | null,
    action: ViolationAction,
    reason?: string,
    extra?: string,
  ): string {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const entry = [`[${stamp}] ${action}${reason ? `: ${reason}` : ''}`, extra].filter(Boolean).join('\n');
    if (!existing) return entry;
    return `${existing}\n\n${entry}`;
  }

  private scope(
    user: AuthenticatedUser,
    filters: { companyId?: string; detectedById?: string },
  ): Prisma.EnvironmentalViolationWhereInput {
    // A company account only ever sees cases opened against it, whatever other
    // roles it may hold — the API enforces this, the app cannot bypass it.
    if (user.companyId && !user.permissions.includes('*')) {
      return { companyId: user.companyId };
    }
    if (canReadAll(user, 'environmental')) {
      return { companyId: filters.companyId, detectedById: filters.detectedById };
    }
    return { OR: [{ detectedById: user.id }, { companyId: filters.companyId ?? '__none__' }] };
  }

  private assertVisible(
    user: AuthenticatedUser,
    violation: { detectedById: string; companyId: string | null },
  ): void {
    if (user.companyId && !user.permissions.includes('*')) {
      if (violation.companyId === user.companyId) return;
      throw new ForbiddenException({
        code: 'VIOLATION_FORBIDDEN',
        message: 'This case was opened against another organisation.',
      });
    }
    if (canReadAll(user, 'environmental')) return;
    if (violation.detectedById === user.id) return;
    throw new ForbiddenException({
      code: 'VIOLATION_FORBIDDEN',
      message: 'This case was recorded by another officer.',
    });
  }

  private async notifyOpening(
    violation: Prisma.EnvironmentalViolationGetPayload<{ include: typeof VIOLATION_INCLUDE }>,
    forestName: string,
  ) {
    await this.notifications.notifyRoles(['ENVIRONMENTAL_OFFICER'], {
      type: NotificationType.VIOLATION_RECORDED,
      title: `New ${violation.severity} violation recorded`,
      message: `${violation.reference} — ${violation.title} (${forestName}). Investigate and decide on the finding.`,
      entityType: 'EnvironmentalViolation',
      entityId: violation.id,
      actionUrl: `/violations/${violation.id}`,
      severity:
        violation.severity === ViolationSeverity.HIGH || violation.severity === ViolationSeverity.CRITICAL
          ? AuditSeverity.CRITICAL
          : AuditSeverity.WARNING,
    });

    if (violation.companyId) {
      await this.notifications.notify({
        userIds: await this.companyUserIds(violation.companyId),
        type: NotificationType.VIOLATION_RECORDED,
        title: 'A case was opened against your company',
        message: `${violation.reference} — ${violation.title}. You can consult the record; the finding is decided by the administration.`,
        entityType: 'EnvironmentalViolation',
        entityId: violation.id,
        actionUrl: `/violations/${violation.id}`,
        severity: AuditSeverity.WARNING,
      });
    }
  }

  private async notifyTransition(
    violation: Prisma.EnvironmentalViolationGetPayload<{ include: typeof VIOLATION_INCLUDE }>,
    action: ViolationAction,
    reason?: string,
  ) {
    const title =
      action === 'CONFIRM'
        ? 'Violation confirmed'
        : action === 'DISMISS'
          ? 'Violation dismissed'
          : action === 'ESCALATE'
            ? 'Case escalated'
            : action === 'RESOLVE'
              ? 'Violation resolved'
              : action === 'REOPEN'
                ? 'Case reopened'
                : 'Case under investigation';

    const type = action === 'RESOLVE' ? NotificationType.VIOLATION_RESOLVED : NotificationType.VIOLATION_RECORDED;
    const recipients = await this.companyUserIds(violation.companyId);
    const payAttention = action === 'CONFIRM' || action === 'ESCALATE';

    if (recipients.length > 0) {
      await this.notifications.notify({
        userIds: recipients,
        type,
        title,
        message: `${violation.reference} — ${title}${reason ? `: ${reason}` : '.'}${
          payAttention && Number(violation.penaltyAmountXAF ?? 0) > 0
            ? ` Penalty due: ${Number(violation.penaltyAmountXAF)} XAF (purpose PENALTY).`
            : ''
        }`,
        entityType: 'EnvironmentalViolation',
        entityId: violation.id,
        actionUrl: `/violations/${violation.id}`,
        severity: payAttention ? AuditSeverity.WARNING : AuditSeverity.INFO,
      });
    }

    if (action !== 'INVESTIGATE') {
      await this.notifications.notifyRoles(['ENVIRONMENTAL_OFFICER', 'GOVERNMENT_FOREST_OFFICER'], {
        type,
        title: `${violation.reference} — ${title}`,
        message: `${violation.title}: the case is now ${violation.status.replace(/_/g, ' ').toLowerCase()}.`,
        entityType: 'EnvironmentalViolation',
        entityId: violation.id,
        actionUrl: `/violations/${violation.id}`,
      });
    }
  }

  private async companyUserIds(companyId: string | null): Promise<string[]> {
    if (!companyId) return [];
    const members = await this.prisma.user.findMany({
      where: { companyId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    return members.map((member) => member.id);
  }
}
