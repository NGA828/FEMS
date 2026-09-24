import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  AuditSeverity,
  ChecklistResult,
  GpsSource,
  InspectionOutcome,
  InspectionStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GisService } from '../gis/gis.service';
import { StorageService } from '../storage/storage.service';
import { References, uniqueReference } from '../common/utils/reference.util';
import { assertCoordinates, evaluateGpsAccuracy, GPS_MAX_ACCURACY_M, haversineDistanceKm } from '../common/utils/geo.util';
import { canReadAll, canReadOwn, assertCanManuallyCorrectCoordinates } from '../common/utils/access-scope.util';
import { resolveOrderBy } from '../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/decorators';
import { ACTIVE_VIOLATION_STATUSES } from '../environmental/violation-state';
import {
  checkInspectionTransition,
  checkSiteDistance,
  computeComplianceScore,
  defaultChecklist,
  isInspectionEditable,
  outcomeMatchesChecklist,
} from './inspection-state';
import type {
  CancelInspectionDto,
  ChecklistItemDto,
  CreateInspectionDto,
  FieldPositionDto,
  InspectionQueryDto,
  ReviewInspectionDto,
  SubmitInspectionDto,
  UpdateInspectionDto,
} from './dto/inspection.dto';

const INSPECTION_INCLUDE = {
  forest: { select: { id: true, code: true, name: true, region: true } },
  zone: { select: { id: true, code: true, name: true } },
  protectedArea: { select: { id: true, name: true, type: true } },
  company: { select: { id: true, name: true } },
  permit: { select: { id: true, permitNumber: true, status: true } },
  activity: { select: { id: true, reference: true, activityType: true, status: true, latitude: true, longitude: true } },
  inspector: { select: { id: true, firstName: true, lastName: true, email: true } },
  assignedBy: { select: { id: true, firstName: true, lastName: true } },
  reviewedBy: { select: { id: true, firstName: true, lastName: true } },
  checklist: { orderBy: { sortOrder: 'asc' } },
  _count: { select: { evidences: true, observations: true, violations: true } },
} satisfies Prisma.InspectionInclude;

/**
 * Field inspections.
 *
 * The inspector captures the position with the device GPS, answers a checklist
 * on site and attaches evidence; a reviewer then validates the report. Every
 * automated signal in FEMS stops at the report stage — only a human reviewer can
 * close an inspection or turn a finding into a violation.
 */
