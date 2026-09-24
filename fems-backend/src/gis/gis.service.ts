import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { GisFeatureType, GpsSource, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertCoordinates, evaluateGpsAccuracy, haversineDistanceKm, haversineSql } from '../common/utils/geo.util';
import { stringifyJson } from '../common/utils/json.util';
import type { AuthenticatedUser } from '../common/decorators';
import type { MapQueryDto, NearbyQueryDto, RecordPositionDto } from './dto/gis.dto';

export interface RecordFeatureInput {
  featureType: GisFeatureType;
  entityId: string;
  label: string;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  elevationM?: number | null;
  source?: GpsSource;
  forestId?: string | null;
  zoneId?: string | null;
  protectedAreaId?: string | null;
  activityId?: string | null;
  inspectionId?: string | null;
  observationId?: string | null;
  violationId?: string | null;
  aiAlertId?: string | null;
  recordedById?: string | null;
  isDemo?: boolean;
  metadata?: unknown;
  /** Keep every position (field sessions / check-ins) instead of replacing. */
  keepHistory?: boolean;
}

/**
 * GIS feature registry.
 *
 * Every location the platform knows about — forests, zones, protected areas,
 * activities, inspections, observations, violations, AI alerts and user
 * check-ins — is mirrored into `gis_locations`, which powers the map screen and
 * proximity queries. Coordinates are validated on write (lat -90..90, lng
 * -180..180) and device fixes are checked against the GPS accuracy policy, so a
 * bad fix can never be stored silently.
 */
@Injectable()
export class GisService {
  private readonly logger = new Logger(GisService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Creates or refreshes the map feature that mirrors a domain record. */
  async recordFeature(input: RecordFeatureInput): Promise<{ id: string }> {
    const { latitude, longitude } = assertCoordinates(input.latitude, input.longitude, 'feature location');
    const data: Prisma.GISLocationUncheckedCreateInput = {
      featureType: input.featureType,
      entityId: input.entityId,
      label: input.label.slice(0, 191),
      latitude,
      longitude,
      accuracyM: input.accuracyM ?? null,
      elevationM: input.elevationM ?? null,
      source: input.source ?? GpsSource.SYSTEM_RECORDED,
      forestId: input.forestId ?? null,
      zoneId: input.zoneId ?? null,
      protectedAreaId: input.protectedAreaId ?? null,
      activityId: input.activityId ?? null,
      inspectionId: input.inspectionId ?? null,
      observationId: input.observationId ?? null,
      violationId: input.violationId ?? null,
      aiAlertId: input.aiAlertId ?? null,
      recordedById: input.recordedById ?? null,
      recordedAt: new Date(),
      isDemo: input.isDemo ?? false,
      metadataJson: stringifyJson(input.metadata),
    };

    if (!input.keepHistory) {
      const existing = await this.prisma.gISLocation.findFirst({
        where: { featureType: input.featureType, entityId: input.entityId },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.gISLocation.update({ where: { id: existing.id }, data });
        return { id: existing.id };
      }
    }

    const created = await this.prisma.gISLocation.create({ data });
    return { id: created.id };
  }

  /** Removes the map feature of a deleted domain record. */
  async removeFeature(featureType: GisFeatureType, entityId: string): Promise<void> {
    await this.prisma.gISLocation.deleteMany({ where: { featureType, entityId } });
  }

  /**
   * GeoJSON FeatureCollection for the map screen.
   * Supports a bounding box so the mobile map only pulls what it can display.
   */
  async mapFeatures(query: MapQueryDto) {
    const where: Prisma.GISLocationWhereInput = {
      featureType: query.featureTypes?.length ? { in: query.featureTypes } : undefined,
      forestId: query.forestId,
    };
    if (query.minLat !== undefined && query.maxLat !== undefined) {
      where.latitude = { gte: query.minLat, lte: query.maxLat };
    }
    if (query.minLng !== undefined && query.maxLng !== undefined) {
      where.longitude = { gte: query.minLng, lte: query.maxLng };
    }

    const locations = await this.prisma.gISLocation.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take: query.limit,
    });

    return {
      type: 'FeatureCollection' as const,
      features: locations.map((location) => ({
        type: 'Feature' as const,
        id: location.id,
        geometry: {
          type: 'Point' as const,
          coordinates: [Number(location.longitude), Number(location.latitude)],
        },
        properties: {
          id: location.id,
          featureType: location.featureType,
          entityId: location.entityId,
          label: location.label,
          accuracyM: location.accuracyM === null ? null : Number(location.accuracyM),
          source: location.source,
          forestId: location.forestId,
          zoneId: location.zoneId,
          protectedAreaId: location.protectedAreaId,
          activityId: location.activityId,
          inspectionId: location.inspectionId,
          observationId: location.observationId,
          violationId: location.violationId,
          aiAlertId: location.aiAlertId,
          recordedById: location.recordedById,
          recordedAt: location.recordedAt,
          isDemo: location.isDemo,
        },
      })),
      meta: { count: locations.length, limit: query.limit },
    };
  }

