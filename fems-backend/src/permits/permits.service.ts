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
  DocumentType,
  NotificationType,
  PermitStatus,
  PermitType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeOutstanding } from '../payments/payment-rules';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { References, uniqueReference } from '../common/utils/reference.util';
import { canReadAll, companyScope } from '../common/utils/access-scope.util';
import { resolveOrderBy } from '../common/dto/pagination.dto';
import { stringifyJson } from '../common/utils/json.util';
import type { AuthenticatedUser } from '../common/decorators';
import {
  assertTransition,
  availableActions,
  type PermitAction,
  type PermitTransitionSpec,
} from './permit-state';
import type {
  CreatePermitDocumentDto,
  CreatePermitDto,
  PermitDecisionDto,
  PermitDocumentQueryDto,
  PermitQueryDto,
  RenewPermitDto,
  UpdatePermitDto,
  VerifyPermitDocumentDto,
} from './dto/permit.dto';

const PERMIT_SORTABLE = ['createdAt', 'updatedAt', 'startDate', 'endDate', 'permitNumber', 'status'] as const;

const PERMIT_INCLUDE = {
  company: { select: { id: true, name: true, status: true, type: true } },
  applicant: { select: { id: true, firstName: true, lastName: true, email: true } },
  forest: { select: { id: true, code: true, name: true, region: true } },
  zone: { select: { id: true, code: true, name: true } },
  reviewedBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ExploitationPermitInclude;

@Injectable()
export class PermitsService {
  private readonly logger = new Logger(PermitsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ reads

  async list(user: AuthenticatedUser, query: PermitQueryDto) {
    const scope = companyScope(user, 'permits');
    const companyFilter = scope.companyId ? { companyId: scope.companyId } : {};
    const and: Prisma.ExploitationPermitWhereInput[] = [];
    const where: Prisma.ExploitationPermitWhereInput = {
      deletedAt: null,
      status: query.status,
      type: query.type,
      priority: query.priority,
      forestId: query.forestId,
      companyId: query.companyId,
      ...companyFilter,
      ...(!canReadAll(user, 'permits')
        ? { OR: [{ applicantId: user.id }, ...(user.companyId ? [{ companyId: user.companyId }] : [])] }
        : {}),
      ...(query.expiringWithinDays
        ? {
            endDate: { lte: new Date(Date.now() + query.expiringWithinDays * 86_400_000) },
            status: { in: [PermitStatus.ACTIVE, PermitStatus.PAYMENT_PENDING, PermitStatus.APPROVED] },
          }
        : {}),
    };
    if (query.search) {
      and.push({
        OR: [
          { permitNumber: { contains: query.search } },
          { title: { contains: query.search } },
          { purpose: { contains: query.search } },
        ],
      });
    }

    if (query.awaitingMyAction) {
      // "My action queue": what this specific user is allowed to move forward.
      const clauses: Prisma.ExploitationPermitWhereInput[] = [];
      const can = (permission: string) => user.permissions.includes('*') || user.permissions.includes(permission);
      if (can('permits:submit')) {
        clauses.push({ applicantId: user.id, status: { in: [PermitStatus.DRAFT, PermitStatus.REVISION_REQUIRED] } });
      }
      if (can('permits:review')) clauses.push({ status: PermitStatus.SUBMITTED });
      if (can('permits:approve') || can('permits:reject')) clauses.push({ status: PermitStatus.UNDER_REVIEW });
      if (can('permits:suspend') || can('permits:revoke')) {
        clauses.push({ status: { in: [PermitStatus.ACTIVE, PermitStatus.SUSPENDED] } });
      }
      if (can('payments:create') && user.companyId) {
        clauses.push({ companyId: user.companyId, status: { in: [PermitStatus.APPROVED, PermitStatus.PAYMENT_PENDING] } });
      }
      and.push({ OR: clauses.length > 0 ? clauses : [{ id: '__no_action_items__' }] });
    }

    if (and.length > 0) where.AND = and;

    const [items, total] = await Promise.all([
      this.prisma.exploitationPermit.findMany({
        where,
        include: {
          ...PERMIT_INCLUDE,
          _count: { select: { documents: true, activities: true, payments: true, inspections: true, violations: true } },
        },
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, [...PERMIT_SORTABLE], 'createdAt'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.exploitationPermit.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const permit = await this.prisma.exploitationPermit.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...PERMIT_INCLUDE,
        documents: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' },
          include: { changedBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
        },
        payments: {
          where: { status: { in: ['PENDING', 'PROCESSING', 'SUCCESSFUL'] } },
          orderBy: { initiatedAt: 'desc' },
          select: {
            id: true,
            reference: true,
            purpose: true,
            status: true,
            amount: true,
            currency: true,
            method: true,
            initiatedAt: true,
            paidAt: true,
          },
        },
        activities: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            reference: true,
            activityType: true,
            status: true,
            plannedVolumeM3: true,
            harvestedVolumeM3: true,
            plannedStartDate: true,
            actualStartDate: true,
          },
        },
        _count: { select: { documents: true, activities: true, payments: true, inspections: true, violations: true } },
      },
    });

    if (!permit) {
      throw new NotFoundException({ code: 'PERMIT_NOT_FOUND', message: 'Permit not found.' });
    }
    this.assertVisible(user, permit);

    return {
      ...permit,
      availableActions: availableActions(user, permit).map((action) => this.describeAction(action)),
    };
  }

  /** Actions the signed-in user may perform on this permit right now. */
  async listActions(user: AuthenticatedUser, id: string) {
    const permit = await this.prisma.exploitationPermit.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, applicantId: true, companyId: true, endDate: true, feeAmount: true },
    });
    if (!permit) throw new NotFoundException({ code: 'PERMIT_NOT_FOUND', message: 'Permit not found.' });
    this.assertVisible(user, permit);
    const outstanding = await this.outstandingBalance(permit.id);
    return {
      status: permit.status,
      outstandingBalance: outstanding,
      actions: availableActions(user, permit).map((action) => this.describeAction(action)),
    };
  }

  async timeline(user: AuthenticatedUser, id: string) {
    const permit = await this.prisma.exploitationPermit.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, applicantId: true, companyId: true },
    });
    if (!permit) throw new NotFoundException({ code: 'PERMIT_NOT_FOUND', message: 'Permit not found.' });
    this.assertVisible(user, permit);
    return this.prisma.permitStatusHistory.findMany({
      where: { permitId: id },
      orderBy: { createdAt: 'asc' },
      include: { changedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  private describeAction(action: PermitTransitionSpec) {
    return {
      action: action.action,
      label: action.label,
      description: action.description,
      targetStatus: action.to,
      requiresReason: action.requiresReason ?? false,
    };
  }

  private assertVisible(
    user: AuthenticatedUser,
    permit: { applicantId: string; companyId: string },
  ): void {
    if (canReadAll(user, 'permits')) return;
    if (permit.applicantId === user.id) return;
    if (user.companyId && permit.companyId === user.companyId) return;
    throw new ForbiddenException({
      code: 'PERMIT_FORBIDDEN',
      message: 'This permit belongs to another company.',
    });
  }

  // ---------------------------------------------------------------- writes

  async create(user: AuthenticatedUser, dto: CreatePermitDto) {
    // An account that only sees its own file never chooses the applicant: the
    // service takes the company from the session. Naming another company in the
    // payload is refused outright rather than silently rewritten, so a caller
    // cannot believe an application was filed on someone else's behalf.
    if (dto.companyId && !canReadAll(user, 'permits') && dto.companyId !== user.companyId) {
      throw new ForbiddenException({
        code: 'COMPANY_SCOPE_FORBIDDEN',
        message: 'An application can only be filed for the company attached to your account.',
      });
    }

    const companyId = canReadAll(user, 'permits') && dto.companyId ? dto.companyId : user.companyId;
    if (!companyId) {
      throw new BadRequestException({
        code: 'COMPANY_REQUIRED',
        message:
          'A permit must be attached to a company. Company accounts use their own company; officers must provide companyId.',
      });
    }

    const [company, forest, zone] = await Promise.all([
      this.prisma.company.findFirst({ where: { id: companyId, deletedAt: null } }),
      this.prisma.forest.findFirst({ where: { id: dto.forestId, deletedAt: null } }),
      dto.zoneId ? this.prisma.forestZone.findFirst({ where: { id: dto.zoneId, deletedAt: null } }) : null,
    ]);
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });
    if (!forest) throw new NotFoundException({ code: 'FOREST_NOT_FOUND', message: 'Forest not found.' });
    if (dto.zoneId && !zone) throw new NotFoundException({ code: 'ZONE_NOT_FOUND', message: 'Zone not found.' });
    if (zone && zone.forestId !== dto.forestId) {
      throw new BadRequestException({
        code: 'ZONE_FOREST_MISMATCH',
        message: 'The selected zone does not belong to the selected forest.',
      });
    }
    if (company.status !== 'VERIFIED' && !canReadAll(user, 'permits')) {
      throw new BadRequestException({
        code: 'COMPANY_NOT_VERIFIED',
        message: 'Your company must be verified before applying for an exploitation permit.',
      });
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException({
        code: 'INVALID_PERMIT_PERIOD',
        message: 'The permit end date must be after its start date.',
      });
    }

    const royaltyRatePerM3 = dto.royaltyRatePerM3 ?? (await this.defaultRoyaltyRate());
    const feeAmount = dto.feeAmount ?? Number((dto.volumeRequestedM3 * royaltyRatePerM3).toFixed(2));

    const permitNumber = await uniqueReference(
      () => References.permit(dto.type),
      async (candidate) =>
        (await this.prisma.exploitationPermit.count({ where: { permitNumber: candidate } })) === 0,
    );

    const permit = await this.prisma.$transaction(async (tx) => {
      const created = await tx.exploitationPermit.create({
        data: {
          permitNumber,
          type: dto.type,
          status: PermitStatus.DRAFT,
          priority: dto.priority,
          title: dto.title,
          purpose: dto.purpose,
          companyId,
          applicantId: user.id,
          forestId: dto.forestId,
          zoneId: dto.zoneId,
          volumeRequestedM3: dto.volumeRequestedM3,
          areaRequestedHa: dto.areaRequestedHa,
          royaltyRatePerM3,
          feeAmount,
          startDate,
          endDate,
          conditions: dto.conditions,
          isDemo: false,
        },
        include: PERMIT_INCLUDE,
      });

      await tx.permitStatusHistory.create({
        data: {
          permitId: created.id,
          toStatus: PermitStatus.DRAFT,
          changedById: user.id,
          reason: 'Application created',
        },
      });

      return created;
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'ExploitationPermit',
      entityId: permit.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Created permit application ${permit.permitNumber} (${permit.type})`,
      after: {
        permitNumber: permit.permitNumber,
        volumeRequestedM3: Number(permit.volumeRequestedM3),
        feeAmount: Number(permit.feeAmount),
      },
    });

    return permit;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdatePermitDto) {
    const permit = await this.prisma.exploitationPermit.findFirst({ where: { id, deletedAt: null } });
    if (!permit) throw new NotFoundException({ code: 'PERMIT_NOT_FOUND', message: 'Permit not found.' });
    this.assertVisible(user, permit);

    const editable: PermitStatus[] = [PermitStatus.DRAFT, PermitStatus.REVISION_REQUIRED];
    if (!editable.includes(permit.status)) {
      throw new BadRequestException({
        code: 'PERMIT_NOT_EDITABLE',
        message: `A permit in status ${permit.status} can no longer be edited. Use the lifecycle actions instead.`,
      });
    }
    if (permit.applicantId !== user.id && !canReadAll(user, 'permits')) {
      throw new ForbiddenException({
        code: 'PERMIT_FORBIDDEN',
        message: 'Only the applicant or a reviewing officer may edit this application.',
      });
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : permit.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : permit.endDate;
    if (endDate <= startDate) {
      throw new BadRequestException({
        code: 'INVALID_PERMIT_PERIOD',
        message: 'The permit end date must be after its start date.',
      });
    }

    const volume = dto.volumeRequestedM3 ?? Number(permit.volumeRequestedM3);
    const royalty = dto.royaltyRatePerM3 ?? (permit.royaltyRatePerM3 ? Number(permit.royaltyRatePerM3) : undefined);

    const updated = await this.prisma.exploitationPermit.update({
      where: { id },
      data: {
        type: dto.type,
        priority: dto.priority,
        title: dto.title,
        purpose: dto.purpose,
        forestId: dto.forestId,
        zoneId: dto.zoneId,
        volumeRequestedM3: dto.volumeRequestedM3,
        areaRequestedHa: dto.areaRequestedHa,
        royaltyRatePerM3: dto.royaltyRatePerM3,
        feeAmount: dto.feeAmount ?? (royalty !== undefined ? Number((volume * royalty).toFixed(2)) : undefined),
        startDate: dto.startDate ? startDate : undefined,
        endDate: dto.endDate ? endDate : undefined,
        conditions: dto.conditions,
      },
      include: PERMIT_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'ExploitationPermit',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Updated permit application ${permit.permitNumber}`,
      before: {
        title: permit.title,
        volumeRequestedM3: Number(permit.volumeRequestedM3),
        feeAmount: Number(permit.feeAmount),
      },
      after: {
        title: updated.title,
        volumeRequestedM3: Number(updated.volumeRequestedM3),
        feeAmount: Number(updated.feeAmount),
      },
    });

    return updated;
  }

  /**
   * The single entry point for every lifecycle change. The state machine is
   * consulted first (invalid transitions are rejected before any write), then
   * the caller's permission for that specific action, then the business rules
   * of the transition itself.
   */
  async transition(user: AuthenticatedUser, id: string, action: PermitAction, dto: PermitDecisionDto) {
    const permit = await this.prisma.exploitationPermit.findFirst({
      where: { id, deletedAt: null },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!permit) throw new NotFoundException({ code: 'PERMIT_NOT_FOUND', message: 'Permit not found.' });
    this.assertVisible(user, permit);

    const spec = assertTransition(permit.status, action);

    const permitted =
      user.permissions.includes('*') || spec.permissions.some((permission) => user.permissions.includes(permission));
    if (!permitted) {
      throw new ForbiddenException({
        code: 'PERMIT_ACTION_FORBIDDEN',
        message: `Missing permission(s): ${spec.permissions.join(' or ')} to perform "${spec.label}".`,
        details: { action, required: spec.permissions },
      });
    }
    if (spec.applicantOnly && permit.applicantId !== user.id) {
      throw new ForbiddenException({
        code: 'PERMIT_ACTION_FORBIDDEN',
        message: 'Only the permit applicant may perform this action.',
      });
    }
    if (spec.requiresReason && !dto.reason?.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: `A written justification is required to perform "${spec.label}".`,
      });
    }

    // Business rules specific to each transition.
    if (action === 'APPROVE') {
      const approvedVolume = dto.volumeApprovedM3 ?? Number(permit.volumeRequestedM3);
      if (approvedVolume > Number(permit.volumeRequestedM3)) {
        throw new BadRequestException({
          code: 'APPROVED_VOLUME_EXCEEDS_REQUEST',
          message: 'The approved volume cannot exceed the requested volume.',
        });
      }
    }
    if (action === 'ACTIVATE') {
      const outstanding = await this.outstandingBalance(permit.id);
      if (outstanding > 0) {
        throw new BadRequestException({
          code: 'PERMIT_FEES_UNPAID',
          message: `The permit cannot be activated: ${outstanding.toLocaleString('fr-FR')} XAF of fees are still outstanding.`,
          details: { outstandingBalance: outstanding },
        });
      }
    }
    if (action === 'RENEW') {
      return this.renewPermit(user, permit, dto);
    }

    const now = new Date();
    const data: Prisma.ExploitationPermitUpdateInput = { status: spec.to };
    if (action === 'SUBMIT' || action === 'RESUBMIT') {
      data.submittedAt = now;
      if (action === 'RESUBMIT') data.revisionCount = { increment: 1 };
    }
    if (action === 'START_REVIEW') data.reviewStartedAt = now;
    if (action === 'REQUEST_REVISION' || action === 'REJECT') {
      data.reviewedAt = now;
      data.reviewedBy = { connect: { id: user.id } };
      if (action === 'REJECT') data.rejectionReason = dto.reason ?? null;
      if (action === 'REQUEST_REVISION') data.revisionNotes = dto.reason ?? null;
    }
    if (action === 'APPROVE') {
      data.reviewedAt = now;
      data.reviewedBy = { connect: { id: user.id } };
      data.approvedAt = now;
      data.approvedBy = { connect: { id: user.id } };
      data.volumeApprovedM3 = dto.volumeApprovedM3 ?? permit.volumeRequestedM3;
      data.expiresAt = dto.endDate ? new Date(dto.endDate) : permit.endDate;
      if (dto.conditions) data.conditions = dto.conditions;
      if (dto.endDate) data.endDate = new Date(dto.endDate);
    }
    if (action === 'ACTIVATE') {
      data.activatedAt = now;
      data.expiresAt = permit.endDate;
    }
    if (action === 'SUSPEND') {
      data.suspendedAt = now;
      data.suspensionReason = dto.reason ?? null;
    }
    if (action === 'REINSTATE') {
      data.suspendedAt = null;
      data.suspensionReason = null;
    }
    if (action === 'EXPIRE') data.expiresAt = permit.expiresAt ?? permit.endDate;
    if (action === 'REVOKE') {
      data.revokedAt = now;
      data.revocationReason = dto.reason ?? null;
    }
    if (action === 'CANCEL') data.reviewedAt = dto.reason ? now : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.exploitationPermit.update({ where: { id }, data, include: PERMIT_INCLUDE });
      await tx.permitStatusHistory.create({
        data: {
          permitId: id,
          fromStatus: permit.status,
          toStatus: spec.to,
          changedById: user.id,
          reason: dto.reason ?? spec.label,
          metadataJson: stringifyJson({
            action,
            volumeApprovedM3: dto.volumeApprovedM3 ?? null,
            endDate: dto.endDate ?? null,
          }),
        },
      });
      return result;
    });

    await this.audit.record({
      action: AuditAction.PERMIT_STATUS_CHANGE,
      severity:
        spec.to === PermitStatus.REVOKED
          ? AuditSeverity.CRITICAL
          : spec.to === PermitStatus.REJECTED || spec.to === PermitStatus.SUSPENDED
            ? AuditSeverity.WARNING
            : AuditSeverity.INFO,
      entityType: 'ExploitationPermit',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `${spec.label}: ${permit.permitNumber} ${permit.status} → ${spec.to}`,
      before: { status: permit.status },
      after: { status: spec.to, reason: dto.reason ?? null, action },
    });

    await this.notifyTransition(permit, spec, dto, user.id);
    return updated;
  }

  private async renewPermit(
    user: AuthenticatedUser,
    permit: {
      id: string;
      permitNumber: string;
      companyId: string;
      applicantId: string;
      forestId: string;
      zoneId: string | null;
      type: PermitType;
      volumeRequestedM3: Prisma.Decimal;
      royaltyRatePerM3: Prisma.Decimal | null;
      endDate: Date;
    },
    dto: RenewPermitDto,
  ) {
    const oldEnd = permit.endDate;
    const startDate = dto.startDate ? new Date(dto.startDate) : new Date(oldEnd.getTime() + 86_400_000);
    const endDate = dto.endDate ? new Date(dto.endDate) : new Date(startDate.getTime() + 365 * 86_400_000);
    if (endDate <= startDate) {
      throw new BadRequestException({
        code: 'INVALID_PERMIT_PERIOD',
        message: 'The renewal end date must be after its start date.',
      });
    }
    const volume = dto.volumeRequestedM3 ?? Number(permit.volumeRequestedM3);
    const royalty = permit.royaltyRatePerM3 ? Number(permit.royaltyRatePerM3) : await this.defaultRoyaltyRate();

    const permitNumber = await uniqueReference(
      () => References.permit(permit.type),
      async (candidate) =>
        (await this.prisma.exploitationPermit.count({ where: { permitNumber: candidate } })) === 0,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const renewal = await tx.exploitationPermit.create({
        data: {
          permitNumber,
          type: permit.type,
          status: PermitStatus.DRAFT,
          title: `Renewal of ${permit.permitNumber}`,
          purpose: dto.notes ?? `Renewal of permit ${permit.permitNumber}`,
          companyId: permit.companyId,
          applicantId: permit.applicantId,
          forestId: permit.forestId,
          zoneId: permit.zoneId,
          volumeRequestedM3: volume,
          royaltyRatePerM3: royalty,
          feeAmount: Number((volume * royalty).toFixed(2)),
          startDate,
          endDate,
          previousPermitId: permit.id,
          renewalCount: 1,
          conditions: stringifyJson({ renewalOf: permit.permitNumber, requestedBy: user.id }),
        },
        include: PERMIT_INCLUDE,
      });
      await tx.permitStatusHistory.create({
        data: {
          permitId: renewal.id,
          toStatus: PermitStatus.DRAFT,
          changedById: user.id,
          reason: `Renewal application created from ${permit.permitNumber}`,
        },
      });
      return renewal;
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'ExploitationPermit',
      entityId: created.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Created renewal ${created.permitNumber} from ${permit.permitNumber}`,
    });
    await this.notifications.notify({
      userIds: [permit.applicantId],
      type: NotificationType.PERMIT_SUBMITTED,
      title: 'Renewal application created',
      message: `Renewal ${created.permitNumber} was created from permit ${permit.permitNumber}. Complete and submit it for review.`,
      entityType: 'ExploitationPermit',
      entityId: created.id,
      actionUrl: `/permits/${created.id}`,
    });

    return created;
  }

  private async notifyTransition(
    permit: { id: string; permitNumber: string; applicantId: string; companyId: string },
    spec: PermitTransitionSpec,
    dto: PermitDecisionDto,
    actorId: string,
  ) {
    const companyUserIds = await this.companyUserIds(permit.companyId, actorId);
    const officerRoles = ['GOVERNMENT_FOREST_OFFICER', 'ADMINISTRATOR'];
    const message = `Permit ${permit.permitNumber} is now ${spec.to}.${dto.reason ? ` Reason: ${dto.reason}` : ''}`;

    switch (spec.to) {
      case PermitStatus.SUBMITTED: {
        await this.notifications.notifyRoles(officerRoles, {
          type: NotificationType.PERMIT_SUBMITTED,
          title: 'Permit application submitted',
          message,
          entityType: 'ExploitationPermit',
          entityId: permit.id,
          actionUrl: `/officer/permits/${permit.id}`,
        });
        await this.notifications.notify({
          userIds: [permit.applicantId, ...companyUserIds],
          type: NotificationType.PERMIT_SUBMITTED,
          title: 'Application submitted',
          message: `Your application ${permit.permitNumber} was submitted for review.`,
          entityType: 'ExploitationPermit',
          entityId: permit.id,
          actionUrl: `/permits/${permit.id}`,
        });
        break;
      }
      case PermitStatus.APPROVED:
      case PermitStatus.REJECTED:
      case PermitStatus.REVISION_REQUIRED: {
        const type =
          spec.to === PermitStatus.APPROVED
            ? NotificationType.PERMIT_APPROVED
            : spec.to === PermitStatus.REJECTED
              ? NotificationType.PERMIT_REJECTED
              : NotificationType.PERMIT_REVISION_REQUIRED;
        await this.notifications.notify({
          userIds: [permit.applicantId, ...companyUserIds],
          type,
          severity: spec.to === PermitStatus.REJECTED ? AuditSeverity.WARNING : AuditSeverity.INFO,
          title: `Permit ${spec.to.toLowerCase().replace('_', ' ')}`,
          message,
          entityType: 'ExploitationPermit',
          entityId: permit.id,
          actionUrl: `/permits/${permit.id}`,
        });
        if (spec.to === PermitStatus.APPROVED) {
          await this.notifications.notify({
            userIds: [permit.applicantId, ...companyUserIds],
            type: NotificationType.PAYMENT_INITIATED,
            title: 'Fees due',
            message: `Permit ${permit.permitNumber} is approved. Settle the fees to activate the exploitation.`,
            entityType: 'ExploitationPermit',
            entityId: permit.id,
            actionUrl: `/payments/new?permitId=${permit.id}`,
          });
        }
        break;
      }
      case PermitStatus.ACTIVE: {
        await this.notifications.notify({
          userIds: [permit.applicantId, ...companyUserIds],
          type: NotificationType.PERMIT_ACTIVATED,
          title: 'Permit active',
          message: `Permit ${permit.permitNumber} is now active. Field activities can start.`,
          entityType: 'ExploitationPermit',
          entityId: permit.id,
          actionUrl: `/permits/${permit.id}`,
        });
        await this.notifications.notifyRoles(['FOREST_INSPECTOR'], {
          type: NotificationType.PERMIT_ACTIVATED,
          title: 'Permit activated',
          message: `Permit ${permit.permitNumber} is active — schedule compliance inspections.`,
          entityType: 'ExploitationPermit',
          entityId: permit.id,
        });
        break;
      }
      case PermitStatus.SUSPENDED:
      case PermitStatus.REVOKED: {
        await this.notifications.notify({
          userIds: [permit.applicantId, ...companyUserIds],
          type: spec.to === PermitStatus.SUSPENDED ? NotificationType.PERMIT_SUSPENDED : NotificationType.PERMIT_REVOKED,
          severity: AuditSeverity.CRITICAL,
          title: spec.to === PermitStatus.SUSPENDED ? 'Permit suspended' : 'Permit revoked',
          message,
          entityType: 'ExploitationPermit',
          entityId: permit.id,
          actionUrl: `/permits/${permit.id}`,
        });
        await this.notifications.notifyRoles(['FOREST_INSPECTOR', 'ENVIRONMENTAL_OFFICER'], {
          type: spec.to === PermitStatus.SUSPENDED ? NotificationType.PERMIT_SUSPENDED : NotificationType.PERMIT_REVOKED,
          severity: AuditSeverity.CRITICAL,
          title: `Permit ${spec.to.toLowerCase()}`,
          message,
          entityType: 'ExploitationPermit',
          entityId: permit.id,
        });
        break;
      }
      case PermitStatus.EXPIRED: {
        await this.notifications.notify({
          userIds: [permit.applicantId, ...companyUserIds],
          type: NotificationType.PERMIT_EXPIRED,
          title: 'Permit expired',
          message: `Permit ${permit.permitNumber} expired on ${new Date().toLocaleDateString('fr-FR')}.`,
          entityType: 'ExploitationPermit',
          entityId: permit.id,
        });
        break;
      }
      default:
        break;
    }
  }

  private async companyUserIds(companyId: string, excludeUserId?: string): Promise<string[]> {
    const members = await this.prisma.user.findMany({
      where: { companyId, deletedAt: null, status: 'ACTIVE', id: excludeUserId ? { not: excludeUserId } : undefined },
      select: { id: true },
      take: 25,
    });
    return members.map((member) => member.id);
  }

  /** Outstanding permit fees (approved payments are subtracted). */
  async outstandingBalance(permitId: string): Promise<number> {
    const permit = await this.prisma.exploitationPermit.findUnique({
      where: { id: permitId },
      select: { feeAmount: true },
    });
    if (!permit) return 0;
    const paid = await this.prisma.payment.aggregate({
      where: { permitId, status: 'SUCCESSFUL' },
      _sum: { amount: true },
    });
    return computeOutstanding(Number(permit.feeAmount), Number(paid._sum.amount ?? 0));
  }

  private async defaultRoyaltyRate(): Promise<number> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: { key: 'permit.default_royalty_rate_per_m3' },
      select: { value: true },
    });
    const parsed = setting ? Number(setting.value) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2500;
  }

  // -------------------------------------------------------------- documents

  async listDocuments(user: AuthenticatedUser, permitId: string, query: PermitDocumentQueryDto) {
    const permit = await this.prisma.exploitationPermit.findFirst({
      where: { id: permitId, deletedAt: null },
      select: { id: true, applicantId: true, companyId: true },
    });
    if (!permit) throw new NotFoundException({ code: 'PERMIT_NOT_FOUND', message: 'Permit not found.' });
    this.assertVisible(user, permit);

    const where: Prisma.PermitDocumentWhereInput = {
      permitId,
      deletedAt: null,
      type: query.type,
      isVerified: query.verifiedOnly ? true : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.permitDocument.findMany({
        where,
        include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.permitDocument.count({ where }),
    ]);
    return { items, total };
  }

  async addDocument(user: AuthenticatedUser, permitId: string, dto: CreatePermitDocumentDto) {
    const permit = await this.prisma.exploitationPermit.findFirst({
      where: { id: permitId, deletedAt: null },
      select: { id: true, permitNumber: true, applicantId: true, companyId: true, status: true },
    });
    if (!permit) throw new NotFoundException({ code: 'PERMIT_NOT_FOUND', message: 'Permit not found.' });
    this.assertVisible(user, permit);

    const document = await this.prisma.permitDocument.create({
      data: {
        permitId,
        type: dto.type,
        title: dto.title,
        fileKey: dto.fileKey,
        fileUrl: `/api/v1/files/download?key=${encodeURIComponent(dto.fileKey)}`,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        checksum: dto.checksum,
        notes: dto.notes,
        uploadedById: user.id,
      },
    });

    await this.audit.record({
      action: AuditAction.FILE_UPLOAD,
      entityType: 'PermitDocument',
      entityId: document.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Attached ${dto.type} to permit ${permit.permitNumber}`,
      after: { fileKey: dto.fileKey, sizeBytes: dto.sizeBytes },
    });

    return document;
  }

  async verifyDocument(user: AuthenticatedUser, permitId: string, documentId: string, dto: VerifyPermitDocumentDto) {
    const document = await this.prisma.permitDocument.findFirst({
      where: { id: documentId, permitId, deletedAt: null },
      include: { permit: { select: { permitNumber: true } } },
    });
    if (!document) {
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Permit document not found.' });
    }

    const updated = await this.prisma.permitDocument.update({
      where: { id: documentId },
      data: {
        isVerified: dto.isVerified,
        verifiedById: dto.isVerified ? user.id : null,
        notes: dto.notes ?? document.notes,
      },
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      severity: AuditSeverity.INFO,
      entityType: 'PermitDocument',
      entityId: documentId,
      actorId: user.id,
      actorEmail: user.email,
      description: `${dto.isVerified ? 'Verified' : 'Un-verified'} ${document.type} of permit ${document.permit.permitNumber}`,
    });

    return updated;
  }

  async removeDocument(user: AuthenticatedUser, permitId: string, documentId: string) {
    const document = await this.prisma.permitDocument.findFirst({
      where: { id: documentId, permitId, deletedAt: null },
      include: { permit: { select: { permitNumber: true } } },
    });
    if (!document) {
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Permit document not found.' });
    }
    await this.prisma.permitDocument.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'PermitDocument',
      entityId: documentId,
      actorId: user.id,
      actorEmail: user.email,
      description: `Removed ${document.type} from permit ${document.permit.permitNumber}`,
    });
    return { id: documentId, deleted: true };
  }

  /** Mandatory document types per permit type — used by the app to guide uploads. */
  requiredDocuments(type: PermitType): DocumentType[] {
    switch (type) {
      case PermitType.EXPLOITATION:
        return [DocumentType.MANAGEMENT_PLAN, DocumentType.ENVIRONMENTAL_IMPACT_ASSESSMENT, DocumentType.TAX_CLEARANCE];
      case PermitType.TRANSPORT:
        return [DocumentType.TRANSPORT_PERMIT, DocumentType.IDENTITY_DOCUMENT];
      case PermitType.EXPORT:
        return [DocumentType.EXPLOITATION_LICENCE, DocumentType.TAX_CLEARANCE];
      case PermitType.PROCESSING:
        return [DocumentType.EXPLOITATION_LICENCE, DocumentType.MANAGEMENT_PLAN];
      default:
        return [DocumentType.IDENTITY_DOCUMENT];
    }
  }

  // ------------------------------------------------------------- statistics

  async statistics(user: AuthenticatedUser) {
    const scope = canReadAll(user, 'permits') ? {} : { companyId: user.companyId ?? '__none__' };
    const [byStatus, byType, totals, expiringSoonList] = await Promise.all([
      this.prisma.exploitationPermit.groupBy({
        by: ['status'],
        where: { deletedAt: null, ...scope },
        _count: { _all: true },
      }),
      this.prisma.exploitationPermit.groupBy({
        by: ['type'],
        where: { deletedAt: null, ...scope },
        _count: { _all: true },
      }),
      this.prisma.exploitationPermit.aggregate({
        where: { deletedAt: null, ...scope },
        _sum: { volumeRequestedM3: true, volumeApprovedM3: true, feeAmount: true },
        _count: { _all: true },
      }),
      this.prisma.exploitationPermit.findMany({
        where: {
          deletedAt: null,
          ...scope,
          status: PermitStatus.ACTIVE,
          endDate: { gte: new Date(), lte: new Date(Date.now() + 60 * 86_400_000) },
        },
        orderBy: { endDate: 'asc' },
        take: 10,
        select: {
          id: true,
          permitNumber: true,
          title: true,
          endDate: true,
          company: { select: { id: true, name: true } },
          forest: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      total: totals._count._all,
      totalVolumeRequestedM3: Number(totals._sum.volumeRequestedM3 ?? 0),
      totalVolumeApprovedM3: Number(totals._sum.volumeApprovedM3 ?? 0),
      totalFeeAmount: Number(totals._sum.feeAmount ?? 0),
      byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
      byType: byType.map((row) => ({ type: row.type, count: row._count._all })),
      expiringSoon: expiringSoonList,
    };
  }

  async findExpiring(withinDays: number) {
    return this.prisma.exploitationPermit.findMany({
      where: {
        deletedAt: null,
        status: PermitStatus.ACTIVE,
        endDate: { gte: new Date(), lte: new Date(Date.now() + withinDays * 86_400_000) },
      },
      orderBy: { endDate: 'asc' },
      select: {
        id: true,
        permitNumber: true,
        title: true,
        endDate: true,
        applicantId: true,
        companyId: true,
      },
    });
  }

  /**
   * Daily regulatory housekeeping: permits that reached their end date are
   * expired and everyone concerned is notified. Runs in the background, never
   * silently changes a permit that still has an open suspension review.
   */
  @Cron('0 4 * * *', { name: 'permit-lifecycle' })
  async runLifecycleSweep(): Promise<{ expired: number; warned: number }> {
    const now = new Date();
    const overdue = await this.prisma.exploitationPermit.findMany({
      where: { deletedAt: null, status: { in: [PermitStatus.ACTIVE, PermitStatus.SUSPENDED] }, endDate: { lt: now } },
      select: { id: true, permitNumber: true, status: true, applicantId: true, companyId: true },
    });

    let expired = 0;
    for (const permit of overdue) {
      await this.prisma.$transaction([
        this.prisma.exploitationPermit.update({
          where: { id: permit.id },
          data: { status: PermitStatus.EXPIRED, expiresAt: now },
        }),
        this.prisma.permitStatusHistory.create({
          data: {
            permitId: permit.id,
            fromStatus: permit.status,
            toStatus: PermitStatus.EXPIRED,
            reason: 'End date reached (automatic expiry)',
          },
        }),
      ]);
      await this.audit.record({
        action: AuditAction.PERMIT_STATUS_CHANGE,
        entityType: 'ExploitationPermit',
        entityId: permit.id,
        description: `Automatic expiry: ${permit.permitNumber} reached its end date`,
        before: { status: permit.status },
        after: { status: PermitStatus.EXPIRED },
      });
      await this.notifications.notify({
        userIds: [permit.applicantId, ...(await this.companyUserIds(permit.companyId))],
        type: NotificationType.PERMIT_EXPIRED,
        severity: AuditSeverity.WARNING,
        title: 'Permit expired',
        message: `Permit ${permit.permitNumber} expired and can no longer be used. A renewal application can be filed.`,
        entityType: 'ExploitationPermit',
        entityId: permit.id,
      });
      expired += 1;
    }

    const warned = await this.warnExpiring();
    if (expired || warned) {
      this.logger.log(`Permit lifecycle sweep: ${expired} expired, ${warned} expiry warning(s) sent.`);
    }
    return { expired, warned };
  }

  /** Notifies permit holders 30, 15 and 7 days before expiry (once per window). */
  async warnExpiring(): Promise<number> {
    const windows = [30, 15, 7];
    let sent = 0;
    for (const days of windows) {
      const start = new Date(Date.now() + (days - 1) * 86_400_000);
      const end = new Date(Date.now() + days * 86_400_000);
      const permits = await this.prisma.exploitationPermit.findMany({
        where: { deletedAt: null, status: PermitStatus.ACTIVE, endDate: { gte: start, lt: end } },
        select: { id: true, permitNumber: true, endDate: true, applicantId: true, companyId: true },
      });
      for (const permit of permits) {
        await this.notifications.notify({
          userIds: [permit.applicantId, ...(await this.companyUserIds(permit.companyId))],
          type: NotificationType.PERMIT_EXPIRING,
          severity: AuditSeverity.WARNING,
          title: `Permit expires in ${days} days`,
          message: `Permit ${permit.permitNumber} expires on ${permit.endDate.toLocaleDateString('fr-FR')}. Start the renewal process.`,
          entityType: 'ExploitationPermit',
          entityId: permit.id,
          actionUrl: `/permits/${permit.id}`,
        });
        sent += 1;
      }
    }
    return sent;
  }

  /** Guard used by the exploitation module: no activity on an inactive permit. */
  async assertPermitOperational(permitId: string) {
    const permit = await this.prisma.exploitationPermit.findFirst({
      where: { id: permitId, deletedAt: null },
      select: { id: true, status: true, permitNumber: true, companyId: true, forestId: true, endDate: true, volumeApprovedM3: true },
    });
    if (!permit) throw new NotFoundException({ code: 'PERMIT_NOT_FOUND', message: 'Permit not found.' });
    if (permit.status !== PermitStatus.ACTIVE) {
      throw new ConflictException({
        code: 'PERMIT_NOT_ACTIVE',
        message: `Permit ${permit.permitNumber} is ${permit.status}. Field activity is only allowed on an ACTIVE permit.`,
        details: { permitStatus: permit.status },
      });
    }
    if (permit.endDate < new Date()) {
      throw new ConflictException({
        code: 'PERMIT_EXPIRED',
        message: `Permit ${permit.permitNumber} expired on ${permit.endDate.toLocaleDateString('fr-FR')}.`,
      });
    }
    return permit;
  }
}