@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly gis: GisService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------------ reads

  async list(user: AuthenticatedUser, query: InspectionQueryDto) {
    const where: Prisma.InspectionWhereInput = {
      deletedAt: null,
      status: query.status,
      type: query.type,
      outcome: query.outcome,
      forestId: query.forestId,
      permitId: query.permitId,
      activityId: query.activityId,
      ...this.scope(user, query),
      scheduledFor:
        query.from || query.to
          ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
          : undefined,
      ...(query.search
        ? {
            OR: [{ reference: { contains: query.search } }, { title: { contains: query.search } }],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.inspection.findMany({
        where,
        include: INSPECTION_INCLUDE,
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, ['scheduledFor', 'createdAt', 'status'], 'createdAt'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.inspection.count({ where }),
    ]);
    return { items, total };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...INSPECTION_INCLUDE,
        observations: { orderBy: { capturedAt: 'desc' }, take: 20 },
        violations: { where: { deletedAt: null }, select: { id: true, reference: true, title: true, status: true, severity: true } },
        evidences: { where: { deletedAt: null } },
      },
    });
    if (!inspection) throw new NotFoundException({ code: 'INSPECTION_NOT_FOUND', message: 'Inspection not found.' });
    this.assertVisible(user, inspection);
    return inspection;
  }

  async create(user: AuthenticatedUser, dto: CreateInspectionDto) {
    const forest = await this.prisma.forest.findFirst({ where: { id: dto.forestId, deletedAt: null }, select: { id: true, name: true } });
    if (!forest) throw new NotFoundException({ code: 'FOREST_NOT_FOUND', message: 'Forest not found.' });

    if (dto.zoneId) {
      const zone = await this.prisma.forestZone.findFirst({ where: { id: dto.zoneId, deletedAt: null }, select: { id: true, forestId: true } });
      if (!zone) throw new NotFoundException({ code: 'ZONE_NOT_FOUND', message: 'Zone not found.' });
      if (zone.forestId !== dto.forestId) {
        throw new BadRequestException({
          code: 'ZONE_FOREST_MISMATCH',
          message: 'The selected zone does not belong to the selected forest.',
        });
      }
    }

    if (dto.activityId) {
      const activity = await this.prisma.exploitationActivity.findFirst({
        where: { id: dto.activityId, deletedAt: null },
        select: { id: true, forestId: true },
      });
      if (!activity) throw new NotFoundException({ code: 'ACTIVITY_NOT_FOUND', message: 'Activity not found.' });
      if (activity.forestId !== dto.forestId) {
        throw new BadRequestException({
          code: 'ACTIVITY_FOREST_MISMATCH',
          message: 'The selected activity belongs to another forest.',
        });
      }
    }

    const inspectorId = dto.inspectorId ?? user.id;
    const inspector = await this.prisma.user.findFirst({
      where: { id: inspectorId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!inspector) throw new NotFoundException({ code: 'INSPECTOR_NOT_FOUND', message: 'The assigned inspector was not found.' });

    const reference = await uniqueReference(
      () => References.inspection(),
      async (candidate) => (await this.prisma.inspection.count({ where: { reference: candidate } })) === 0,
    );

    const checklist: ChecklistItemDto[] = dto.checklist?.length
      ? dto.checklist
      : defaultChecklist(dto.type).map((item, index) => ({ ...item, sortOrder: index }));

    const inspection = await this.prisma.inspection.create({
      data: {
        reference,
        type: dto.type,
        status: InspectionStatus.SCHEDULED,
        title: dto.title,
        forestId: dto.forestId,
        zoneId: dto.zoneId,
        protectedAreaId: dto.protectedAreaId,
        companyId: dto.companyId,
        permitId: dto.permitId,
        activityId: dto.activityId,
        inspectorId,
        assignedById: inspectorId === user.id ? null : user.id,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
        // An inspection is created before the site visit: the position is only
        // known once the inspector starts it in the field.
        latitude: new Prisma.Decimal(0),
        longitude: new Prisma.Decimal(0),
        gpsSource: GpsSource.DEVICE_GPS,
        checklist: {
          create: checklist.map((item, index) => ({
            code: item.code,
            label: item.label,
            result: item.result ?? ChecklistResult.NOT_APPLICABLE,
            notes: item.notes,
            sortOrder: item.sortOrder ?? index,
          })),
        },
      },
      include: INSPECTION_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'Inspection',
      entityId: inspection.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Scheduled ${inspection.type} inspection ${inspection.reference} on ${forest.name}`,
      after: { inspectorId, scheduledFor: dto.scheduledFor ?? null, checklist: checklist.length },
    });

    if (inspectorId !== user.id) {
      await this.notifications.notify({
        userIds: [inspectorId],
        type: NotificationType.INSPECTION_ASSIGNED,
        title: 'Inspection assigned',
        message: `${inspection.title} (${inspection.reference}) has been assigned to you.`,
        entityType: 'Inspection',
        entityId: inspection.id,
        actionUrl: `/inspections/${inspection.id}`,
      });
    }

    return inspection;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateInspectionDto) {
    const inspection = await this.prisma.inspection.findFirst({ where: { id, deletedAt: null } });
    if (!inspection) throw new NotFoundException({ code: 'INSPECTION_NOT_FOUND', message: 'Inspection not found.' });
    this.assertVisible(user, inspection);
    if (!isInspectionEditable(inspection.status)) {
      throw new BadRequestException({
        code: 'INSPECTION_NOT_EDITABLE',
        message: `An inspection in status ${inspection.status} can no longer be edited.`,
      });
    }

    if (dto.inspectorId && dto.inspectorId !== inspection.inspectorId) {
      const inspector = await this.prisma.user.findFirst({
        where: { id: dto.inspectorId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!inspector) throw new NotFoundException({ code: 'INSPECTOR_NOT_FOUND', message: 'The assigned inspector was not found.' });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.checklist?.length) {
        for (const [index, item] of dto.checklist.entries()) {
          const existing = await tx.inspectionChecklistItem.findFirst({
            where: { inspectionId: id, code: item.code },
            select: { id: true },
          });
          const data = {
            code: item.code,
            label: item.label,
            result: item.result ?? ChecklistResult.NOT_APPLICABLE,
            notes: item.notes,
            sortOrder: item.sortOrder ?? index,
          };
          if (existing) {
            // eslint-disable-next-line no-await-in-loop
            await tx.inspectionChecklistItem.update({ where: { id: existing.id }, data });
          } else {
            // eslint-disable-next-line no-await-in-loop
            await tx.inspectionChecklistItem.create({ data: { ...data, inspectionId: id } });
          }
        }
      }
      return tx.inspection.update({
        where: { id },
        data: {
          title: dto.title,
          summary: dto.summary,
          recommendations: dto.recommendations,
          scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
          zoneId: dto.zoneId,
          inspectorId: dto.inspectorId,
          assignedById: dto.inspectorId ? user.id : undefined,
        },
        include: INSPECTION_INCLUDE,
      });
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Inspection',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Updated inspection ${inspection.reference}`,
      before: { inspectorId: inspection.inspectorId, scheduledFor: inspection.scheduledFor },
      after: { inspectorId: updated.inspectorId, scheduledFor: updated.scheduledFor },
    });

    if (dto.inspectorId && dto.inspectorId !== inspection.inspectorId) {
      await this.notifications.notify({
        userIds: [dto.inspectorId],
        type: NotificationType.INSPECTION_ASSIGNED,
        title: 'Inspection assigned',
        message: `${updated.title} (${updated.reference}) has been assigned to you.`,
        entityType: 'Inspection',
        entityId: id,
        actionUrl: `/inspections/${id}`,
      });
    }

    return updated;
  }

  /** Field work starts here: the device position becomes part of the record. */
  async start(user: AuthenticatedUser, id: string, dto: FieldPositionDto) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, deletedAt: null },
      include: { activity: { select: { id: true, latitude: true, longitude: true, reference: true } } },
    });
    if (!inspection) throw new NotFoundException({ code: 'INSPECTION_NOT_FOUND', message: 'Inspection not found.' });
    this.assertCanExecute(user, inspection);

    const check = checkInspectionTransition('START', inspection.status, null);
    if (!check.ok) throw new BadRequestException({ code: check.code, message: check.message });

    const position = this.validatePosition(user, dto, inspection.activity);
    const started = await this.prisma.inspection.update({
      where: { id },
      data: {
        status: InspectionStatus.IN_PROGRESS,
        startedAt: new Date(),
        latitude: new Prisma.Decimal(position.latitude),
        longitude: new Prisma.Decimal(position.longitude),
        locationAccuracyM: position.accuracyM === null ? null : new Prisma.Decimal(position.accuracyM),
        gpsCapturedAt: position.capturedAt,
        gpsSource: position.gpsSource,
        distanceFromTargetM: position.distanceM === null ? null : new Prisma.Decimal(position.distanceM),
      },
      include: INSPECTION_INCLUDE,
    });

    await this.gis.recordFeature({
      featureType: 'INSPECTION',
      entityId: started.id,
      label: started.reference,
      latitude: position.latitude,
      longitude: position.longitude,
      accuracyM: position.accuracyM,
      source: position.gpsSource,
      forestId: started.forestId,
      zoneId: started.zoneId,
      inspectionId: started.id,
      recordedById: user.id,
      metadata: { type: started.type, status: started.status },
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Inspection',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Started inspection ${inspection.reference} at ${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`,
      after: {
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyM: position.accuracyM,
        distanceFromTargetM: position.distanceM,
      },
    });

    return { inspection: started, gpsWarning: position.warning };
  }

  async submit(user: AuthenticatedUser, id: string, dto: SubmitInspectionDto) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, deletedAt: null },
      include: { checklist: true, activity: { select: { id: true, latitude: true, longitude: true, reference: true } } },
    });
    if (!inspection) throw new NotFoundException({ code: 'INSPECTION_NOT_FOUND', message: 'Inspection not found.' });
    this.assertCanExecute(user, inspection);

    // Offline replay: resending the same submission (same clientRef) returns the
    // report already stored instead of failing with a transition error.
    if (dto.clientRef && inspection.clientRef === dto.clientRef && inspection.status !== InspectionStatus.IN_PROGRESS) {
      return {
        inspection: await this.prisma.inspection.findFirstOrThrow({ where: { id }, include: INSPECTION_INCLUDE }),
        duplicate: true,
        gpsWarning: null,
      };
    }

    const check = checkInspectionTransition('SUBMIT', inspection.status, null);
    if (!check.ok) throw new BadRequestException({ code: check.code, message: check.message });

    const position = this.validatePosition(user, dto, inspection.activity);

    const answers = new Map(dto.checklist?.map((item) => [item.code, item]) ?? []);
    const merged = inspection.checklist.map((item) => ({
      id: item.id,
      code: item.code,
      label: item.label,
      result: answers.get(item.code)?.result ?? item.result,
      notes: answers.get(item.code)?.notes ?? item.notes ?? undefined,
    }));
    for (const item of dto.checklist ?? []) {
      if (!inspection.checklist.some((existing) => existing.code === item.code)) {
        merged.push({ id: '', code: item.code, label: item.label, result: item.result ?? ChecklistResult.NOT_APPLICABLE, notes: item.notes });
      }
    }

    const unanswered = merged.filter((item) => !item.result);
    if (unanswered.length > 0) {
      throw new BadRequestException({
        code: 'INSPECTION_CHECKLIST_INCOMPLETE',
        message: `${unanswered.length} checklist item(s) still have no result: ${unanswered.map((item) => item.code).join(', ')}.`,
      });
    }

    const compliance = computeComplianceScore(merged);
    if (!outcomeMatchesChecklist(dto.outcome, compliance)) {
      throw new BadRequestException({
        code: 'INSPECTION_OUTCOME_CONFLICT',
        message:
          dto.outcome === InspectionOutcome.COMPLIANT
            ? `The outcome was recorded as COMPLIANT but ${compliance.failed} checklist item(s) failed.`
            : `The outcome ${dto.outcome} requires at least one failed checklist item; none was recorded.`,
        details: { failedItems: merged.filter((item) => item.result === ChecklistResult.FAIL).map((item) => item.code) },
      });
    }

    const submitted = await this.prisma.$transaction(async (tx) => {
      for (const item of merged) {
        if (!item.id) {
          // eslint-disable-next-line no-await-in-loop
          await tx.inspectionChecklistItem.create({
            data: {
              inspectionId: id,
              code: item.code,
              label: item.label,
              result: item.result,
              notes: item.notes,
            },
          });
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await tx.inspectionChecklistItem.update({
          where: { id: item.id },
          data: { result: item.result, notes: item.notes },
        });
      }

      return tx.inspection.update({
        where: { id },
        data: {
          status: InspectionStatus.SUBMITTED,
          outcome: dto.outcome,
          complianceScore: compliance.score,
          summary: dto.summary ?? inspection.summary,
          recommendations: dto.recommendations ?? inspection.recommendations,
          submittedAt: new Date(),
          completedAt: new Date(),
          verifiedHarvestedVolumeM3:
            dto.verifiedHarvestedVolumeM3 === undefined ? undefined : new Prisma.Decimal(dto.verifiedHarvestedVolumeM3),
          verifiedTreeCount: dto.verifiedTreeCount,
          discrepancies: dto.discrepancies,
          latitude: new Prisma.Decimal(position.latitude),
          longitude: new Prisma.Decimal(position.longitude),
          locationAccuracyM: position.accuracyM === null ? null : new Prisma.Decimal(position.accuracyM),
          gpsCapturedAt: position.capturedAt,
          gpsSource: position.gpsSource,
          distanceFromTargetM: position.distanceM === null ? null : new Prisma.Decimal(position.distanceM),
          clientRef: dto.clientRef,
        },
        include: INSPECTION_INCLUDE,
      });
    });

    await this.gis.recordFeature({
      featureType: 'INSPECTION',
      entityId: submitted.id,
      label: submitted.reference,
      latitude: position.latitude,
      longitude: position.longitude,
      accuracyM: position.accuracyM,
      source: position.gpsSource,
      forestId: submitted.forestId,
      zoneId: submitted.zoneId,
      inspectionId: submitted.id,
      recordedById: user.id,
      metadata: { outcome: submitted.outcome, complianceScore: submitted.complianceScore },
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      severity: dto.outcome === InspectionOutcome.COMPLIANT ? AuditSeverity.INFO : AuditSeverity.WARNING,
      entityType: 'Inspection',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Submitted inspection ${inspection.reference} — ${dto.outcome} (compliance ${compliance.score ?? 'n/a'}%)`,
      after: {
        outcome: dto.outcome,
        complianceScore: compliance.score,
        failedItems: compliance.failed,
        verifiedHarvestedVolumeM3: dto.verifiedHarvestedVolumeM3 ?? null,
      },
    });

    await this.notifications.notifyRoles(['GOVERNMENT_FOREST_OFFICER', 'ENVIRONMENTAL_OFFICER'], {
      type: NotificationType.INSPECTION_SUBMITTED,
      title: 'Inspection report submitted',
      message: `${submitted.reference} — ${submitted.outcome?.replace(/_/g, ' ')} on ${submitted.forest.name}. Review it and decide on follow-up.`,
      entityType: 'Inspection',
      entityId: submitted.id,
      actionUrl: `/inspections/${submitted.id}`,
      severity: dto.outcome === InspectionOutcome.COMPLIANT ? AuditSeverity.INFO : AuditSeverity.WARNING,
    });

    if (inspection.companyId) {
      await this.notifications.notify({
        userIds: await this.companyUserIds(inspection.companyId),
        type: NotificationType.INSPECTION_COMPLETED,
        title: 'Inspection carried out on your site',
        message: `${submitted.reference} — outcome ${submitted.outcome?.replace(/_/g, ' ')}. ${submitted.recommendations ?? ''}`.trim(),
        entityType: 'Inspection',
        entityId: submitted.id,
        actionUrl: `/inspections/${submitted.id}`,
      });
    }

    return { inspection: submitted, duplicate: false, gpsWarning: position.warning };
  }

  async review(user: AuthenticatedUser, id: string, dto: ReviewInspectionDto) {
    const inspection = await this.prisma.inspection.findFirst({ where: { id, deletedAt: null }, include: { checklist: true } });
    if (!inspection) throw new NotFoundException({ code: 'INSPECTION_NOT_FOUND', message: 'Inspection not found.' });

    const check = checkInspectionTransition('REVIEW', inspection.status, null);
    if (!check.ok) throw new BadRequestException({ code: check.code, message: check.message });

    if (dto.outcome && dto.outcome !== inspection.outcome) {
      const compliance = computeComplianceScore(inspection.checklist);
      if (!outcomeMatchesChecklist(dto.outcome, compliance)) {
        throw new BadRequestException({
          code: 'INSPECTION_OUTCOME_CONFLICT',
          message: 'The corrected outcome contradicts the checklist results recorded on site.',
        });
      }
    }

    const reviewed = await this.prisma.inspection.update({
      where: { id },
      data: {
        status: InspectionStatus.REVIEWED,
        reviewedAt: new Date(),
        reviewedById: user.id,
        outcome: dto.outcome ?? inspection.outcome,
        recommendations: dto.recommendations ?? inspection.recommendations,
        summary: dto.notes ?? inspection.summary,
      },
      include: INSPECTION_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Inspection',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Reviewed inspection ${inspection.reference}`,
      after: { outcome: reviewed.outcome, notes: dto.notes ?? null },
    });

    await this.notifications.notify({
      userIds: [inspection.inspectorId],
      type: NotificationType.INSPECTION_COMPLETED,
      title: 'Inspection reviewed',
      message: `${inspection.reference} was reviewed${dto.notes ? `: ${dto.notes}` : '.'}`,
      entityType: 'Inspection',
      entityId: id,
      actionUrl: `/inspections/${id}`,
    });

    return reviewed;
  }

  async close(user: AuthenticatedUser, id: string, notes?: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { violations: true } } },
    });
    if (!inspection) throw new NotFoundException({ code: 'INSPECTION_NOT_FOUND', message: 'Inspection not found.' });

    const check = checkInspectionTransition('CLOSE', inspection.status, null);
    if (!check.ok) throw new BadRequestException({ code: check.code, message: check.message });

    const openViolations = await this.prisma.environmentalViolation.count({
      where: { inspectionId: id, deletedAt: null, status: { in: ACTIVE_VIOLATION_STATUSES } },
    });
    if (openViolations > 0) {
      throw new ConflictException({
        code: 'INSPECTION_HAS_OPEN_VIOLATIONS',
        message: `${openViolations} violation(s) recorded during this inspection are still open. Close or resolve them first.`,
        details: { openViolations },
      });
    }

    const closed = await this.prisma.inspection.update({
      where: { id },
      data: { status: InspectionStatus.CLOSED, summary: notes ?? inspection.summary },
      include: INSPECTION_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Inspection',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Closed inspection ${inspection.reference}`,
    });

    return closed;
  }

  async cancel(user: AuthenticatedUser, id: string, dto: CancelInspectionDto) {
    const inspection = await this.prisma.inspection.findFirst({ where: { id, deletedAt: null } });
    if (!inspection) throw new NotFoundException({ code: 'INSPECTION_NOT_FOUND', message: 'Inspection not found.' });
    this.assertVisible(user, inspection);

    const check = checkInspectionTransition('CANCEL', inspection.status, dto.reason);
    if (!check.ok) throw new BadRequestException({ code: check.code, message: check.message });

    const cancelled = await this.prisma.inspection.update({
      where: { id },
      data: { status: InspectionStatus.CANCELLED, summary: `Cancelled: ${dto.reason}` },
      include: INSPECTION_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      severity: AuditSeverity.WARNING,
      entityType: 'Inspection',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Cancelled inspection ${inspection.reference}: ${dto.reason}`,
    });

    await this.notifications.notify({
      userIds: [inspection.inspectorId, ...(inspection.assignedById ? [inspection.assignedById] : [])],
      type: NotificationType.INSPECTION_COMPLETED,
      title: 'Inspection cancelled',
      message: `${inspection.reference} was cancelled: ${dto.reason}`,
      entityType: 'Inspection',
      entityId: id,
      actionUrl: `/inspections/${id}`,
      severity: AuditSeverity.WARNING,
    });

    return cancelled;
  }

  async statistics(user: AuthenticatedUser, query: InspectionQueryDto) {
    const scope = this.scope(user, query);
    const where: Prisma.InspectionWhereInput = { deletedAt: null, ...scope };

    const [byStatus, byType, outcomes, coverage] = await Promise.all([
      this.prisma.inspection.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.inspection.groupBy({ by: ['type'], where, _count: { _all: true } }),
      this.prisma.inspection.groupBy({ by: ['outcome'], where, _count: { _all: true } }),
      this.prisma.inspection.aggregate({ where, _avg: { complianceScore: true }, _count: { _all: true } }),
    ]);

    const openViolations = await this.prisma.environmentalViolation.groupBy({
      by: ['severity'],
      where: { deletedAt: null, status: { in: ['OPEN', 'UNDER_INVESTIGATION', 'CONFIRMED', 'ESCALATED'] } },
      _count: { _all: true },
    });

    return {
      total: coverage._count._all,
      averageComplianceScore: coverage._avg.complianceScore === null ? null : Math.round(coverage._avg.complianceScore),
      byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
      byType: byType.map((row) => ({ type: row.type, count: row._count._all })),
      byOutcome: outcomes
        .filter((row) => row.outcome !== null)
        .map((row) => ({ outcome: row.outcome, count: row._count._all })),
      openViolationsBySeverity: openViolations.map((row) => ({ severity: row.severity, count: row._count._all })),
    };
  }

  /** Registers an evidence file that was already uploaded through the storage module. */
  async attachEvidence(user: AuthenticatedUser, dto: import('./dto/observation.dto').AttachEvidenceDto) {
    const metadata = this.storage.getMetadata(dto.fileKey);
    if (dto.inspectionId) {
      const inspection = await this.prisma.inspection.findFirst({ where: { id: dto.inspectionId, deletedAt: null }, select: { id: true } });
      if (!inspection) throw new NotFoundException({ code: 'INSPECTION_NOT_FOUND', message: 'Inspection not found.' });
    }
    if (dto.observationId) {
      const observation = await this.prisma.fieldObservation.findFirst({ where: { id: dto.observationId }, select: { id: true } });
      if (!observation) throw new NotFoundException({ code: 'OBSERVATION_NOT_FOUND', message: 'Observation not found.' });
    }
    if (dto.activityId) {
      const activity = await this.prisma.exploitationActivity.findFirst({ where: { id: dto.activityId, deletedAt: null }, select: { id: true } });
      if (!activity) throw new NotFoundException({ code: 'ACTIVITY_NOT_FOUND', message: 'Activity not found.' });
    }
    if (dto.latitude !== undefined || dto.longitude !== undefined) {
      if (dto.latitude === undefined || dto.longitude === undefined) {
        throw new BadRequestException({
          code: 'EVIDENCE_POSITION_INCOMPLETE',
          message: 'Provide both latitude and longitude, or neither.',
        });
      }
      assertCoordinates(dto.latitude, dto.longitude, 'evidence position');
    }

    const evidence = await this.prisma.evidence.create({
      data: {
        type: dto.type,
        source: dto.source,
        title: dto.title,
        caption: dto.caption,
        fileUrl: `/api/v1/files/download?key=${encodeURIComponent(dto.fileKey)}`,
        fileKey: dto.fileKey,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        checksum: dto.checksum,
        latitude: dto.latitude === undefined ? null : new Prisma.Decimal(dto.latitude),
        longitude: dto.longitude === undefined ? null : new Prisma.Decimal(dto.longitude),
        locationAccuracyM: dto.locationAccuracyM === undefined ? null : new Prisma.Decimal(dto.locationAccuracyM),
        capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : new Date(),
        gpsSource: dto.gpsSource,
        inspectionId: dto.inspectionId,
        observationId: dto.observationId,
        activityId: dto.activityId,
        violationId: dto.violationId,
        permitId: dto.permitId,
        companyId: dto.companyId,
        uploadedById: user.id,
      },
    });

    await this.audit.record({
      action: AuditAction.FILE_UPLOAD,
      entityType: 'Evidence',
      entityId: evidence.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Attached ${dto.type} evidence to ${dto.inspectionId ? 'inspection' : dto.observationId ? 'observation' : dto.activityId ? 'activity' : 'record'}`,
      after: { fileKey: dto.fileKey, sizeBytes: dto.sizeBytes, storedSizeBytes: metadata.size },
    });

    return evidence;
  }

  async listEvidence(user: AuthenticatedUser, filters: { inspectionId?: string; observationId?: string; activityId?: string }) {
    const where: Prisma.EvidenceWhereInput = {
      deletedAt: null,
      inspectionId: filters.inspectionId,
      observationId: filters.observationId,
      activityId: filters.activityId,
    };
    const items = await this.prisma.evidence.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!canReadAll(user, 'inspections') && !canReadAll(user, 'observations')) {
      const visible = items.filter((item) => item.uploadedById === user.id || item.companyId === user.companyId);
      if (visible.length !== items.length) {
        throw new ForbiddenException({
          code: 'EVIDENCE_FORBIDDEN',
          message: 'Some evidence belongs to another account; refine the filter.',
        });
      }
    }
    return items;
  }

  // ----------------------------------------------------------------- helpers

  private scope(user: AuthenticatedUser, query: InspectionQueryDto): Prisma.InspectionWhereInput {
    // A company account only ever sees inspections carried out on its own sites
    // — checked first so a `inspections:read_own` grant can never widen it.
    if (user.companyId && !user.permissions.includes('*')) {
      return { companyId: user.companyId };
    }
    if (canReadAll(user, 'inspections')) {
      return {
        companyId: query.companyId,
        inspectorId: query.mine === 'true' ? user.id : query.inspectorId,
      };
    }
    if (canReadOwn(user, 'inspections')) {
      return {
        companyId: query.companyId,
        OR: [{ inspectorId: user.id }, { assignedById: user.id }],
      };
    }
    return { companyId: user.companyId ?? '__none__' };
  }

  private assertVisible(
    user: AuthenticatedUser,
    inspection: { inspectorId: string; assignedById: string | null; companyId: string | null },
  ): void {
    if (user.companyId && !user.permissions.includes('*')) {
      if (inspection.companyId && inspection.companyId === user.companyId) return;
      throw new ForbiddenException({
        code: 'INSPECTION_FORBIDDEN',
        message: 'This inspection was carried out on another company’s site.',
      });
    }
    if (canReadAll(user, 'inspections')) return;
    if (inspection.inspectorId === user.id || inspection.assignedById === user.id) return;
    if (inspection.companyId && inspection.companyId === user.companyId) return;
    throw new ForbiddenException({
      code: 'INSPECTION_FORBIDDEN',
      message: 'This inspection is not in your scope.',
    });
  }

  /** Only the assigned inspector (or a reviewer-level officer) may run field work. */
  private assertCanExecute(
    user: AuthenticatedUser,
    inspection: { inspectorId: string; assignedById: string | null },
  ): void {
    if (inspection.inspectorId === user.id) return;
    if (canReadAll(user, 'inspections')) return;
    throw new ForbiddenException({
      code: 'INSPECTION_NOT_ASSIGNED_TO_YOU',
      message: 'Only the inspector assigned to this inspection can carry it out.',
    });
  }

  private validatePosition(
    user: AuthenticatedUser,
    dto: FieldPositionDto,
    activity: { latitude: Prisma.Decimal; longitude: Prisma.Decimal; reference: string } | null,
  ): {
    latitude: number;
    longitude: number;
    accuracyM: number | null;
    gpsSource: GpsSource;
    capturedAt: Date;
    distanceM: number | null;
    warning: string | null;
  } {
    assertCoordinates(dto.latitude, dto.longitude, 'inspection position');
    const gpsSource = dto.gpsSource ?? GpsSource.DEVICE_GPS;
    if (gpsSource !== GpsSource.DEVICE_GPS && gpsSource !== GpsSource.SEED_DEMO) {
      assertCanManuallyCorrectCoordinates(user, 'inspections');
    }
    const accuracy = evaluateGpsAccuracy(dto.locationAccuracyM);
    if (!accuracy.accepted) {
      throw new BadRequestException({
        code: 'GPS_ACCURACY_TOO_LOW',
        message: accuracy.warning,
        details: { accuracyM: dto.locationAccuracyM, requiredAccuracyM: GPS_MAX_ACCURACY_M },
      });
    }

    let distanceM: number | null = null;
    let warning = accuracy.warning;
    if (activity) {
      const distanceKm = haversineDistanceKm(
        { latitude: dto.latitude, longitude: dto.longitude },
        { latitude: Number(activity.latitude), longitude: Number(activity.longitude) },
      );
      distanceM = Math.round(distanceKm * 1000 * 100) / 100;
      const distanceCheck = checkSiteDistance(distanceM);
      if (!distanceCheck.ok) {
        throw new BadRequestException({
          code: distanceCheck.code,
          message: `${distanceCheck.message} (activity ${activity.reference})`,
          details: { distanceM },
        });
      }
      if (distanceCheck.warning) warning = warning ? `${warning} ${distanceCheck.warning}` : distanceCheck.warning;
    }

    return {
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracyM: dto.locationAccuracyM ?? null,
      gpsSource,
      capturedAt: dto.gpsCapturedAt ? new Date(dto.gpsCapturedAt) : new Date(),
      distanceM,
      warning,
    };
  }

  private async companyUserIds(companyId: string): Promise<string[]> {
    const members = await this.prisma.user.findMany({
      where: { companyId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    return members.map((member) => member.id);
  }
}
