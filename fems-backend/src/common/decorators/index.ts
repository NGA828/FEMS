import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'fems:isPublic';
export const ROLES_KEY = 'fems:roles';
export const PERMISSIONS_KEY = 'fems:permissions';
export const PERMISSIONS_ANY_KEY = 'fems:permissions:any';
export const AUDIT_KEY = 'fems:audit';

/** Marks a route as reachable without authentication (public forest browsing, auth endpoints). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the given role names (checked in addition to permissions). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** Restricts a route to holders of every listed permission code. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Restricts a route to holders of at least one of the listed permission codes.
 * Used for reads that a regulator performs globally (`module:read`) and a
 * company performs on its own records (`module:read_own`).
 */
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_ANY_KEY, permissions);

export interface AuditMetadata {
  action: string;
  entityType?: string;
  description?: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
}

/** Declares that the operation must be written to the audit trail. */
export const Audit = (metadata: AuditMetadata) => SetMetadata(AUDIT_KEY, metadata);

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  companyId: string | null;
  status: string;
  sessionId?: string;
}

/** Injects the authenticated principal (populated by JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);

export const hasPermission = (user: AuthenticatedUser | undefined, permission: string): boolean => {
  if (!user) return false;
  if (user.permissions.includes('*')) return true;
  return user.permissions.includes(permission);
};
