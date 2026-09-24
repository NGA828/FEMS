import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuditAction,
  AuditSeverity,
  CompanyStatus,
  CompanyType,
  NotificationType,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { appConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { type RoleName } from '../common/constants/permissions';
import { assertPasswordStrength, hashPassword, verifyPassword } from '../common/utils/password.util';
import { parseDurationToMs, parseDurationToSeconds } from '../common/utils/duration.util';
import type { AuthenticatedUser } from '../common/decorators';
import type {
  ChangePasswordDto,
  LoginDto,
  LogoutDto,
  RefreshTokenDto,
} from './dto/login.dto';
import type {
  ForgotPasswordDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/register.dto';
import type {
  RegisterDeviceTokenDto,
  UpdateNotificationPreferenceDto,
  UpdateProfileDto,
} from './dto/profile.dto';

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  emailVerified: boolean;
  preferredLanguage: string;
  isDemo: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: Array<{ name: string; label: string; level: number }>;
  permissions: string[];
  company: { id: string; name: string; status: CompanyStatus; type: CompanyType } | null;
}

const GENERIC_RESET_MESSAGE =
  'If an account exists for this email address, a password reset code has been sent.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // ---------------------------------------------------------------- register

  /**
   * Self-service registration.
   *
   * Only FOREST_EXPLORER and COMPANY_REPRESENTATIVE may be self-registered;
   * regulator, inspector, operator and administrator accounts are provisioned
   * by an administrator (the requested role is validated, never trusted).
   * The account starts as PENDING_VERIFICATION and cannot log in until the
   * emailed code is confirmed.
   */
  async register(
    dto: RegisterDto,
    meta: RequestMeta,
  ): Promise<{
    user: UserProfile;
    verification: {
      expiresAt: Date;
      emailDelivery: 'SENT' | 'NOT_CONFIGURED' | 'FAILED';
      emailDeliveryMessage: string;
      /** Only returned outside production so the flow stays testable without SMTP. */
      developmentCode?: string;
    };
  }> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findFirst({ where: { email } });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'An account already exists for this email address. Sign in or reset your password.',
      });
    }

    const requestedRole: RoleName =
      dto.requestedRole === 'COMPANY_REPRESENTATIVE' ? 'COMPANY_REPRESENTATIVE' : 'FOREST_EXPLORER';

    if (requestedRole === 'COMPANY_REPRESENTATIVE') {
      if (!dto.companyName || !dto.companyRegistrationNumber) {
        throw new BadRequestException({
          code: 'COMPANY_DETAILS_REQUIRED',
          message:
            'A company name and registration number are required when registering as a company representative.',
        });
      }
    }

    const passwordHash = await hashPassword(dto.password);
    const role = await this.prisma.role.findUnique({ where: { name: requestedRole } });
    if (!role) {
      throw new BadRequestException({
        code: 'ROLE_NOT_PROVISIONED',
        message: `Role ${requestedRole} is not provisioned. Run the FEMS database seed.`,
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      let companyId: string | undefined;
      if (requestedRole === 'COMPANY_REPRESENTATIVE') {
        const company = await tx.company.create({
          data: {
            name: dto.companyName!.trim(),
            registrationNumber: dto.companyRegistrationNumber!.trim(),
            type: dto.companyType ?? CompanyType.LOGGING_COMPANY,
            status: CompanyStatus.PENDING,
            email,
            phone: dto.companyPhone ?? dto.phone ?? '+237000000000',
            addressLine: dto.companyAddress ?? 'Adresse à préciser',
            city: dto.companyCity ?? 'Yaoundé',
            region: dto.companyRegion ?? 'Centre',
            country: 'Cameroun',
          },
        });
        companyId = company.id;
      }

      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          phone: dto.phone,
          status: UserStatus.PENDING_VERIFICATION,
          preferredLanguage: dto.preferredLanguage === 'en' ? 'en' : 'fr',
          companyId,
          userRoles: { create: [{ roleId: role.id }] },
        },
      });

      if (companyId) {
        await tx.company.update({ where: { id: companyId }, data: { ownerId: user.id } });
      }

      const rawToken = this.generateOpaqueToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await tx.emailVerificationToken.create({
        data: { userId: user.id, tokenHash: this.hashToken(rawToken), expiresAt },
      });
      await tx.notificationPreference.createMany({
        data: DEFAULT_NOTIFICATION_PREFERENCES.map((type) => ({
          userId: user.id,
          type,
          inAppEnabled: true,
          pushEnabled: type !== NotificationType.SYSTEM_ANNOUNCEMENT,
          emailEnabled: false,
        })),
      });

      return { user, rawToken, expiresAt };
    });

    const mailResult = await this.mail.sendEmailVerification(
      created.user.email,
      created.user.firstName,
      created.rawToken,
      created.expiresAt,
    );

    await this.audit.record({
      action: AuditAction.REGISTER,
      entityType: 'User',
      entityId: created.user.id,
      actorId: created.user.id,
      actorEmail: created.user.email,
      description: `Registered as ${requestedRole}${requestedRole === 'COMPANY_REPRESENTATIVE' ? ` for ${dto.companyName}` : ''}`,
      after: { email, role: requestedRole, companyId: created.user.companyId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const profile = await this.buildProfile(created.user.id);

    return {
      user: profile,
      verification: {
        expiresAt: created.expiresAt,
        emailDelivery: mailResult.status,
        emailDeliveryMessage:
          mailResult.status === 'SENT'
            ? `A verification code was sent to ${email}.`
            : `${mailResult.error ?? 'Email delivery is unavailable.'} ${
                appConfig().isProduction
                  ? 'Contact an administrator to activate your account.'
                  : 'The code is returned in this response (non-production) so the flow can be completed.'
              }`,
        developmentCode: appConfig().isProduction ? undefined : created.rawToken,
      },
    };
  }

  // ------------------------------------------------------------------- login

  async login(dto: LoginDto, meta: RequestMeta): Promise<{ user: UserProfile; tokens: AuthTokens }> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });

    // Constant-ish work factor: always run a bcrypt comparison so that response
    // timing does not reveal whether the email address exists.
    const dummyHash = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8pZ8Q5oQ5oQ5oQ5oQ5oQ5oQ5oQ5oQ5o';
    const passwordOk = await verifyPassword(dto.password, user?.passwordHash ?? dummyHash);

    if (!user || !passwordOk) {
      if (user) {
        await this.registerFailedAttempt(user.id, user.failedLoginCount + 1);
      }
      await this.audit.record({
        action: user ? AuditAction.LOGIN_FAILED : AuditAction.LOGIN_FAILED,
        severity: AuditSeverity.WARNING,
        entityType: 'User',
        entityId: user?.id,
        actorEmail: email,
        description: 'Failed sign-in attempt (invalid credentials)',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Email address or password is incorrect.',
      });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException({
        code: 'AUTH_ACCOUNT_LOCKED',
        message: `Too many failed attempts. This account is locked for ${minutes} more minute(s).`,
      });
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException({
        code: 'AUTH_ACCOUNT_SUSPENDED',
        message: 'This account is suspended. Contact a FEMS administrator.',
      });
    }
    if (user.status === UserStatus.DEACTIVATED) {
      throw new ForbiddenException({
        code: 'AUTH_ACCOUNT_DEACTIVATED',
        message: 'This account has been deactivated.',
      });
    }
    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException({
        code: 'AUTH_EMAIL_NOT_VERIFIED',
        message: 'Confirm your email address before signing in. Use POST /auth/email-verification/resend.',
      });
    }

    const tokens = await this.issueTokenPair(user.id, user.email, meta);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });

    await this.audit.record({
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      description: 'Successful sign-in',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { user: await this.buildProfile(user.id), tokens: this.toAuthTokens(tokens) };
  }

  /**
   * Refresh-token rotation with reuse detection.
   * A valid refresh token is revoked and replaced on every use; presenting an
   * already-rotated token revokes the whole token family (stolen-token defence).
   */
  async refresh(dto: RefreshTokenDto, meta: RequestMeta): Promise<{ user: UserProfile; tokens: AuthTokens }> {
    const tokenHash = this.hashToken(dto.refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, deletedAt: true, status: true } } },
    });

    if (!stored) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_TOKEN_INVALID',
        message: 'This refresh token is not recognised. Sign in again.',
      });
    }

    if (stored.revokedAt) {
      // A token that was rotated (it has a successor) but is presented again
      // means the token was stolen or replayed: revoke the whole family and
      // raise a critical audit event. A token revoked by an explicit action
      // (sign-out, password reset, session revocation) is a normal rejection.
      const wasRotated = Boolean(stored.replacedByTokenId);
      if (wasRotated) {
        await this.revokeFamily(stored.family, 'refresh token reuse detected');
        await this.audit.record({
          action: AuditAction.TOKEN_REFRESH,
          severity: AuditSeverity.CRITICAL,
          entityType: 'RefreshToken',
          entityId: stored.id,
          actorId: stored.userId,
          description: `Refresh-token reuse detected for session ${stored.family} — every token in the family was revoked`,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
        throw new UnauthorizedException({
          code: 'AUTH_REFRESH_REUSE',
          message: 'This refresh token was already used. For security, all sessions were revoked — sign in again.',
        });
      }
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_REVOKED',
        message: 'This session was revoked (sign-out, password change or administrator action). Sign in again.',
      });
    }

    if (stored.expiresAt <= new Date()) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_TOKEN_EXPIRED',
        message: 'Your session expired. Sign in again.',
      });
    }

    const user = stored.user;
    if (!user || user.deletedAt) {
      throw new UnauthorizedException({ code: 'AUTH_USER_NOT_FOUND', message: 'Account no longer exists.' });
    }
    if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.DEACTIVATED) {
      await this.revokeFamily(stored.family, 'account not active');
      throw new UnauthorizedException({
        code: 'AUTH_ACCOUNT_INACTIVE',
        message: 'This account is no longer active. Contact a FEMS administrator.',
      });
    }

    const tokens = await this.prisma.$transaction(async (tx) => {
      const issued = await this.issueTokenPair(user.id, user.email, meta, stored.family, tx);
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), replacedByTokenId: issued.recordId },
      });
      return issued;
    });

    return { user: await this.buildProfile(user.id), tokens: this.toAuthTokens(tokens) };
  }

  async logout(userId: string, dto: LogoutDto, meta: RequestMeta): Promise<{ revokedSessions: number }> {
    if (dto.refreshToken) {
      const tokenHash = this.hashToken(dto.refreshToken);
      const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
      if (stored && stored.userId === userId && !stored.revokedAt) {
        await this.prisma.refreshToken.update({
          where: { id: stored.id },
          data: { revokedAt: new Date() },
        });
        await this.audit.record({
          action: AuditAction.LOGOUT,
          entityType: 'RefreshToken',
          entityId: stored.id,
          actorId: userId,
          description: 'Signed out of one session',
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
        return { revokedSessions: 1 };
      }
      return { revokedSessions: 0 };
    }

    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: userId,
      actorId: userId,
      description: `Signed out of all sessions (${result.count})`,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { revokedSessions: result.count };
  }

  // ------------------------------------------------------------ verification

  async verifyEmail(dto: VerifyEmailDto, meta: RequestMeta): Promise<{ user: UserProfile; tokens: AuthTokens }> {
    const tokenHash = this.hashToken(dto.token.trim());
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException({
        code: 'EMAIL_VERIFICATION_INVALID',
        message: 'This verification code is invalid or has expired. Request a new one.',
      });
    }

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date(), status: UserStatus.ACTIVE },
      }),
    ]);

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: record.userId,
      actorId: record.userId,
      description: 'Email address verified — account activated',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const tokens = await this.issueTokenPair(record.userId, record.user.email, meta);
    return { user: await this.buildProfile(record.userId), tokens: this.toAuthTokens(tokens) };
  }

  async resendVerification(email: string, meta: RequestMeta): Promise<{ message: string; emailDelivery: string; developmentCode?: string }> {
    const user = await this.prisma.user.findFirst({ where: { email: email.toLowerCase().trim(), deletedAt: null } });
    const genericResponse = {
      message: 'If the account exists and is not yet verified, a new verification code has been sent.',
      emailDelivery: 'NOT_SENT',
    };
    if (!user) return genericResponse;
    if (user.emailVerifiedAt) {
      return { message: 'This email address is already verified. You can sign in.', emailDelivery: 'NOT_SENT' };
    }

    // Invalidate previous unused codes before issuing a new one.
    await this.prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const rawToken = this.generateOpaqueToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: this.hashToken(rawToken), expiresAt },
    });
    const result = await this.mail.sendEmailVerification(user.email, user.firstName, rawToken, expiresAt);

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      description: `Verification code re-issued (delivery: ${result.status})`,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      message: 'If the account exists and is not yet verified, a new verification code has been sent.',
      emailDelivery: result.status,
      developmentCode: appConfig().isProduction ? undefined : rawToken,
    };
  }

  // ---------------------------------------------------------- password reset

  async forgotPassword(dto: ForgotPasswordDto, meta: RequestMeta): Promise<{ message: string; emailDelivery: string; developmentCode?: string }> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase().trim(), deletedAt: null },
    });
    if (!user) {
      // Same response as the success path — no account enumeration.
      return { message: GENERIC_RESET_MESSAGE, emailDelivery: 'NOT_SENT' };
    }

    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = this.generateOpaqueToken();
    const expiresAt = new Date(Date.now() + appConfig().jwt.passwordResetTtlMinutes * 60 * 1000);
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: this.hashToken(rawToken), expiresAt },
    });

    const result = await this.mail.sendPasswordReset(user.email, user.firstName, rawToken, expiresAt);

    await this.audit.record({
      action: AuditAction.PASSWORD_RESET,
      severity: AuditSeverity.WARNING,
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      description: `Password reset requested (delivery: ${result.status})`,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      message: GENERIC_RESET_MESSAGE,
      emailDelivery: result.status,
      developmentCode: appConfig().isProduction ? undefined : rawToken,
    };
  }

  async resetPassword(dto: ResetPasswordDto, meta: RequestMeta): Promise<{ message: string }> {
    assertPasswordStrength(dto.newPassword);
    const tokenHash = this.hashToken(dto.token.trim());
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException({
        code: 'PASSWORD_RESET_INVALID',
        message: 'This password reset code is invalid or has expired. Request a new one.',
      });
    }

    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null, status: UserStatus.ACTIVE },
      }),
      // Resetting a password invalidates every existing session.
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      action: AuditAction.PASSWORD_RESET,
      severity: AuditSeverity.WARNING,
      entityType: 'User',
      entityId: record.userId,
      actorId: record.userId,
      description: 'Password reset completed — all sessions revoked',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { message: 'Your password has been updated. Sign in with your new password.' };
  }

  async changePassword(
    user: AuthenticatedUser,
    dto: ChangePasswordDto,
    meta: RequestMeta,
  ): Promise<{ message: string; revokedSessions: number }> {
    const record = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!record) throw new NotFoundException({ code: 'AUTH_USER_NOT_FOUND', message: 'Account not found.' });

    const ok = await verifyPassword(dto.currentPassword, record.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CURRENT_PASSWORD',
        message: 'The current password is incorrect.',
      });
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException({
        code: 'PASSWORD_UNCHANGED',
        message: 'The new password must be different from the current password.',
      });
    }

    const passwordHash = await hashPassword(dto.newPassword);
    // Every *other* session is revoked; the device performing the change keeps
    // working (its own refresh-token family stays valid).
    const [, revoked] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
          family: user.sessionId ? { not: user.sessionId } : undefined,
        },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      action: AuditAction.ACCOUNT_STATUS_CHANGE,
      severity: AuditSeverity.WARNING,
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Password changed — ${revoked.count} session(s) revoked`,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      message: `Password updated. ${revoked.count} other session(s) were signed out.`,
      revokedSessions: revoked.count,
    };
  }

  // ---------------------------------------------------------------- profile

  async buildProfile(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        userRoles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
        company: { select: { id: true, name: true, status: true, type: true } },
      },
    });
    if (!user) throw new NotFoundException({ code: 'AUTH_USER_NOT_FOUND', message: 'Account not found.' });

    const now = new Date();
    const activeRoles = user.userRoles.filter((userRole) => !userRole.expiresAt || userRole.expiresAt > now);
    const permissions = new Set<string>();
    for (const userRole of activeRoles) {
      for (const rolePermission of userRole.role.permissions) permissions.add(rolePermission.permission.code);
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      phone: user.phone,
      jobTitle: user.jobTitle,
      avatarUrl: user.avatarUrl,
      status: user.status,
      emailVerified: Boolean(user.emailVerifiedAt),
      preferredLanguage: user.preferredLanguage,
      isDemo: user.isDemo,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      roles: activeRoles
        .map((userRole) => ({
          name: userRole.role.name,
          label: userRole.role.label,
          level: userRole.role.level,
        }))
        .sort((a, b) => b.level - a.level),
      permissions: [...permissions],
      company: user.company
        ? { id: user.company.id, name: user.company.name, status: user.company.status, type: user.company.type }
        : null,
    };
  }

  async updateProfile(user: AuthenticatedUser, dto: UpdateProfileDto, meta: RequestMeta): Promise<UserProfile> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
        phone: dto.phone,
        jobTitle: dto.jobTitle,
        avatarUrl: dto.avatarUrl,
        preferredLanguage: dto.preferredLanguage,
      },
    });
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      description: 'Profile updated',
      after: dto as unknown as Record<string, unknown>,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return this.buildProfile(user.id);
  }

  /** Active sessions (refresh-token families) for the "Security" screen. */
  async listSessions(userId: string, currentSessionId?: string) {
    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const byFamily = new Map<string, (typeof sessions)[number]>();
    for (const session of sessions) {
      if (!byFamily.has(session.family)) byFamily.set(session.family, session);
    }
    return [...byFamily.values()].map((session) => ({
      id: session.family,
      current: currentSessionId === session.family,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    }));
  }

  async revokeSession(userId: string, sessionId: string, meta: RequestMeta): Promise<{ revokedSessions: number }> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, family: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'No active session with this identifier.',
      });
    }
    await this.audit.record({
      action: AuditAction.LOGOUT,
      entityType: 'RefreshToken',
      entityId: sessionId,
      actorId: userId,
      description: 'Session revoked from the device list',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { revokedSessions: result.count };
  }

  // ---------------------------------------------------------- device tokens

  async registerDeviceToken(userId: string, dto: RegisterDeviceTokenDto): Promise<{ id: string; token: string; platform: string }> {
    const record = await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      update: { userId, platform: dto.platform, lastUsedAt: new Date() },
      create: { userId, token: dto.token, platform: dto.platform },
    });
    return { id: record.id, token: record.token, platform: record.platform };
  }

  async removeDeviceToken(userId: string, token: string): Promise<{ removed: boolean }> {
    const result = await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
    return { removed: result.count > 0 };
  }

  // ------------------------------------------------- notification preferences

  async listNotificationPreferences(userId: string) {
    const stored = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const byType = new Map(stored.map((preference) => [preference.type, preference]));
    return ALL_NOTIFICATION_TYPES.map((type) => {
      const preference = byType.get(type);
      return {
        type,
        inAppEnabled: preference?.inAppEnabled ?? true,
        pushEnabled: preference?.pushEnabled ?? true,
        emailEnabled: preference?.emailEnabled ?? false,
        isDefault: !preference,
      };
    });
  }

  async updateNotificationPreference(userId: string, dto: UpdateNotificationPreferenceDto) {
    const updated = await this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type: dto.type } },
      update: {
        inAppEnabled: dto.inAppEnabled,
        pushEnabled: dto.pushEnabled,
        emailEnabled: dto.emailEnabled,
      },
      create: {
        userId,
        type: dto.type,
        inAppEnabled: dto.inAppEnabled ?? true,
        pushEnabled: dto.pushEnabled ?? true,
        emailEnabled: dto.emailEnabled ?? false,
      },
    });
    return {
      type: updated.type,
      inAppEnabled: updated.inAppEnabled,
      pushEnabled: updated.pushEnabled,
      emailEnabled: updated.emailEnabled,
      isDefault: false,
    };
  }

  // ----------------------------------------------------------------- helpers

  private async issueTokenPair(
    userId: string,
    email: string,
    meta: RequestMeta,
    family?: string,
    client?: Prisma.TransactionClient,
  ) {
    const config = appConfig();
    const db = client ?? this.prisma;
    const rawRefresh = this.generateOpaqueToken();
    const tokenFamily = family ?? this.generateOpaqueToken(16);
    const refreshExpiresAt = new Date(Date.now() + parseDurationToMs(config.jwt.refreshExpiresIn, 30 * 86_400_000));

    const record = await db.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(rawRefresh),
        family: tokenFamily,
        expiresAt: refreshExpiresAt,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
      },
    });

    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, type: 'access', sid: tokenFamily },
      { secret: config.jwt.secret, expiresIn: parseDurationToSeconds(config.jwt.expiresIn, 900) },
    );

    return {
      recordId: record.id,
      accessToken,
      refreshToken: rawRefresh,
      family: tokenFamily,
      expiresIn: parseDurationToSeconds(config.jwt.expiresIn, 900),
      refreshExpiresIn: parseDurationToSeconds(config.jwt.refreshExpiresIn, 2_592_000),
    };
  }

  private toAuthTokens(issued: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    refreshExpiresIn: number;
  }): AuthTokens {
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      tokenType: 'Bearer',
      expiresIn: issued.expiresIn,
      refreshExpiresIn: issued.refreshExpiresIn,
    };
  }

  private async revokeFamily(family: string, reason: string): Promise<void> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.warn(`Revoked ${result.count} refresh token(s) in family ${family}: ${reason}`);
  }

  private async registerFailedAttempt(userId: string, attempts: number): Promise<void> {
    const { maxLoginAttempts, loginLockMinutes } = appConfig().jwt;
    const shouldLock = attempts >= maxLoginAttempts;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + loginLockMinutes * 60_000) : null,
      },
    });
    if (shouldLock) {
      this.logger.warn(`Account ${userId} locked after ${attempts} failed sign-in attempts.`);
    }
  }

  private generateOpaqueToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationType[] = [
  NotificationType.PERMIT_SUBMITTED,
  NotificationType.PERMIT_APPROVED,
  NotificationType.PERMIT_REJECTED,
  NotificationType.PERMIT_REVISION_REQUIRED,
  NotificationType.PERMIT_ACTIVATED,
  NotificationType.PERMIT_SUSPENDED,
  NotificationType.PERMIT_EXPIRING,
  NotificationType.PAYMENT_INITIATED,
  NotificationType.PAYMENT_SUCCESSFUL,
  NotificationType.PAYMENT_FAILED,
  NotificationType.INSPECTION_ASSIGNED,
  NotificationType.INSPECTION_COMPLETED,
  NotificationType.VIOLATION_RECORDED,
  NotificationType.AI_ALERT_GENERATED,
  NotificationType.AI_ALERT_ASSIGNED,
  NotificationType.ACTIVITY_SCHEDULED,
  NotificationType.OBSERVATION_RECORDED,
  NotificationType.REPORT_READY,
  NotificationType.COMPANY_VERIFIED,
  NotificationType.ACCOUNT_ACTIVATED,
  NotificationType.SYSTEM_ANNOUNCEMENT,
];

const ALL_NOTIFICATION_TYPES: NotificationType[] = Object.values(NotificationType);
