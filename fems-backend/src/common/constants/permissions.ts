/**
 * FEMS permission catalogue — the single source of truth for RBAC.
 *
 * The same data seeds the `permissions`, `roles` and `role_permissions` tables
 * (see prisma/seed.ts) and is used by the guards at runtime, so the database and
 * the code can never drift apart.
 *
 * Naming convention: `<module>:<action>`. The `:read_own` variants scope a role
 * to the records it owns (its company, its own submissions, its assignments).
 */

export interface PermissionDefinition {
  code: string;
  module: string;
  description: string;
}

const define = (module: string, actions: string[]): PermissionDefinition[] =>
  actions.map((action) => ({
    code: `${module}:${action}`,
    module,
    description: `${module} — ${action.replace(/_/g, ' ')}`,
  }));

export const PERMISSIONS: PermissionDefinition[] = [
  ...define('users', ['read', 'create', 'update', 'deactivate', 'manage_roles', 'reset_password']),
  ...define('roles', ['read', 'manage']),
  ...define('companies', [
    'read',
    'read_own',
    'create',
    'update',
    'verify',
    'manage_documents',
    'export_document',
  ]),
  ...define('forests', ['read', 'read_public', 'create', 'update', 'delete', 'manage']),
  ...define('zones', ['read', 'create', 'update', 'delete']),
  ...define('protected-areas', ['read', 'create', 'update', 'delete']),
  ...define('tree-species', ['read', 'create', 'update', 'delete']),
  ...define('inventory', ['read', 'create', 'update', 'delete']),
  ...define('permits', [
    'read',
    'read_own',
    'create',
    'update',
    'submit',
    'review',
    'approve',
    'reject',
    'request_revision',
    'renew',
    'suspend',
    'revoke',
    'cancel',
    'download',
    'manage_documents',
  ]),
  ...define('exploitation', [
    'read',
    'read_own',
    'create',
    'update',
    'schedule',
    'record',
    'submit',
    'assign',
    'delete',
  ]),
  ...define('equipment', ['read', 'create', 'update', 'delete']),
  ...define('payments', ['read', 'read_own', 'create', 'verify', 'refund', 'download_receipt']),
  ...define('inspections', [
    'read',
    'read_own',
    'create',
    'assign',
    'update',
    'submit',
    'review',
    'close',
    'verify_field_data',
  ]),
  ...define('environmental', [
    'read',
    'read_own',
    'create',
    'update',
    'manage_violations',
    'resolve_violation',
  ]),
  ...define('observations', ['read', 'create', 'update', 'delete']),
  ...define('reports', ['read', 'read_own', 'create', 'export', 'delete']),
  ...define('notifications', ['read', 'manage_preferences']),
  ...define('gis', ['read', 'read_public', 'manage', 'record_location']),
  ...define('ai', [
    'assistant_use',
    'analysis_run',
    'alerts_read',
    'alerts_review',
    'settings_manage',
  ]),
  ...define('audit', ['read']),
  ...define('settings', ['read', 'manage']),
  ...define('system', ['monitor', 'health']),
  ...define('files', ['upload', 'read']),
];

export const PERMISSION_CODES = PERMISSIONS.map((permission) => permission.code);

/** Wildcard permission — granted to administrators only. */
export const WILDCARD = '*';

/**
 * The wildcard is stored as a real row so the catalogue and the database can
 * never disagree: if a role carries `*`, the grant is visible in the RBAC
 * screens and audited like any other. It is excluded from the module buckets
 * returned by `GET /roles/permissions` (it is not a `<module>:<action>` code).
 */
export const WILDCARD_PERMISSION: PermissionDefinition = {
  code: WILDCARD,
  module: 'system',
  description: 'Unrestricted access to every module and action (administrator only).',
};

/** Everything that must exist in the `permissions` table. */
export const PERMISSION_CATALOGUE: PermissionDefinition[] = [...PERMISSIONS, WILDCARD_PERMISSION];

