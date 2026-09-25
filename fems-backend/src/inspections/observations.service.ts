import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  AuditSeverity,
  GpsSource,
  NotificationType,
  ObservationCategory,
  Prisma,
  SyncStatus,
  ViolationSeverity,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GisService } from '../gis/gis.service';
import { assertCoordinates, evaluateGpsAccuracy, GPS_MAX_ACCURACY_M } from '../common/utils/geo.util';
import { assertCanManuallyCorrectCoordinates, canReadAll } from '../common/utils/access-scope.util';
import { resolveOrderBy } from '../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/decorators';
import type { CreateObservationDto, ObservationQueryDto, ObservationSyncDto, UpdateObservationDto } from './dto/observation.dto';

const OBSERVATION_INCLUDE = {
  forest: { select: { id: true, code: true, name: true } },
  zone: { select: { id: true, code: true, name: true } },
  protectedArea: { select: { id: true, name: true, type: true } },
  activity: { select: { id: true, reference: true, activityType: true } },
  inspection: { select: { id: true, reference: true, status: true } },
  observedBy: { select: { id: true, firstName: true, lastName: true } },
  evidences: { where: { deletedAt: null }, select: { id: true, type: true, fileUrl: true, caption: true } },
  violations: { where: { deletedAt: null }, select: { id: true, reference: true, status: true, severity: true } },
} satisfies Prisma.FieldObservationInclude;

/**
 * Field observations.
 *
 * These are the raw facts an officer records on site (a diseased stand, an
 * encroachment, illegal logging signs). They are stored exactly as captured,
 * including the device GPS position, and they are what later feeds violations
 * and AI analysis — they never accuse anyone by themselves.
 */
@Injectable()
export class ObservationsService {
  private readonly logger = new Logger(ObservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly gis: GisService,
  ) {}

