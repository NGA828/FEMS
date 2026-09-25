import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  ForestStatus,
  GisFeatureType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GisService } from '../gis/gis.service';
import { canReadAll, canReadOwn } from '../common/utils/access-scope.util';
import { resolveOrderBy } from '../common/dto/pagination.dto';
import { assertCoordinates, haversineDistanceKm, parseGeoJsonBoundary } from '../common/utils/geo.util';
import type { AuthenticatedUser } from '../common/decorators';
import type {
  CreateForestDto,
  CreateZoneDto,
  ForestQueryDto,
  UpdateForestDto,
  UpdateZoneDto,
  ZoneQueryDto,
} from './dto/forest.dto';
import type {
  CreateInventoryDto,
  CreateProtectedAreaDto,
  CreateSpeciesDto,
  InventoryQueryDto,
  ProtectedAreaQueryDto,
  SpeciesQueryDto,
  UpdateInventoryDto,
  UpdateProtectedAreaDto,
  UpdateSpeciesDto,
} from './dto/reference.dto';

const FOREST_SORTABLE = ['createdAt', 'name', 'code', 'region', 'totalAreaHa', 'status'] as const;

/** Accepts either a GeoJSON object or a JSON string and validates the polygon. */
function normalizeBoundary(boundary: Record<string, unknown> | string | undefined): string | null | undefined {
  if (boundary === undefined) return undefined;
  if (boundary === null) return null;
  const raw = typeof boundary === 'string' ? boundary : JSON.stringify(boundary);
  const ring = parseGeoJsonBoundary(raw);
  if (!ring || ring.length < 4) {
    throw new BadRequestException({
      code: 'INVALID_BOUNDARY',
      message:
        'boundaryGeoJson must be a GeoJSON Polygon with at least four positions, e.g. {"type":"Polygon","coordinates":[[[lng,lat],…]]}.',
    });
  }
  return raw;
}

