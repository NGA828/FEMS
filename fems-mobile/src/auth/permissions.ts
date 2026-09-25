/**
 * Permission helpers.
 *
 * These mirror the permission codes the backend emits in the login/`/auth/me`
 * payload. They only drive presentation: whether a button is drawn, whether a
 * query runs at all (a 403 in the console helps nobody) and which empty state a
 * screen shows. Authorisation itself always happens again on the server.
 */

export type ReadScope = 'all' | 'own' | 'public' | 'none';

const READ_PERMISSIONS: Record<string, string[]> = {
  permits: ['permits:read', 'permits:read_own'],
  payments: ['payments:read', 'payments:read_own'],
  inspections: ['inspections:read', 'inspections:read_own'],
  observations: ['observations:read'],
  environmental: ['environmental:read'],
  exploitation: ['exploitation:read', 'exploitation:read_own'],
  equipment: ['equipment:read'],
  reports: ['reports:read', 'reports:read_own'],
  companies: ['companies:read', 'companies:read_own'],
  users: ['users:read'],
  forests: ['forests:read', 'forests:read_public'],
  zones: ['zones:read', 'forests:read', 'forests:read_public'],
  inventory: ['inventory:read', 'forests:read'],
  gis: ['gis:read', 'gis:read_public'],
  audit: ['audit:read'],
  notifications: ['notifications:read'],
  aiAlerts: ['ai:alerts_read'],
  aiAssistant: ['ai:assistant_use'],
  aiAnalysis: ['ai:analysis_run'],
};

export function hasPermission(permissions: string[], permission: string): boolean {
  return permissions.includes('*') || permissions.includes(permission);
}

export function hasAnyPermission(permissions: string[], list: string[]): boolean {
  return list.some((permission) => hasPermission(permissions, permission));
}

/** Whether the account may read a module at all (any scope). */
export function canRead(permissions: string[], module: keyof typeof READ_PERMISSIONS | string): boolean {
  const list = READ_PERMISSIONS[module];
  if (!list) return hasPermission(permissions, `${module}:read`);
  return hasAnyPermission(permissions, list);
}

/**
 * Which slice of the module the account sees. A company account gets `own` even
 * when it also holds a public read grant, because the backend pins it to its own
 * records — the label the user sees should match what comes back.
 */
export function readScope(permissions: string[], module: string): ReadScope {
  if (permissions.includes('*')) return 'all';
  if (hasPermission(permissions, `${module}:read`)) return 'all';
  if (hasPermission(permissions, `${module}:read_own`)) return 'own';
  if (hasPermission(permissions, `${module}:read_public`)) return 'public';
  return canRead(permissions, module) ? 'all' : 'none';
}

export function canCreate(permissions: string[], module: string): boolean {
  return hasPermission(permissions, `${module}:create`);
}

export function canUpdate(permissions: string[], module: string): boolean {
  return hasAnyPermission(permissions, [`${module}:update`, `${module}:manage`, `${module}:create`]);
}
