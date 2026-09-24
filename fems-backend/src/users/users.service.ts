import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, AuditSeverity, Prisma, UserStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { appConfig } from '../config/configuration';
import { hashPassword } from '../common/utils/password.util';
import { resolveOrderBy } from '../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/decorators';
import { ROLE_BY_NAME } from '../common/constants/permissions';
import type {
  AdminResetPasswordDto,
  AssignRoleDto,
  CreateUserDto,
  UpdateUserDto,
  UpdateUserStatusDto,
  UsersQueryDto,
} from './dto/users.dto';

const SORTABLE = ['createdAt', 'updatedAt', 'lastName', 'email', 'status'] as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** Passwords generated for administrator-created accounts (shown once). */
  private generateTemporaryPassword(): string {
    const raw = randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, '');
    return `Fems${raw.slice(0, 6)}1`; // guaranteed upper, lower and digit for the policy
  }

  private readonly publicSelect = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    phone: true,
    jobTitle: true,
    avatarUrl: true,
    status: true,
    isDemo: true,
    preferredLanguage: true,
    emailVerifiedAt: true,
    lastLoginAt: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
    companyId: true,
    company: { select: { id: true, name: true, status: true } },
    userRoles: {
      select: {
        assignedAt: true,
        expiresAt: true,
        role: { select: { name: true, label: true, level: true } },
      },
    },
  } satisfies Prisma.UserSelect;

  // The shape is assembled from the Prisma select above; `any` keeps the
  // transformation readable while the DTO layer documents the contract.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toPublicUser(user: any): any {
    return {
      ...user,
      roles: (user.userRoles ?? []).map((userRole: any) => ({
        name: userRole.role.name,
        label: userRole.role.label,
        level: userRole.role.level,
        assignedAt: userRole.assignedAt,
        expiresAt: userRole.expiresAt,
      })),
      userRoles: undefined,
    };
  }

  async list(query: UsersQueryDto) {
    const where: Prisma.UserWhereInput = {
      deletedAt: query.includeDeleted ? undefined : null,
      status: query.status,
      companyId: query.companyId,
      AND: [
        query.role ? { userRoles: { some: { role: { name: query.role } } } } : {},
        query.search
          ? {
              OR: [
                { firstName: { contains: query.search } },
                { lastName: { contains: query.search } },
                { email: { contains: query.search } },
                { phone: { contains: query.search } },
              ],
            }
          : {},
      ],
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: this.publicSelect,
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, [...SORTABLE], 'createdAt'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((user) => this.toPublicUser(user)),
      total,
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: this.publicSelect });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    return this.toPublicUser(user);
  }

  /** Detailed profile used by the administrator user drawer. */
  async detail(id: string) {
    const user = await this.findOne(id);
    const [sessions, notifications, auditTrail] = await Promise.all([
      this.prisma.refreshToken.findMany({
        where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.notification.count({ where: { userId: id, readAt: null } }),
      this.prisma.auditLog.findMany({
        where: { actorId: id },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: { id: true, action: true, description: true, createdAt: true, entityType: true },
      }),
    ]);
    const families = new Map<string, (typeof sessions)[number]>();
    for (const session of sessions) if (!families.has(session.family)) families.set(session.family, session);
    return {
      ...user,
      security: {
        activeSessions: [...families.values()].map((session) => ({
          id: session.family,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        })),
        unreadNotifications: notifications,
      },
      recentActivity: auditTrail,
    };
  }

  async create(dto: CreateUserDto, actor: AuthenticatedUser) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findFirst({ where: { email } });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'An account already exists for this email address.',
      });
    }

    const roleDefinition = ROLE_BY_NAME.get(dto.role as never);
    if (!roleDefinition) {
      throw new BadRequestException({
        code: 'UNKNOWN_ROLE',
        message: `Unknown role "${dto.role}". Valid roles: ${[...ROLE_BY_NAME.keys()].join(', ')}.`,
      });
    }
    if (roleDefinition.level >= 100 && !actor.permissions.includes('*')) {
      throw new ForbiddenException({
        code: 'ROLE_ESCALATION_FORBIDDEN',
        message: 'Only an administrator can create another administrator account.',
      });
    }

    const role = await this.prisma.role.findUnique({ where: { name: dto.role } });
    if (!role) {
      throw new BadRequestException({
        code: 'ROLE_NOT_PROVISIONED',
        message: 'Role is not provisioned. Run the FEMS database seed.',
      });
    }

    if (dto.companyId) {
      const company = await this.prisma.company.findUnique({ where: { id: dto.companyId } });
      if (!company) {
        throw new BadRequestException({ code: 'COMPANY_NOT_FOUND', message: 'The selected company does not exist.' });
      }
    }

    const temporaryPassword = dto.password ? undefined : this.generateTemporaryPassword();
    const passwordHash = await hashPassword(dto.password ?? temporaryPassword!);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone,
        jobTitle: dto.jobTitle,
        companyId: dto.companyId,
        status: UserStatus.ACTIVE,
        isDemo: dto.isDemo ?? false,
        // Administrator-created accounts are trusted; the holder can reset the
        // password in-app, and a temporary password is never emailed in clear
        // through a channel we cannot verify.
        emailVerifiedAt: new Date(),
        createdById: actor.id,
        userRoles: { create: [{ roleId: role.id, assignedById: actor.id }] },
      },
      select: this.publicSelect,
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'User',
      entityId: user.id,
      actorId: actor.id,
      actorEmail: actor.email,
      description: `Created ${dto.role} account for ${email}`,
      after: { email, role: dto.role, companyId: dto.companyId ?? null },
    });

    return {
      user: this.toPublicUser(user),
      temporaryPassword,
      message: temporaryPassword
        ? 'Account created. Share the temporary password through a secure channel — it is shown only once.'
        : 'Account created with the supplied password.',
    };
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthenticatedUser) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: this.publicSelect });
    const data: Prisma.UserUpdateInput = {
      firstName: dto.firstName?.trim(),
      lastName: dto.lastName?.trim(),
      phone: dto.phone,
      jobTitle: dto.jobTitle,
      status: dto.status,
    };
    if (dto.companyId) data.company = { connect: { id: dto.companyId } };

    const updated = await this.prisma.user.update({ where: { id }, data, select: this.publicSelect });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      description: `Updated account ${before.email}`,
      before: { firstName: before.firstName, lastName: before.lastName, phone: before.phone, status: before.status },
      after: { firstName: dto.firstName, lastName: dto.lastName, phone: dto.phone, status: dto.status },
    });

    return this.toPublicUser(updated);
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto, actor: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    if (user.id === actor.id && dto.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'SELF_STATUS_CHANGE_FORBIDDEN',
        message: 'You cannot suspend or deactivate your own account.',
      });
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        status: dto.status,
        lockedUntil: dto.status === UserStatus.ACTIVE ? null : user.lockedUntil,
        failedLoginCount: dto.status === UserStatus.ACTIVE ? 0 : user.failedLoginCount,
      },
    });

    let revokedSessions = 0;
    if (dto.status === UserStatus.SUSPENDED || dto.status === UserStatus.DEACTIVATED) {
      const result = await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      revokedSessions = result.count;
    }

    await this.audit.record({
      action: AuditAction.ACCOUNT_STATUS_CHANGE,
      severity: dto.status === UserStatus.ACTIVE ? AuditSeverity.INFO : AuditSeverity.WARNING,
      entityType: 'User',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      description: `Account status ${user.status} → ${dto.status}${dto.reason ? ` (${dto.reason})` : ''}; ${revokedSessions} session(s) revoked`,
      before: { status: user.status },
      after: { status: dto.status, reason: dto.reason ?? null },
    });

    return { ...(await this.findOne(id)), revokedSessions };
  }

  async assignRole(id: string, dto: AssignRoleDto, actor: AuthenticatedUser) {
    const role = await this.prisma.role.findUnique({ where: { name: dto.role } });
    if (!role) {
      throw new BadRequestException({
        code: 'ROLE_NOT_PROVISIONED',
        message: `Role ${dto.role} is not provisioned.`,
      });
    }
    const definition = ROLE_BY_NAME.get(dto.role as never);
    if (definition && definition.level >= 100 && !actor.permissions.includes('*')) {
      throw new ForbiddenException({
        code: 'ROLE_ESCALATION_FORBIDDEN',
        message: 'Only an administrator can grant the administrator role.',
      });
    }

    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId: id, roleId: role.id } },
      update: {
        assignedById: actor.id,
        assignedAt: new Date(),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      create: {
        userId: id,
        roleId: role.id,
        assignedById: actor.id,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    await this.audit.record({
      action: AuditAction.ROLE_ASSIGNED,
      severity: AuditSeverity.WARNING,
      entityType: 'User',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      description: `Granted role ${dto.role}${dto.expiresAt ? ` until ${dto.expiresAt}` : ''}`,
    });

    return this.findOne(id);
  }

  async revokeRole(id: string, roleName: string, actor: AuthenticatedUser) {
    const role = await this.prisma.role.findUnique({ where: { name: roleName } });
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found.' });

    const remaining = await this.prisma.userRole.count({ where: { userId: id } });
    if (remaining <= 1) {
      throw new BadRequestException({
        code: 'LAST_ROLE',
        message: 'A user must keep at least one role. Assign another role before removing this one.',
      });
    }

    await this.prisma.userRole.deleteMany({ where: { userId: id, roleId: role.id } });
    await this.audit.record({
      action: AuditAction.ROLE_ASSIGNED,
      severity: AuditSeverity.WARNING,
      entityType: 'User',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      description: `Revoked role ${roleName}`,
    });
    return this.findOne(id);
  }

  async resetPassword(id: string, dto: AdminResetPasswordDto, actor: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });

    const newPassword = dto.newPassword ?? this.generateTemporaryPassword();
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null, status: UserStatus.ACTIVE },
    });

    let revokedSessions = 0;
    if (dto.revokeSessions !== false) {
      const result = await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      revokedSessions = result.count;
    }

    await this.audit.record({
      action: AuditAction.PASSWORD_RESET,
      severity: AuditSeverity.WARNING,
      entityType: 'User',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      description: `Administrator reset the password (${revokedSessions} session(s) revoked)`,
    });

    const emailResult = await this.mail.send({
      to: user.email,
      subject: 'FEMS — your password was reset by an administrator',
      text:
        `Hello ${user.firstName},\n\n` +
        `An administrator reset the password of your FEMS account.\n` +
        `You will be asked to choose a new password at the next sign-in.\n\n` +
        `If this was not expected, contact the FEMS helpdesk immediately.`,
    });

    return {
      temporaryPassword: dto.newPassword ? undefined : newPassword,
      revokedSessions,
      emailDelivery: emailResult.status,
      message: dto.newPassword
        ? 'Password updated. Share it through a secure channel.'
        : 'A temporary password was generated — it is shown only once.',
    };
  }

  async softDelete(id: string, actor: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    if (user.id === actor.id) {
      throw new ForbiddenException({
        code: 'SELF_DELETE_FORBIDDEN',
        message: 'You cannot delete your own account.',
      });
    }
    if (user.status === UserStatus.DEACTIVATED) {
      throw new BadRequestException({ code: 'ALREADY_DEACTIVATED', message: 'This account is already deactivated.' });
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { deletedAt: new Date(), status: UserStatus.DEACTIVATED },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      action: AuditAction.DELETE,
      severity: AuditSeverity.WARNING,
      entityType: 'User',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      description: `Deactivated account ${user.email}`,
    });

    return { id, deleted: true };
  }

  async restore(id: string, actor: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    if (!user.deletedAt) {
      throw new BadRequestException({ code: 'NOT_DELETED', message: 'This account is not deactivated.' });
    }
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: null, status: UserStatus.ACTIVE },
    });
    await this.audit.record({
      action: AuditAction.RESTORE,
      entityType: 'User',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      description: `Restored account ${user.email}`,
    });
    return this.findOne(id);
  }

  /** Counters used by the administrator landing dashboard. */
  async statistics() {
    const [total, active, pending, suspended, byRole, byCompany] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, status: UserStatus.ACTIVE } }),
      this.prisma.user.count({ where: { deletedAt: null, status: UserStatus.PENDING_VERIFICATION } }),
      this.prisma.user.count({ where: { deletedAt: null, status: UserStatus.SUSPENDED } }),
      this.prisma.userRole.groupBy({ by: ['roleId'], _count: { _all: true } }),
      this.prisma.user.groupBy({
        by: ['companyId'],
        where: { deletedAt: null, companyId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const roles = await this.prisma.role.findMany({ select: { id: true, name: true, label: true } });
    return {
      total,
      byStatus: { active, pendingVerification: pending, suspended },
      byRole: byRole.map((row) => {
        const role = roles.find((candidate) => candidate.id === row.roleId);
        return { role: role?.name ?? 'UNKNOWN', label: role?.label ?? 'Unknown', count: row._count._all };
      }),
      withCompany: byCompany.length,
      environment: appConfig().env,
    };
  }
}