@Injectable()
export class ForestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gis: GisService,
  ) {}

  private assertForestVisible(user: AuthenticatedUser | undefined, forest: { isPublic: boolean; status: ForestStatus }) {
    if (canReadAll(user, 'forests')) return;
    if (!forest.isPublic || forest.status !== ForestStatus.ACTIVE) {
      if (user && canReadOwn(user, 'forests')) return;
      throw new ForbiddenException({
        code: 'FOREST_NOT_PUBLIC',
        message: 'This forest is not publicly listed.',
      });
    }
  }

  // ---------------------------------------------------------------- forests

  async listForests(user: AuthenticatedUser | undefined, query: ForestQueryDto) {
    const fullAccess = canReadAll(user, 'forests');
    const where: Prisma.ForestWhereInput = {
      deletedAt: null,
      type: query.type,
      status: query.status,
      region: query.region,
      ...(query.publicOnly || !fullAccess ? { isPublic: true, status: ForestStatus.ACTIVE } : {}),
      OR: query.search
        ? [
            { name: { contains: query.search } },
            { code: { contains: query.search } },
            { region: { contains: query.search } },
            { division: { contains: query.search } },
          ]
        : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.forest.findMany({
        where,
        include: {
          _count: { select: { zones: true, permits: true, activities: true, inventories: true } },
          protectedArea: { select: { id: true, name: true, type: true } },
        },
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, [...FOREST_SORTABLE], 'name'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.forest.count({ where }),
    ]);

    // Optional distance ranking when the caller supplies a real GPS position.
    let distances: Record<string, number> | undefined;
    if (query.nearLatitude !== undefined && query.nearLongitude !== undefined) {
      assertCoordinates(query.nearLatitude, query.nearLongitude, 'search centre');
      distances = {};
      for (const forest of items) {
        distances[forest.id] = Number(
          haversineDistanceKm(
            { latitude: query.nearLatitude, longitude: query.nearLongitude },
            { latitude: Number(forest.latitude), longitude: Number(forest.longitude) },
          ).toFixed(2),
        );
      }
      items.sort((a, b) => (distances![a.id] ?? 0) - (distances![b.id] ?? 0));
    }

    return {
      items: items.map((forest) => ({
        ...forest,
        distanceKm: distances?.[forest.id],
      })),
      total,
    };
  }

  async getForest(user: AuthenticatedUser | undefined, id: string) {
    const forest = await this.prisma.forest.findFirst({
      where: { id, deletedAt: null },
      include: {
        zones: {
          where: { deletedAt: null },
          orderBy: { code: 'asc' },
          include: { _count: { select: { permits: true, activities: true } } },
        },
        protectedArea: true,
        managedBy: { select: { id: true, firstName: true, lastName: true, jobTitle: true } },
        _count: {
          select: { permits: true, activities: true, inventories: true, inspections: true, observations: true },
        },
      },
    });
    if (!forest) throw new NotFoundException({ code: 'FOREST_NOT_FOUND', message: 'Forest not found.' });
    this.assertForestVisible(user, forest);

    const [inventorySummary, permitSummary, recentActivities] = await Promise.all([
      this.prisma.treeInventory.groupBy({
        by: ['speciesId'],
        where: { forestId: id, deletedAt: null },
        _count: { _all: true },
        _sum: { volumeM3: true, treesCounted: true },
      }),
      this.prisma.exploitationPermit.groupBy({
        by: ['status'],
        where: { forestId: id, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.exploitationActivity.findMany({
        where: { forestId: id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          reference: true,
          activityType: true,
          status: true,
          actualStartDate: true,
          harvestedVolumeM3: true,
          company: { select: { id: true, name: true } },
        },
      }),
    ]);

    const species = await this.prisma.treeSpecies.findMany({
      where: { id: { in: inventorySummary.map((row) => row.speciesId) } },
      select: { id: true, commonName: true, scientificName: true, isProtected: true },
    });

    return {
      ...forest,
      inventorySummary: inventorySummary.map((row) => {
        const item = species.find((candidate) => candidate.id === row.speciesId);
        return {
          speciesId: row.speciesId,
          scientificName: item?.scientificName ?? null,
          commonName: item?.commonName ?? null,
          isProtected: item?.isProtected ?? false,
          plots: row._count._all,
          treesCounted: Number(row._sum.treesCounted ?? 0),
          totalVolumeM3: Number(row._sum.volumeM3 ?? 0),
        };
      }),
      permitSummary: permitSummary.map((row) => ({ status: row.status, count: row._count._all })),
      recentActivities,
    };
  }

  async createForest(user: AuthenticatedUser, dto: CreateForestDto) {
    assertCoordinates(dto.latitude, dto.longitude, 'forest location');
    const existing = await this.prisma.forest.findFirst({ where: { code: dto.code, deletedAt: null } });
    if (existing) {
      throw new ConflictException({
        code: 'FOREST_CODE_EXISTS',
        message: `A forest with code ${dto.code} already exists.`,
      });
    }

    const forest = await this.prisma.forest.create({
      data: {
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        type: dto.type,
        status: dto.status ?? ForestStatus.ACTIVE,
        region: dto.region,
        division: dto.division,
        subdivision: dto.subdivision,
        totalAreaHa: dto.totalAreaHa,
        exploitableAreaHa: dto.exploitableAreaHa,
        latitude: dto.latitude,
        longitude: dto.longitude,
        boundaryGeoJson: normalizeBoundary(dto.boundaryGeoJson) ?? null,
        elevationM: dto.elevationM,
        annualAllowableCutM3: dto.annualAllowableCutM3,
        establishedAt: dto.establishedAt ? new Date(dto.establishedAt) : null,
        isPublic: dto.isPublic ?? true,
        managedById: dto.managedById,
        protectedAreaId: dto.protectedAreaId,
        description: dto.description,
        createdById: user.id,
      },
    });

    await this.gis.recordFeature({
      featureType: GisFeatureType.FOREST,
      entityId: forest.id,
      label: forest.name,
      latitude: Number(forest.latitude),
      longitude: Number(forest.longitude),
      elevationM: forest.elevationM,
      forestId: forest.id,
      protectedAreaId: forest.protectedAreaId,
      recordedById: user.id,
      metadata: { code: forest.code, type: forest.type, totalAreaHa: Number(forest.totalAreaHa) },
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'Forest',
      entityId: forest.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Created forest ${forest.code} (${forest.name})`,
      after: { code: forest.code, region: forest.region, totalAreaHa: Number(forest.totalAreaHa) },
    });

    return forest;
  }

  async updateForest(user: AuthenticatedUser, id: string, dto: UpdateForestDto) {
    const before = await this.prisma.forest.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException({ code: 'FOREST_NOT_FOUND', message: 'Forest not found.' });
    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      assertCoordinates(dto.latitude, dto.longitude, 'forest location');
    }

    const updated = await this.prisma.forest.update({
      where: { id },
      data: {
        code: dto.code?.trim().toUpperCase(),
        name: dto.name?.trim(),
        type: dto.type,
        status: dto.status,
        region: dto.region,
        division: dto.division,
        subdivision: dto.subdivision,
        totalAreaHa: dto.totalAreaHa,
        exploitableAreaHa: dto.exploitableAreaHa,
        latitude: dto.latitude,
        longitude: dto.longitude,
        boundaryGeoJson: normalizeBoundary(dto.boundaryGeoJson),
        elevationM: dto.elevationM,
        annualAllowableCutM3: dto.annualAllowableCutM3,
        establishedAt: dto.establishedAt ? new Date(dto.establishedAt) : undefined,
        isPublic: dto.isPublic,
        managedById: dto.managedById,
        description: dto.description,
      },
    });

    if (dto.latitude !== undefined || dto.boundaryGeoJson !== undefined) {
      await this.gis.recordFeature({
        featureType: GisFeatureType.FOREST,
        entityId: id,
        label: updated.name,
        latitude: Number(updated.latitude),
        longitude: Number(updated.longitude),
        forestId: id,
        recordedById: user.id,
      });
    }

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Forest',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Updated forest ${before.code}`,
      before: { name: before.name, status: before.status, totalAreaHa: Number(before.totalAreaHa) },
      after: { name: updated.name, status: updated.status, totalAreaHa: Number(updated.totalAreaHa) },
    });

    return updated;
  }

  async deleteForest(user: AuthenticatedUser, id: string) {
    const forest = await this.prisma.forest.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { permits: true, activities: true } } },
    });
    if (!forest) throw new NotFoundException({ code: 'FOREST_NOT_FOUND', message: 'Forest not found.' });

    const activePermits = await this.prisma.exploitationPermit.count({
      where: { forestId: id, deletedAt: null, status: { in: ['APPROVED', 'ACTIVE'] } },
    });
    if (activePermits > 0) {
      throw new BadRequestException({
        code: 'FOREST_HAS_ACTIVE_PERMITS',
        message: `This forest has ${activePermits} active permit(s) and cannot be archived.`,
      });
    }

    await this.prisma.forest.update({
      where: { id },
      data: { deletedAt: new Date(), status: ForestStatus.CLOSED },
    });
    await this.gis.removeFeature(GisFeatureType.FOREST, id);

    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'Forest',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Archived forest ${forest.code} (${forest.name})`,
    });

    return { id, deleted: true };
  }

  // ------------------------------------------------------------------ zones

  async listZones(user: AuthenticatedUser | undefined, forestId: string, query: ZoneQueryDto) {
    const forest = await this.prisma.forest.findFirst({ where: { id: forestId, deletedAt: null } });
    if (!forest) throw new NotFoundException({ code: 'FOREST_NOT_FOUND', message: 'Forest not found.' });
    this.assertForestVisible(user, forest);

    const where: Prisma.ForestZoneWhereInput = {
      forestId,
      deletedAt: null,
      zoneType: query.zoneType,
      status: query.status,
      isProtected: query.isProtected,
      OR: query.search
        ? [{ name: { contains: query.search } }, { code: { contains: query.search } }]
        : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.forestZone.findMany({
        where,
        include: { _count: { select: { activities: true, permits: true, inventories: true } } },
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, ['code', 'name', 'areaHa', 'createdAt'], 'code'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.forestZone.count({ where }),
    ]);
    return { items, total };
  }

  async createZone(user: AuthenticatedUser, forestId: string, dto: CreateZoneDto) {
    const forest = await this.prisma.forest.findFirst({ where: { id: forestId, deletedAt: null } });
    if (!forest) throw new NotFoundException({ code: 'FOREST_NOT_FOUND', message: 'Forest not found.' });
    assertCoordinates(dto.latitude, dto.longitude, 'zone location');

    const existing = await this.prisma.forestZone.findFirst({
      where: { forestId, code: dto.code, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException({
        code: 'ZONE_CODE_EXISTS',
        message: `Zone code ${dto.code} already exists in ${forest.code}.`,
      });
    }

    const zone = await this.prisma.forestZone.create({
      data: {
        forestId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        zoneType: dto.zoneType,
        status: dto.status,
        areaHa: dto.areaHa,
        latitude: dto.latitude,
        longitude: dto.longitude,
        boundaryGeoJson: normalizeBoundary(dto.boundaryGeoJson) ?? null,
        maxAnnualYieldM3: dto.maxAnnualYieldM3,
        conservationPriority: dto.conservationPriority ?? 0,
        isProtected: dto.isProtected ?? false,
        description: dto.description,
        createdById: user.id,
      },
    });

    await this.gis.recordFeature({
      featureType: GisFeatureType.FOREST_ZONE,
      entityId: zone.id,
      label: `${forest.code} · ${zone.name}`,
      latitude: Number(zone.latitude),
      longitude: Number(zone.longitude),
      forestId,
      zoneId: zone.id,
      recordedById: user.id,
      metadata: { zoneType: zone.zoneType, isProtected: zone.isProtected, areaHa: Number(zone.areaHa) },
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'ForestZone',
      entityId: zone.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Created zone ${zone.code} in forest ${forest.code}`,
      after: { code: zone.code, zoneType: zone.zoneType, areaHa: Number(zone.areaHa) },
    });

    return zone;
  }

  async updateZone(user: AuthenticatedUser, id: string, dto: UpdateZoneDto) {
    const before = await this.prisma.forestZone.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException({ code: 'ZONE_NOT_FOUND', message: 'Zone not found.' });
    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      assertCoordinates(dto.latitude, dto.longitude, 'zone location');
    }

    const updated = await this.prisma.forestZone.update({
      where: { id },
      data: {
        code: dto.code?.trim().toUpperCase(),
        name: dto.name?.trim(),
        zoneType: dto.zoneType,
        status: dto.status,
        areaHa: dto.areaHa,
        latitude: dto.latitude,
        longitude: dto.longitude,
        boundaryGeoJson: normalizeBoundary(dto.boundaryGeoJson),
        maxAnnualYieldM3: dto.maxAnnualYieldM3,
        conservationPriority: dto.conservationPriority,
        isProtected: dto.isProtected,
        description: dto.description,
      },
    });

    await this.gis.recordFeature({
      featureType: GisFeatureType.FOREST_ZONE,
      entityId: id,
      label: updated.name,
      latitude: Number(updated.latitude),
      longitude: Number(updated.longitude),
      forestId: updated.forestId,
      zoneId: id,
      recordedById: user.id,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'ForestZone',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Updated zone ${before.code}`,
      before: { status: before.status, isProtected: before.isProtected },
      after: { status: updated.status, isProtected: updated.isProtected },
    });

    return updated;
  }

  async deleteZone(user: AuthenticatedUser, id: string) {
    const zone = await this.prisma.forestZone.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { activities: true, permits: true } } },
    });
    if (!zone) throw new NotFoundException({ code: 'ZONE_NOT_FOUND', message: 'Zone not found.' });
    const openActivities = await this.prisma.exploitationActivity.count({
      where: { zoneId: id, deletedAt: null, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
    });
    if (openActivities > 0) {
      throw new BadRequestException({
        code: 'ZONE_HAS_OPEN_ACTIVITIES',
        message: `This zone has ${openActivities} scheduled or in-progress activity(ies).`,
      });
    }

    await this.prisma.forestZone.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.gis.removeFeature(GisFeatureType.FOREST_ZONE, id);
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'ForestZone',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Archived zone ${zone.code}`,
    });
    return { id, deleted: true };
  }

  // -------------------------------------------------------- protected areas

  async listProtectedAreas(query: ProtectedAreaQueryDto) {
    const where: Prisma.ProtectedAreaWhereInput = {
      deletedAt: null,
      type: query.type,
      status: query.status,
      region: query.region,
      OR: query.search ? [{ name: { contains: query.search } }, { code: { contains: query.search } }] : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.protectedArea.findMany({
        where,
        include: { _count: { select: { forests: true, violations: true, observations: true } } },
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, ['name', 'code', 'areaHa', 'createdAt'], 'name'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.protectedArea.count({ where }),
    ]);
    return { items, total };
  }

  async getProtectedArea(id: string) {
    const area = await this.prisma.protectedArea.findFirst({
      where: { id, deletedAt: null },
      include: {
        forests: { where: { deletedAt: null }, select: { id: true, code: true, name: true, totalAreaHa: true } },
        _count: { select: { violations: true, observations: true, inspections: true, aiAlerts: true } },
      },
    });
    if (!area) throw new NotFoundException({ code: 'PROTECTED_AREA_NOT_FOUND', message: 'Protected area not found.' });
    return area;
  }

  async createProtectedArea(user: AuthenticatedUser, dto: CreateProtectedAreaDto) {
    assertCoordinates(dto.latitude, dto.longitude, 'protected area location');
    const existing = await this.prisma.protectedArea.findFirst({ where: { code: dto.code, deletedAt: null } });
    if (existing) {
      throw new ConflictException({
        code: 'PROTECTED_AREA_CODE_EXISTS',
        message: `Protected area code ${dto.code} already exists.`,
      });
    }
    const area = await this.prisma.protectedArea.create({
      data: {
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        type: dto.type,
        status: dto.status,
        region: dto.region,
        areaHa: dto.areaHa,
        latitude: dto.latitude,
        longitude: dto.longitude,
        boundaryGeoJson: normalizeBoundary(dto.boundaryGeoJson) ?? null,
        establishedAt: dto.establishedAt ? new Date(dto.establishedAt) : null,
        managingAuthority: dto.managingAuthority,
        encroachmentRisk: dto.encroachmentRisk,
        description: dto.description,
        biodiversityNotes: dto.biodiversityNotes,
        createdById: user.id,
      },
    });

    await this.gis.recordFeature({
      featureType: GisFeatureType.PROTECTED_AREA,
      entityId: area.id,
      label: area.name,
      latitude: Number(area.latitude),
      longitude: Number(area.longitude),
      protectedAreaId: area.id,
      recordedById: user.id,
      metadata: { type: area.type, areaHa: Number(area.areaHa) },
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'ProtectedArea',
      entityId: area.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Created protected area ${area.code} (${area.name})`,
    });

    return area;
  }

  async updateProtectedArea(user: AuthenticatedUser, id: string, dto: UpdateProtectedAreaDto) {
    const before = await this.prisma.protectedArea.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException({ code: 'PROTECTED_AREA_NOT_FOUND', message: 'Protected area not found.' });
    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      assertCoordinates(dto.latitude, dto.longitude, 'protected area location');
    }
    const updated = await this.prisma.protectedArea.update({
      where: { id },
      data: {
        code: dto.code?.trim().toUpperCase(),
        name: dto.name?.trim(),
        type: dto.type,
        status: dto.status,
        region: dto.region,
        areaHa: dto.areaHa,
        latitude: dto.latitude,
        longitude: dto.longitude,
        boundaryGeoJson: normalizeBoundary(dto.boundaryGeoJson),
        establishedAt: dto.establishedAt ? new Date(dto.establishedAt) : undefined,
        managingAuthority: dto.managingAuthority,
        encroachmentRisk: dto.encroachmentRisk,
        description: dto.description,
        biodiversityNotes: dto.biodiversityNotes,
      },
    });

    await this.gis.recordFeature({
      featureType: GisFeatureType.PROTECTED_AREA,
      entityId: id,
      label: updated.name,
      latitude: Number(updated.latitude),
      longitude: Number(updated.longitude),
      protectedAreaId: id,
      recordedById: user.id,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'ProtectedArea',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Updated protected area ${before.code}`,
    });

    return updated;
  }

  async deleteProtectedArea(user: AuthenticatedUser, id: string) {
    const area = await this.prisma.protectedArea.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { forests: true } } },
    });
    if (!area) throw new NotFoundException({ code: 'PROTECTED_AREA_NOT_FOUND', message: 'Protected area not found.' });
    if (area._count.forests > 0) {
      throw new BadRequestException({
        code: 'PROTECTED_AREA_IN_USE',
        message: `${area._count.forests} forest(s) reference this protected area.`,
      });
    }
    await this.prisma.protectedArea.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.gis.removeFeature(GisFeatureType.PROTECTED_AREA, id);
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'ProtectedArea',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Archived protected area ${area.code}`,
    });
    return { id, deleted: true };
  }

  // ------------------------------------------------------------ tree species

  async listSpecies(query: SpeciesQueryDto) {
    const where: Prisma.TreeSpeciesWhereInput = {
      deletedAt: null,
      isProtected: query.protectedOnly ? true : undefined,
      isCommercial: query.commercialOnly ? true : undefined,
      OR: query.search
        ? [
            { scientificName: { contains: query.search } },
            { commonName: { contains: query.search } },
            { localName: { contains: query.search } },
          ]
        : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.treeSpecies.findMany({
        where,
        include: { _count: { select: { inventories: true } } },
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, ['commonName', 'scientificName', 'createdAt'], 'commonName'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.treeSpecies.count({ where }),
    ]);
    return { items, total };
  }

  async createSpecies(user: AuthenticatedUser, dto: CreateSpeciesDto) {
    const existing = await this.prisma.treeSpecies.findFirst({
      where: { scientificName: dto.scientificName, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException({
        code: 'SPECIES_EXISTS',
        message: `${dto.scientificName} is already in the catalogue.`,
      });
    }
    const species = await this.prisma.treeSpecies.create({
      data: {
        scientificName: dto.scientificName.trim(),
        commonName: dto.commonName.trim(),
        familyName: dto.familyName,
        localName: dto.localName,
        iucnStatus: dto.iucnStatus,
        isProtected: dto.isProtected ?? false,
        isCommercial: dto.isCommercial ?? true,
        maxHarvestDiameterCm: dto.maxHarvestDiameterCm,
        minRotationYears: dto.minRotationYears,
        woodDensityKgM3: dto.woodDensityKgM3,
        description: dto.description,
        createdById: user.id,
      },
    });
    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'TreeSpecies',
      entityId: species.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Added species ${species.commonName} (${species.scientificName})`,
    });
    return species;
  }

  async updateSpecies(user: AuthenticatedUser, id: string, dto: UpdateSpeciesDto) {
    const before = await this.prisma.treeSpecies.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException({ code: 'SPECIES_NOT_FOUND', message: 'Species not found.' });
    const updated = await this.prisma.treeSpecies.update({
      where: { id },
      data: {
        scientificName: dto.scientificName?.trim(),
        commonName: dto.commonName?.trim(),
        familyName: dto.familyName,
        localName: dto.localName,
        iucnStatus: dto.iucnStatus,
        isProtected: dto.isProtected,
        isCommercial: dto.isCommercial,
        maxHarvestDiameterCm: dto.maxHarvestDiameterCm,
        minRotationYears: dto.minRotationYears,
        woodDensityKgM3: dto.woodDensityKgM3,
        description: dto.description,
      },
    });
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'TreeSpecies',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Updated species ${before.commonName}`,
    });
    return updated;
  }

  async deleteSpecies(user: AuthenticatedUser, id: string) {
    const species = await this.prisma.treeSpecies.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { inventories: true } } },
    });
    if (!species) throw new NotFoundException({ code: 'SPECIES_NOT_FOUND', message: 'Species not found.' });
    if (species._count.inventories > 0) {
      throw new BadRequestException({
        code: 'SPECIES_IN_USE',
        message: `${species._count.inventories} inventory record(s) reference this species.`,
      });
    }
    await this.prisma.treeSpecies.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'TreeSpecies',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Archived species ${species.scientificName}`,
    });
    return { id, deleted: true };
  }

  // --------------------------------------------------------------- inventory

  async listInventory(query: InventoryQueryDto) {
    const where: Prisma.TreeInventoryWhereInput = {
      deletedAt: null,
      forestId: query.forestId,
      zoneId: query.zoneId,
      speciesId: query.speciesId,
      healthStatus: query.healthStatus,
      surveyDate: query.surveyedAfter ? { gte: new Date(query.surveyedAfter) } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.treeInventory.findMany({
        where,
        include: {
          forest: { select: { id: true, code: true, name: true } },
          zone: { select: { id: true, code: true, name: true } },
          species: { select: { id: true, commonName: true, scientificName: true, isProtected: true } },
          recordedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, ['surveyDate', 'createdAt', 'volumeM3'], 'surveyDate'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.treeInventory.count({ where }),
    ]);
    return { items, total };
  }

  async createInventory(user: AuthenticatedUser, dto: CreateInventoryDto) {
    assertCoordinates(dto.latitude, dto.longitude, 'plot location');
    const [forest, species, zone] = await Promise.all([
      this.prisma.forest.findFirst({ where: { id: dto.forestId, deletedAt: null } }),
      this.prisma.treeSpecies.findFirst({ where: { id: dto.speciesId, deletedAt: null } }),
      dto.zoneId ? this.prisma.forestZone.findFirst({ where: { id: dto.zoneId, deletedAt: null } }) : null,
    ]);
    if (!forest) throw new NotFoundException({ code: 'FOREST_NOT_FOUND', message: 'Forest not found.' });
    if (!species) throw new NotFoundException({ code: 'SPECIES_NOT_FOUND', message: 'Species not found.' });
    if (dto.zoneId && !zone) throw new NotFoundException({ code: 'ZONE_NOT_FOUND', message: 'Zone not found.' });
    if (dto.zoneId && zone && zone.forestId !== dto.forestId) {
      throw new BadRequestException({
        code: 'ZONE_FOREST_MISMATCH',
        message: 'The selected zone does not belong to the selected forest.',
      });
    }

    const record = await this.prisma.treeInventory.create({
      data: {
        forestId: dto.forestId,
        zoneId: dto.zoneId,
        speciesId: dto.speciesId,
        surveyDate: new Date(dto.surveyDate),
        plotCode: dto.plotCode,
        treesCounted: dto.treesCounted,
        averageDiameterCm: dto.averageDiameterCm,
        averageHeightM: dto.averageHeightM,
        volumeM3: dto.volumeM3,
        densityPerHa: dto.densityPerHa,
        healthStatus: dto.healthStatus,
        latitude: dto.latitude,
        longitude: dto.longitude,
        notes: dto.notes,
        recordedById: user.id,
      },
    });

    await this.prisma.forest.update({
      where: { id: dto.forestId },
      data: { lastInventoriedAt: new Date() },
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'TreeInventory',
      entityId: record.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Recorded inventory plot ${record.plotCode} (${species.commonName}) in ${forest.code}`,
      after: { treesCounted: dto.treesCounted, volumeM3: dto.volumeM3 ?? null },
    });

    return record;
  }

  async updateInventory(user: AuthenticatedUser, id: string, dto: UpdateInventoryDto) {
    const before = await this.prisma.treeInventory.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException({ code: 'INVENTORY_NOT_FOUND', message: 'Inventory record not found.' });
    const updated = await this.prisma.treeInventory.update({
      where: { id },
      data: {
        plotCode: dto.plotCode,
        treesCounted: dto.treesCounted,
        averageDiameterCm: dto.averageDiameterCm,
        averageHeightM: dto.averageHeightM,
        volumeM3: dto.volumeM3,
        densityPerHa: dto.densityPerHa,
        healthStatus: dto.healthStatus,
        latitude: dto.latitude,
        longitude: dto.longitude,
        notes: dto.notes,
      },
    });
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'TreeInventory',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Corrected inventory plot ${before.plotCode}`,
      before: { treesCounted: before.treesCounted, volumeM3: before.volumeM3 === null ? null : Number(before.volumeM3) },
      after: { treesCounted: updated.treesCounted, volumeM3: updated.volumeM3 === null ? null : Number(updated.volumeM3) },
    });
    return updated;
  }

  async deleteInventory(user: AuthenticatedUser, id: string) {
    const record = await this.prisma.treeInventory.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException({ code: 'INVENTORY_NOT_FOUND', message: 'Inventory record not found.' });
    await this.prisma.treeInventory.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'TreeInventory',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Removed inventory plot ${record.plotCode}`,
    });
    return { id, deleted: true };
  }

  // -------------------------------------------------------------- statistics

  async inventoryStatistics(forestId?: string) {
    const where: Prisma.TreeInventoryWhereInput = { deletedAt: null, forestId };
    const [plots, totals, bySpecies, byHealth] = await Promise.all([
      this.prisma.treeInventory.count({ where }),
      this.prisma.treeInventory.aggregate({
        where,
        _sum: { treesCounted: true, volumeM3: true },
        _avg: { averageDiameterCm: true, averageHeightM: true },
      }),
      this.prisma.treeInventory.groupBy({
        by: ['speciesId'],
        where,
        _sum: { treesCounted: true, volumeM3: true },
        orderBy: { _sum: { volumeM3: 'desc' } },
        take: 10,
      }),
      this.prisma.treeInventory.groupBy({ by: ['healthStatus'], where, _count: { _all: true } }),
    ]);

    const species = await this.prisma.treeSpecies.findMany({
      where: { id: { in: bySpecies.map((row) => row.speciesId) } },
      select: { id: true, commonName: true, scientificName: true, iucnStatus: true },
    });

    return {
      plots,
      treesCounted: Number(totals._sum.treesCounted ?? 0),
      totalVolumeM3: Number(totals._sum.volumeM3 ?? 0),
      averageDiameterCm: totals._avg.averageDiameterCm === null ? null : Number(totals._avg.averageDiameterCm),
      averageHeightM: totals._avg.averageHeightM === null ? null : Number(totals._avg.averageHeightM),
      topSpecies: bySpecies.map((row) => {
        const item = species.find((candidate) => candidate.id === row.speciesId);
        return {
          speciesId: row.speciesId,
          commonName: item?.commonName ?? null,
          scientificName: item?.scientificName ?? null,
          iucnStatus: item?.iucnStatus ?? null,
          treesCounted: Number(row._sum.treesCounted ?? 0),
          volumeM3: Number(row._sum.volumeM3 ?? 0),
        };
      }),
      byHealth: byHealth.map((row) => ({ healthStatus: row.healthStatus, count: row._count._all })),
    };
  }

  /** Dashboard aggregate for the forest resource map and list screens. */
  async statistics() {
    const [total, byType, byStatus, byRegion, areaSum, protectedCount] = await Promise.all([
      this.prisma.forest.count({ where: { deletedAt: null } }),
      this.prisma.forest.groupBy({ by: ['type'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.forest.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.forest.groupBy({
        by: ['region'],
        where: { deletedAt: null },
        _count: { _all: true },
        orderBy: { _count: { region: 'desc' } },
      }),
      this.prisma.forest.aggregate({ where: { deletedAt: null }, _sum: { totalAreaHa: true, exploitableAreaHa: true } }),
      this.prisma.protectedArea.count({ where: { deletedAt: null } }),
    ]);

    return {
      total,
      byType: byType.map((row) => ({ type: row.type, count: row._count._all })),
      byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
      byRegion: byRegion.map((row) => ({ region: row.region, count: row._count._all })),
      totalAreaHa: Number(areaSum._sum.totalAreaHa ?? 0),
      exploitableAreaHa: Number(areaSum._sum.exploitableAreaHa ?? 0),
      protectedAreas: protectedCount,
    };
  }

  /** Serialised boundary for clients that draw polygons on the web map. */
  static boundaryOf(forest: { boundaryGeoJson: string | null }): Record<string, unknown> | null {
    if (!forest.boundaryGeoJson) return null;
    try {
      return JSON.parse(forest.boundaryGeoJson) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