  /** Layer legend + counts used by the map's filter panel. */
  async layerSummary() {
    const grouped = await this.prisma.gISLocation.groupBy({
      by: ['featureType'],
      _count: { _all: true },
      orderBy: { featureType: 'asc' },
    });
    return {
      layers: grouped.map((row) => ({ featureType: row.featureType, count: row._count._all })),
      total: grouped.reduce((sum, row) => sum + row._count._all, 0),
    };
  }

  /**
   * Proximity search using the Haversine formula executed in MySQL — the same
   * maths as the TypeScript helper, so app and database always agree.
   */
  async nearby(query: NearbyQueryDto) {
    assertCoordinates(query.latitude, query.longitude);
    const distanceSql = haversineSql('latitude', 'longitude');
    const filters: string[] = [];
    const params: unknown[] = [query.latitude, query.longitude, query.latitude];
    if (query.featureTypes?.length) {
      filters.push(`featureType IN (${query.featureTypes.map(() => '?').join(', ')})`);
      params.push(...query.featureTypes);
    }
    const whereClause = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';

    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, featureType, entityId, label, latitude, longitude, recordedAt, forestId, zoneId, ` +
        `${distanceSql} AS distanceKm FROM gis_locations${whereClause} ` +
        `HAVING distanceKm <= ? ORDER BY distanceKm ASC LIMIT ?`,
      ...params,
      query.radiusKm,
      query.limit,
    );

    return {
      origin: { latitude: query.latitude, longitude: query.longitude },
      radiusKm: query.radiusKm,
      results: rows.map((row) => ({
        id: String(row.id),
        featureType: String(row.featureType),
        entityId: String(row.entityId),
        label: String(row.label),
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        distanceKm: Number(row.distanceKm),
        recordedAt: row.recordedAt,
        forestId: row.forestId ? String(row.forestId) : null,
        zoneId: row.zoneId ? String(row.zoneId) : null,
      })),
    };
  }

  /**
   * Records a device position (field check-in). The accuracy policy is enforced
   * unless the caller holds field-verification rights, in which case the
   * position is stored as a MANUAL_CORRECTION with the reason.
   */
  async recordPosition(user: AuthenticatedUser, dto: RecordPositionDto) {
    const { latitude, longitude } = assertCoordinates(dto.latitude, dto.longitude, 'device position');
    const accuracy = evaluateGpsAccuracy(dto.accuracyM);
    const canOverride = user.permissions.includes('*') || user.permissions.includes('inspections:verify_field_data');

    if (!accuracy.accepted && !canOverride) {
      throw new BadRequestException({
        code: 'GPS_ACCURACY_TOO_LOW',
        message: accuracy.warning ?? 'The GPS fix is not accurate enough to be recorded.',
        details: { accuracyM: dto.accuracyM, maximumAccuracyM: 50 },
      });
    }
    if (dto.mocked && !canOverride) {
      throw new BadRequestException({
        code: 'MOCK_LOCATION_REJECTED',
        message: 'The device reported a mocked location. FEMS only records genuine GPS fixes.',
      });
    }

    let source: GpsSource = dto.source ?? GpsSource.DEVICE_GPS;
    if (!accuracy.accepted) {
      source = GpsSource.MANUAL_CORRECTION;
      this.logger.warn(
        `User ${user.id} stored a position with ${dto.accuracyM} m accuracy (override permission held).`,
      );
    }
    if (dto.source === GpsSource.DEVICE_GPS && dto.mocked) source = GpsSource.MANUAL_CORRECTION;

    const location = await this.prisma.gISLocation.create({
      data: {
        featureType: GisFeatureType.USER_CHECKIN,
        entityId: user.id,
        label: dto.label ?? `Field position — ${user.firstName} ${user.lastName}`,
        latitude,
        longitude,
        accuracyM: dto.accuracyM ?? null,
        elevationM: dto.elevationM ?? null,
        source,
        recordedById: user.id,
        recordedAt: dto.capturedAt ? new Date(dto.capturedAt) : new Date(),
        metadataJson: stringifyJson({
          clientRef: dto.clientRef ?? null,
          fieldSessionId: dto.fieldSessionId ?? null,
          accuracyWarning: accuracy.warning,
          mocked: dto.mocked ?? false,
        }),
      },
    });

    return {
      id: location.id,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      accuracyM: dto.accuracyM ?? null,
      source: location.source,
      warning: accuracy.warning,
      recordedAt: location.recordedAt,
    };
  }

  /** Distance between the device fix and a domain record (proximity checks). */
  async distanceTo(
    origin: { latitude: number; longitude: number },
    featureType: GisFeatureType,
    entityId: string,
  ): Promise<{ distanceKm: number; distanceM: number } | null> {
    assertCoordinates(origin.latitude, origin.longitude, 'origin');
    const target = await this.prisma.gISLocation.findFirst({
      where: { featureType, entityId },
      orderBy: { recordedAt: 'desc' },
    });
    if (!target) return null;
    const distanceKm = haversineDistanceKm(origin, {
      latitude: Number(target.latitude),
      longitude: Number(target.longitude),
    });
    return { distanceKm: Number(distanceKm.toFixed(3)), distanceM: Math.round(distanceKm * 1000) };
  }

  async checkinHistory(userId: string, limit = 50) {
    const locations = await this.prisma.gISLocation.findMany({
      where: { featureType: GisFeatureType.USER_CHECKIN, entityId: userId },
      orderBy: { recordedAt: 'desc' },
      take: limit,
    });
    return locations.map((location) => ({
      id: location.id,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      accuracyM: location.accuracyM === null ? null : Number(location.accuracyM),
      source: location.source,
      label: location.label,
      recordedAt: location.recordedAt,
    }));
  }

  async statistics() {
    const [layers, forestCount, zoneCount, withoutBoundary, checkins] = await Promise.all([
      this.prisma.gISLocation.groupBy({ by: ['featureType'], _count: { _all: true } }),
      this.prisma.forest.count({ where: { deletedAt: null } }),
      this.prisma.forestZone.count({ where: { deletedAt: null } }),
      this.prisma.forest.count({ where: { deletedAt: null, boundaryGeoJson: null } }),
      this.prisma.gISLocation.count({ where: { featureType: GisFeatureType.USER_CHECKIN } }),
    ]);
    return {
      featureCounts: layers.map((row) => ({ featureType: row.featureType, count: row._count._all })),
      forests: forestCount,
      zones: zoneCount,
      forestsWithoutBoundary: withoutBoundary,
      fieldCheckins: checkins,
    };
  }

  /** Guards manual coordinate edits (only field-verification roles may override). */
  assertCanSetCoordinates(user: AuthenticatedUser, hasCoordinates: boolean): void {
    if (!hasCoordinates) return;
    const allowed =
      user.permissions.includes('*') ||
      user.permissions.includes('gis:manage') ||
      user.permissions.includes('gis:record_location') ||
      user.permissions.includes('inspections:verify_field_data');
    if (!allowed) {
      throw new ForbiddenException({
        code: 'COORDINATES_FORBIDDEN',
        message: 'You are not allowed to set coordinates manually for this record.',
      });
    }
  }
}
