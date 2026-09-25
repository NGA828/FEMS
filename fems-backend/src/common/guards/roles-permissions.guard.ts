import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  IS_PUBLIC_KEY,
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
  ROLES_KEY,
  type AuthenticatedUser,
} from '../decorators';

/**
 * Role guard — runs after JwtAuthGuard.
 * Roles are an additional gate on top of permissions (e.g. only
 * GOVERNMENT_FOREST_OFFICER may call the regulatory decision endpoints).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException({ code: 'AUTH_REQUIRED', message: 'Authentication required.' });
    }
    const allowed = user.roles.some((role) => required.includes(role) || role === 'ADMINISTRATOR');
    if (!allowed) {
      throw new ForbiddenException({
        code: 'ROLE_FORBIDDEN',
        message: `This operation requires one of the following roles: ${required.join(', ')}.`,
      });
    }
    return true;
  }
}

/**
 * Permission guard — the authoritative authorization check.
 * The mobile app hides actions the user cannot perform, but the API always
 * enforces the permission independently (never trust the client).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handlers = [context.getHandler(), context.getClass()];
    const requiredAll = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, handlers);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_ANY_KEY, handlers);
    const needsAll = Boolean(requiredAll && requiredAll.length > 0);
    const needsAny = Boolean(requiredAny && requiredAny.length > 0);
    if (!needsAll && !needsAny) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, handlers)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException({ code: 'AUTH_REQUIRED', message: 'Authentication required.' });
    }
    if (user.permissions.includes('*')) return true;
    if (needsAny && !(requiredAny as string[]).some((permission) => user.permissions.includes(permission))) {
      throw new ForbiddenException({
        code: 'PERMISSION_FORBIDDEN',
        message: `Requires one of the following permissions: ${(requiredAny as string[]).join(', ')}.`,
        details: { requiredAny },
      });
    }
    const missing = (requiredAll ?? []).filter((permission) => !user.permissions.includes(permission));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'PERMISSION_FORBIDDEN',
        message: `Missing permission(s): ${missing.join(', ')}.`,
        details: { required: requiredAll, missing },
      });
    }
    return true;
  }
}
