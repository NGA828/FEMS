import { Injectable, Logger, Scope } from '@nestjs/common';
import { AuditAction, AuditSeverity, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseJsonArray, stringifyJson } from '../common/utils/json.util';

export interface AuditEntry {
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  description?: string;
  severity?: AuditSeverity;
  actorId?: string | null;
  actorEmail?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditListFilters {
  actorId?: string;
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  severity?: AuditSeverity;
  from?: Date;
  to?: Date;
  search?: string;
  page: number;
  limit: number;
}

/**
 * Audit trail.
 *
 * Sensitive operations (status changes, payment verification, role assignment,
 * exports, settings changes, field-data corrections) are recorded here. Writes
 * are best-effort: a logging failure must never break the business operation,
 * but it is surfaced in the API logs.
 */
@Injectable({ scope: Scope.DEFAULT })
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, client: Prisma.TransactionClient | PrismaService = this.prisma): Promise<void> {
    try {
      await client.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? null,
          action: entry.action,
          severity: entry.severity ?? AuditSeverity.INFO,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          description: entry.description?.slice(0, 500) ?? null,
          beforeJson: stringifyJson(entry.before),
          afterJson: stringifyJson(entry.after),
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent?.slice(0, 255) ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to write audit entry ${entry.action}: ${(error as Error).message}`);
    }
  }

  async list(filters: AuditListFilters) {
    const where: Prisma.AuditLogWhereInput = {
      actorId: filters.actorId,
      action: filters.action,
      entityType: filters.entityType,
      entityId: filters.entityId,
      severity: filters.severity,
      createdAt:
        filters.from || filters.to
          ? { gte: filters.from ?? undefined, lte: filters.to ?? undefined }
          : undefined,
      OR: filters.search
        ? [
            { description: { contains: filters.search } },
            { actorEmail: { contains: filters.search } },
            { entityId: { contains: filters.search } },
          ]
        : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        before: parseJsonArray(item.beforeJson),
        after: parseJsonArray(item.afterJson),
      })),
      meta: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
        hasNextPage: filters.page < Math.ceil(total / filters.limit),
        hasPreviousPage: filters.page > 1,
      },
    };
  }

  /** Statistics for the administrator monitoring screen. */
  async summary(days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [total, byAction, bySeverity, recentActors] = await Promise.all([
      this.prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
      this.prisma.auditLog.groupBy({
        by: ['action'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.auditLog.groupBy({
        by: ['severity'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.auditLog.groupBy({
        by: ['actorId'],
        where: { createdAt: { gte: since }, actorId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { actorId: 'desc' } },
        take: 5,
      }),
    ]);

    const actorIds = recentActors.map((row) => row.actorId).filter((id): id is string => Boolean(id));
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];

    return {
      windowDays: days,
      total,
      byAction: byAction.map((row) => ({ action: row.action, count: row._count._all })),
      bySeverity: bySeverity.map((row) => ({ severity: row.severity, count: row._count._all })),
      mostActiveUsers: recentActors.map((row) => {
        const actor = actors.find((candidate) => candidate.id === row.actorId);
        return {
          userId: row.actorId,
          name: actor ? `${actor.firstName} ${actor.lastName}` : 'Unknown user',
          email: actor?.email ?? null,
          count: row._count._all,
        };
      }),
    };
  }
}