  async list(user: AuthenticatedUser, query: ObservationQueryDto) {
    const where: Prisma.FieldObservationWhereInput = {
      category: query.category,
      severity: query.severity,
      forestId: query.forestId,
      inspectionId: query.inspectionId,
      activityId: query.activityId,
      ...this.scope(user, query.observedById),
      capturedAt:
        query.from || query.to
          ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
          : undefined,
      ...(query.search
        ? { OR: [{ title: { contains: query.search } }, { description: { contains: query.search } }] }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.fieldObservation.findMany({
        where,
        include: OBSERVATION_INCLUDE,
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, ['capturedAt', 'severity', 'createdAt'], 'capturedAt'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.fieldObservation.count({ where }),
    ]);
    return { items, total };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const observation = await this.prisma.fieldObservation.findUnique({ where: { id }, include: OBSERVATION_INCLUDE });
    if (!observation) throw new NotFoundException({ code: 'OBSERVATION_NOT_FOUND', message: 'Observation not found.' });
    this.assertVisible(user, observation);
    return observation;
  }

  async create(user: AuthenticatedUser, dto: CreateObservationDto) {
    if (dto.clientRef) {
      const existing = await this.prisma.fieldObservation.findUnique({
        where: { clientRef: dto.clientRef },
        include: OBSERVATION_INCLUDE,
      });
      if (existing) return { observation: existing, duplicate: true };
    }

    const forest = await this.prisma.forest.findFirst({ where: { id: dto.forestId, deletedAt: null }, select: { id: true, name: true } });
    if (!forest) throw new NotFoundException({ code: 'FOREST_NOT_FOUND', message: 'Forest not found.' });

    if (dto.zoneId) {
      const zone = await this.prisma.forestZone.findFirst({ where: { id: dto.zoneId, deletedAt: null }, select: { forestId: true } });
      if (!zone) throw new NotFoundException({ code: 'ZONE_NOT_FOUND', message: 'Zone not found.' });
      if (zone.forestId !== dto.forestId) {
        throw new BadRequestException({
          code: 'ZONE_FOREST_MISMATCH',
          message: 'The selected zone does not belong to the selected forest.',
        });
      }
    }

    if (dto.inspectionId) {
      const inspection = await this.prisma.inspection.findFirst({
        where: { id: dto.inspectionId, deletedAt: null },
        select: { id: true, inspectorId: true, forestId: true },
      });
      if (!inspection) throw new NotFoundException({ code: 'INSPECTION_NOT_FOUND', message: 'Inspection not found.' });
      if (inspection.forestId !== dto.forestId) {
        throw new BadRequestException({
          code: 'OBSERVATION_FOREST_MISMATCH',
          message: 'The inspection was carried out in another forest.',
        });
      }
    }

    assertCoordinates(dto.latitude, dto.longitude, 'observation position');
    const gpsSource = dto.gpsSource ?? GpsSource.DEVICE_GPS;
    if (gpsSource !== GpsSource.DEVICE_GPS && gpsSource !== GpsSource.SEED_DEMO) {
      assertCanManuallyCorrectCoordinates(user, 'observations');
    }
    const accuracy = evaluateGpsAccuracy(dto.locationAccuracyM);
    if (!accuracy.accepted) {
      throw new BadRequestException({
        code: 'GPS_ACCURACY_TOO_LOW',
        message: accuracy.warning,
        details: { accuracyM: dto.locationAccuracyM, requiredAccuracyM: GPS_MAX_ACCURACY_M },
      });
    }

    const observation = await this.prisma.fieldObservation.create({
      data: {
        forestId: dto.forestId,
        zoneId: dto.zoneId,
        protectedAreaId: dto.protectedAreaId,
        activityId: dto.activityId,
        inspectionId: dto.inspectionId,
        category: dto.category,
        severity: dto.severity ?? ViolationSeverity.LOW,
        title: dto.title,
        description: dto.description,
        latitude: new Prisma.Decimal(dto.latitude),
        longitude: new Prisma.Decimal(dto.longitude),
        locationAccuracyM: dto.locationAccuracyM === undefined ? null : new Prisma.Decimal(dto.locationAccuracyM),
        capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : new Date(),
        gpsSource,
        observedById: user.id,
        clientRef: dto.clientRef,
        syncStatus: SyncStatus.SYNCED,
      },
      include: OBSERVATION_INCLUDE,
    });

    await this.gis.recordFeature({
      featureType: 'FIELD_OBSERVATION',
      entityId: observation.id,
      label: observation.title,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracyM: dto.locationAccuracyM ?? null,
      source: gpsSource,
      forestId: observation.forestId,
      zoneId: observation.zoneId,
      observationId: observation.id,
      recordedById: user.id,
      metadata: { category: observation.category, severity: observation.severity },
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      severity:
        observation.severity === ViolationSeverity.HIGH || observation.severity === ViolationSeverity.CRITICAL
          ? AuditSeverity.WARNING
          : AuditSeverity.INFO,
      entityType: 'FieldObservation',
      entityId: observation.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Recorded ${observation.category} observation "${observation.title}" (${observation.severity})`,
      after: {
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracyM: dto.locationAccuracyM ?? null,
        severity: observation.severity,
      },
    });

    if (observation.severity === ViolationSeverity.HIGH || observation.severity === ViolationSeverity.CRITICAL) {
      await this.notifications.notifyRoles(['ENVIRONMENTAL_OFFICER', 'GOVERNMENT_FOREST_OFFICER'], {
        type: NotificationType.OBSERVATION_RECORDED,
        title: `${observation.severity} observation in ${forest.name}`,
        message: `${observation.title} — ${observation.category.replace(/_/g, ' ').toLowerCase()}. Review it and decide whether a violation must be opened.`,
        entityType: 'FieldObservation',
        entityId: observation.id,
        actionUrl: `/observations/${observation.id}`,
        severity: AuditSeverity.WARNING,
      });
    }

    return { observation, duplicate: false, gpsWarning: accuracy.warning };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateObservationDto) {
    const observation = await this.prisma.fieldObservation.findUnique({ where: { id } });
    if (!observation) throw new NotFoundException({ code: 'OBSERVATION_NOT_FOUND', message: 'Observation not found.' });
    this.assertVisible(user, observation);

    const updated = await this.prisma.fieldObservation.update({
      where: { id },
      data: {
        category: dto.category,
        title: dto.title,
        description: dto.description,
        severity: dto.severity,
      },
      include: OBSERVATION_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'FieldObservation',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Updated observation "${updated.title}"`,
      before: { category: observation.category, severity: observation.severity },
      after: { category: updated.category, severity: updated.severity },
    });

    return updated;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const observation = await this.prisma.fieldObservation.findUnique({
      where: { id },
      include: { _count: { select: { violations: true, aiAlerts: true } } },
    });
    if (!observation) throw new NotFoundException({ code: 'OBSERVATION_NOT_FOUND', message: 'Observation not found.' });
    this.assertVisible(user, observation);
    if (observation.observedById !== user.id && !canReadAll(user, 'observations')) {
      throw new ForbiddenException({
        code: 'OBSERVATION_FORBIDDEN',
        message: 'Only the officer who recorded the observation (or a regulator) may delete it.',
      });
    }

    await this.prisma.fieldObservation.delete({ where: { id } });
    await this.audit.record({
      action: AuditAction.DELETE,
      severity: AuditSeverity.WARNING,
      entityType: 'FieldObservation',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Deleted observation "${observation.title}"`,
      before: { category: observation.category, severity: observation.severity },
    });
    return { id, deleted: true };
  }

  /**
   * Offline drain for observations. Every record carries a `clientRef`, so a
   * retry after a failed upload is reported as DUPLICATE instead of creating a
   * second field record.
   */
  async syncOfflineBatch(user: AuthenticatedUser, dto: ObservationSyncDto) {
    const results: Array<{ clientRef: string | undefined; status: 'CREATED' | 'DUPLICATE' | 'REJECTED'; id?: string; error?: string }> = [];
    let created = 0;
    let duplicates = 0;
    let rejected = 0;

    for (const record of dto.records) {
      const existing = await this.prisma.fieldObservation.findUnique({ where: { clientRef: record.clientRef }, select: { id: true } });
      if (existing) {
        duplicates += 1;
        results.push({ clientRef: record.clientRef, status: 'DUPLICATE', id: existing.id });
        continue;
      }
      try {
        const outcome = await this.create(user, record);
        if (outcome.duplicate) {
          duplicates += 1;
          results.push({ clientRef: record.clientRef, status: 'DUPLICATE', id: outcome.observation.id });
        } else {
          created += 1;
          results.push({ clientRef: record.clientRef, status: 'CREATED', id: outcome.observation.id });
        }
      } catch (error) {
        rejected += 1;
        const code = (error as { getResponse?: () => { code?: string } }).getResponse?.()?.code;
        const message = code ?? (error instanceof Error ? error.message : 'Rejected');
        results.push({ clientRef: record.clientRef, status: 'REJECTED', error: message });
        this.logger.warn(`Offline observation ${record.clientRef} rejected: ${message}`);
      }
    }

    if (created > 0) {
      await this.audit.record({
        action: AuditAction.CREATE,
        entityType: 'FieldObservation',
        actorId: user.id,
        actorEmail: user.email,
        description: `Offline sync: ${created} observation(s) created, ${duplicates} duplicate(s), ${rejected} rejected`,
      });
    }

    return { created, duplicates, rejected, results, syncedAt: new Date().toISOString() };
  }

  async statistics(user: AuthenticatedUser, query: ObservationQueryDto) {
    const scope = this.scope(user, query.observedById);
    const where: Prisma.FieldObservationWhereInput = { ...scope };

    const [byCategory, bySeverity, total] = await Promise.all([
      this.prisma.fieldObservation.groupBy({ by: ['category'], where, _count: { _all: true } }),
      this.prisma.fieldObservation.groupBy({ by: ['severity'], where, _count: { _all: true } }),
      this.prisma.fieldObservation.count({ where }),
    ]);

    const monthly = await this.prisma.$queryRaw<Array<{ month: string; count: bigint | number }>>`
      SELECT DATE_FORMAT(capturedAt, '%Y-%m') AS month, COUNT(*) AS count
      FROM field_observations
      WHERE capturedAt >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY month
      ORDER BY month ASC
    `;

    return {
      total,
      byCategory: byCategory.map((row) => ({ category: row.category as ObservationCategory, count: row._count._all })),
      bySeverity: bySeverity.map((row) => ({ severity: row.severity, count: row._count._all })),
      monthly: monthly.map((row) => ({ month: row.month, count: Number(row.count) })),
    };
  }

  private scope(user: AuthenticatedUser, observedById?: string): Prisma.FieldObservationWhereInput {
    // A company account only ever sees the field reports its own staff filed.
    if (user.companyId && !user.permissions.includes('*')) return { observedById: user.id };
    if (canReadAll(user, 'observations')) {
      return observedById ? { observedById } : {};
    }
    // Field operators only see what they recorded themselves.
    return { observedById: user.id };
  }

  private assertVisible(user: AuthenticatedUser, observation: { observedById: string }): void {
    if (observation.observedById === user.id) return;
    if (user.companyId && !user.permissions.includes('*')) {
      throw new ForbiddenException({
        code: 'OBSERVATION_FORBIDDEN',
        message: 'This observation was recorded by another account.',
      });
    }
    if (canReadAll(user, 'observations')) return;
    throw new ForbiddenException({
      code: 'OBSERVATION_FORBIDDEN',
      message: 'This observation was recorded by another officer.',
    });
  }
}
