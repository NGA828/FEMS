import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { appConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  type: 'access';
  sid?: string;
  iat?: number;
  exp?: number;
}

/**
 * JWT strategy.
 *
 * The token only proves identity; roles, permissions, account status and the
 * company binding are re-read from the database on every request. That keeps
 * revocation instant (suspended account, removed role, expired role assignment)
 * and means a stolen token cannot outlive an administrative change.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: Request) => {
          const queryToken = request?.query?.access_token;
          return typeof queryToken === 'string' ? queryToken : null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: appConfig().jwt.secret,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_WRONG_TYPE',
        message: 'This token cannot be used for API access.',
      });
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      include: {
        userRoles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
        company: { select: { id: true, status: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException({ code: 'AUTH_USER_NOT_FOUND', message: 'Account no longer exists.' });
    }
    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedException({
        code: 'AUTH_ACCOUNT_SUSPENDED',
        message: 'This account is suspended. Contact an administrator.',
      });
    }
    if (user.status === 'DEACTIVATED') {
      throw new UnauthorizedException({
        code: 'AUTH_ACCOUNT_DEACTIVATED',
        message: 'This account has been deactivated.',
      });
    }

    const now = new Date();
    const activeRoles = user.userRoles.filter(
      (userRole) => !userRole.expiresAt || userRole.expiresAt > now,
    );
    const roles = activeRoles.map((userRole) => userRole.role.name);
    const permissions = new Set<string>();
    for (const userRole of activeRoles) {
      for (const rolePermission of userRole.role.permissions) {
        permissions.add(rolePermission.permission.code);
      }
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles,
      permissions: [...permissions],
      companyId: user.companyId ?? null,
      status: user.status,
      sessionId: payload.sid,
    };
  }
}