export const ROLE_NAMES = [
  'VISITOR',
  'FOREST_EXPLORER',
  'COMPANY_REPRESENTATIVE',
  'GOVERNMENT_FOREST_OFFICER',
  'ENVIRONMENTAL_OFFICER',
  'FOREST_INSPECTOR',
  'FIELD_OPERATOR',
  'ADMINISTRATOR',
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export interface RoleDefinition {
  name: RoleName;
  label: string;
  description: string;
  level: number;
  permissions: string[];
}

const VISITOR_PERMISSIONS = [
  'forests:read_public',
  'protected-areas:read',
  'tree-species:read',
  'gis:read_public',
  'notifications:read',
  'notifications:manage_preferences',
  'files:read',
];

const EXPLORER_PERMISSIONS = [
  ...VISITOR_PERMISSIONS,
  'forests:read',
  'zones:read',
  'inventory:read',
  'gis:read',
  'permits:read_own',
  'permits:create',
  'permits:update',
  'permits:submit',
  'permits:cancel',
  'permits:download',
  'permits:manage_documents',
  'files:upload',
  'reports:read_own',
  'ai:assistant_use',
];

const COMPANY_PERMISSIONS = [
  ...VISITOR_PERMISSIONS,
  'forests:read',
  'zones:read',
  'inventory:read',
  'gis:read',
  'companies:read_own',
  'companies:update',
  'companies:manage_documents',
  'companies:export_document',
  'permits:read_own',
  'permits:create',
  'permits:update',
  'permits:submit',
  'permits:cancel',
  'permits:renew',
  'permits:download',
  'permits:manage_documents',
  'exploitation:read_own',
  'exploitation:create',
  'exploitation:update',
  'exploitation:schedule',
  'exploitation:record',
  'exploitation:submit',
  'exploitation:assign',
  'equipment:read',
  'equipment:create',
  'equipment:update',
  'equipment:delete',
  'payments:read_own',
  'payments:create',
  'payments:download_receipt',
  'reports:read_own',
  'reports:create',
  'reports:export',
  'observations:read',
  'observations:create',
  // A company reads the controls carried out on its own sites, never the
  // inspection file of another operator (`inspections:read` is the regulator
  // permission and stays out of this list).
  'inspections:read_own',
  'environmental:read',
  'files:upload',
  'ai:assistant_use',
];

const GOVERNMENT_PERMISSIONS = [
  ...VISITOR_PERMISSIONS,
  'forests:read',
  'forests:create',
  'forests:update',
  'forests:manage',
  'zones:read',
  'zones:create',
  'zones:update',
  'protected-areas:read',
  'protected-areas:create',
  'protected-areas:update',
  'tree-species:read',
  'tree-species:create',
  'tree-species:update',
  'inventory:read',
  'inventory:create',
  'inventory:update',
  'companies:read',
  'companies:verify',
  'permits:read',
  'permits:review',
  'permits:approve',
  'permits:reject',
  'permits:request_revision',
  'permits:renew',
  'permits:suspend',
  'permits:revoke',
  'permits:download',
  'exploitation:read',
  'exploitation:assign',
  'equipment:read',
  'payments:read',
  'payments:verify',
  'payments:download_receipt',
  'inspections:read',
  'inspections:create',
  'inspections:assign',
  'inspections:review',
  'inspections:close',
  'environmental:read',
  'environmental:create',
  'environmental:update',
  'environmental:resolve_violation',
  'observations:read',
  'reports:read',
  'reports:create',
  'reports:export',
  'gis:read',
  'gis:manage',
  'gis:record_location',
  'users:read',
  'notifications:read',
  'notifications:manage_preferences',
  'ai:assistant_use',
  'ai:analysis_run',
  'ai:alerts_read',
  'ai:alerts_review',
  'audit:read',
  'files:upload',
  'files:read',
];

const ENVIRONMENTAL_PERMISSIONS = [
  ...VISITOR_PERMISSIONS,
  'protected-areas:read',
  'protected-areas:create',
  'protected-areas:update',
  'forests:read',
  'zones:read',
  'inventory:read',
  'gis:read',
  'gis:record_location',
  'permits:read',
  'exploitation:read',
  'inspections:read',
  'inspections:create',
  'inspections:update',
  'inspections:submit',
  'inspections:verify_field_data',
  'environmental:read',
  'environmental:create',
  'environmental:update',
  'environmental:manage_violations',
  'environmental:resolve_violation',
  'observations:read',
  'observations:create',
  'observations:update',
  'reports:read',
  'reports:create',
  'reports:export',
  'ai:assistant_use',
  'ai:analysis_run',
  'ai:alerts_read',
  'ai:alerts_review',
  'files:upload',
  'files:read',
];

const INSPECTOR_PERMISSIONS = [
  ...VISITOR_PERMISSIONS,
  'forests:read',
  'zones:read',
  'inventory:read',
  'protected-areas:read',
  'gis:read',
  'gis:record_location',
  'permits:read',
  'exploitation:read',
  'exploitation:record',
  'inspections:read_own',
  'inspections:read',
  'inspections:update',
  'inspections:submit',
  'inspections:verify_field_data',
  'environmental:read',
  'environmental:create',
  'observations:read',
  'observations:create',
  'reports:read_own',
  'ai:assistant_use',
  'ai:alerts_read',
  'ai:alerts_review',
  'files:upload',
  'files:read',
];

const FIELD_OPERATOR_PERMISSIONS = [
  ...VISITOR_PERMISSIONS,
  'forests:read',
  'zones:read',
  'gis:read',
  'gis:record_location',
  'exploitation:read_own',
  'exploitation:record',
  'exploitation:submit',
  'observations:read',
  'observations:create',
  'observations:update',
  'inspections:read_own',
  'environmental:read',
  'notifications:read',
  'notifications:manage_preferences',
  'files:upload',
  'files:read',
];

const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    name: 'VISITOR',
    label: 'Visitor',
    description:
      'Not-yet-verified account: browse public forest resources and register interest. No protected data.',
    level: 0,
    permissions: VISITOR_PERMISSIONS,
  },
  {
    name: 'FOREST_EXPLORER',
    label: 'Forest Explorer',
    description:
      'Independent explorer: browse forests and zones, request and track exploitation permits, use the AI assistant.',
    level: 10,
    permissions: EXPLORER_PERMISSIONS,
  },
  {
    name: 'COMPANY_REPRESENTATIVE',
    label: 'Company Representative',
    description:
      'Manages a company profile, permit applications, exploitation activities, equipment, payments and reports.',
    level: 20,
    permissions: COMPANY_PERMISSIONS,
  },
  {
    name: 'GOVERNMENT_FOREST_OFFICER',
    label: 'Government Forest Officer',
    description:
      'Reviews and decides on permits, monitors exploitation, verifies payments and produces regulatory reports.',
    level: 40,
    permissions: GOVERNMENT_PERMISSIONS,
  },
  {
    name: 'ENVIRONMENTAL_OFFICER',
    label: 'Environmental Officer',
    description:
      'Monitors protected areas, performs environmental inspections, records violations and reviews AI alerts.',
    level: 40,
    permissions: ENVIRONMENTAL_PERMISSIONS,
  },
  {
    name: 'FOREST_INSPECTOR',
    label: 'Forest Inspector',
    description:
      'Executes assigned field inspections with device GPS and evidence, verifies activity data and investigates AI alerts.',
    level: 30,
    permissions: INSPECTOR_PERMISSIONS,
  },
  {
    name: 'FIELD_OPERATOR',
    label: 'Field Operator',
    description:
      'Executes assigned exploitation activities in the field, records harvests, GPS positions, photos and incidents.',
    level: 25,
    permissions: FIELD_OPERATOR_PERMISSIONS,
  },
  {
    name: 'ADMINISTRATOR',
    label: 'Administrator',
    description:
      'Full platform administration: users, roles, reference data, settings, monitoring and audit trail.',
    level: 100,
    permissions: [WILDCARD],
  },
];

/**
 * Role catalogue.
 *
 * The raw definitions above compose shared permission sets with spread
 * operators, which is readable but can repeat a code. Duplicates are removed
 * here so the exported catalogue — and therefore the `rolePermission` rows,
 * the `permissionCount` shown in the RBAC screens and the audit trail — always
 * reflects a set of distinct grants.
 */
export const ROLES: RoleDefinition[] = ROLE_DEFINITIONS.map((role) => ({
  ...role,
  permissions: [...new Set(role.permissions)],
}));

export const ROLE_BY_NAME = new Map(ROLES.map((role) => [role.name, role]));

export function permissionsForRoles(roleNames: string[]): Set<string> {
  const result = new Set<string>();
  for (const roleName of roleNames) {
    const role = ROLE_BY_NAME.get(roleName as RoleName);
    if (!role) continue;
    for (const permission of role.permissions) result.add(permission);
  }
  return result;
}

/** Roles allowed to reach the platform without an administrator assignment. */
export const SELF_REGISTRABLE_ROLES: RoleName[] = ['FOREST_EXPLORER'];
