import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../decorators';

/**
 * Resource-scoping helpers.
 *
 * Two classes of read permission exist in FEMS:
 *   - `module:read`      → the role sees every record (regulators, administrators)
 *   - `module:read_own`  → the role only sees records it owns
 *
 * Every list/detail query passes through these helpers so a company
 * representative can never read another company's permits, activities,
 * payments, inspections or reports — even by guessing an id.
 */

export function canReadAll(user: AuthenticatedUser | undefined, module: string): boolean {
  if (!user) return false;
  return user.permissions.includes('*') || user.permissions.includes(`${module}:read`);
}

export function canReadOwn(user: AuthenticatedUser | undefined, module: string): boolean {
  if (!user) return false;
  return canReadAll(user, module) || user.permissions.includes(`${module}:read_own`);
}

/** Single permission check (the `*` wildcard always matches). */
export function hasPermission(user: AuthenticatedUser | undefined, permission: string): boolean {
  if (!user) return false;
  return user.permissions.includes('*') || user.permissions.includes(permission);
}

/** Any-of check, used by the state machines to validate an action's authority. */
export function hasAnyPermission(user: AuthenticatedUser | undefined, permissions: string[]): boolean {
  if (!user) return false;
  if (user.permissions.includes('*')) return true;
  return permissions.some((permission) => user.permissions.includes(permission));
}

export function requiresOwnershipScope(user: AuthenticatedUser | undefined, module: string): boolean {
  return !canReadAll(user, module) && canReadOwn(user, module);
}

export function assertCanReadModule(user: AuthenticatedUser, module: string): void {
  if (!canReadOwn(user, module)) {
    throw new ForbiddenException({
      code: 'PERMISSION_FORBIDDEN',
      message: `Missing permission(s): ${module}:read.`,
    });
  }
}

/** Company scope: regulators see everything, companies are limited to their own. */
export function companyScope(user: AuthenticatedUser, module: string): { companyId?: string | null } {
  if (canReadAll(user, module)) return {};
  if (!user.companyId) {
    throw new ForbiddenException({
      code: 'COMPANY_REQUIRED',
      message: 'Your account is not linked to a company, so this resource is not accessible.',
    });
  }
  return { companyId: user.companyId };
}

/** Owner scope for records with an author column (`applicantId`, `createdById`, …). */
export function ownerScope(
  user: AuthenticatedUser,
  module: string,
  ownerField: string,
): Record<string, unknown> {
  if (canReadAll(user, module)) return {};
  return { [ownerField]: user.id };
}

/**
 * Field-data integrity: an inspector's capture must be close to the declared
 * activity location unless they hold `inspections:verify_field_data` (which
 * allows a documented manual correction with a reason).
 */
export function assertCanManuallyCorrectCoordinates(user: AuthenticatedUser, module: string): void {
  if (user.permissions.includes('*') || user.permissions.includes(`${module}:verify_field_data`)) return;
  if (user.permissions.includes(`${module}:review`)) return;
  throw new ForbiddenException({
    code: 'MANUAL_COORDINATES_FORBIDDEN',
    message:
      'Coordinates must come from the device GPS. Only officers with field-verification rights may record a manual correction.',
  });
}
