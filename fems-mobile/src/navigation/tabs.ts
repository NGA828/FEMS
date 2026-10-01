/**
 * Role-aware navigation.
 *
 * Each role gets a distinct working set of tabs — a field operator
 * does not need a permit register, and an explorer has no business with the
 * compliance console. Hiding a tab is a usability decision only: every screen
 * behind it calls an endpoint whose guards run on the server, so a hand-typed
 * route still resolves to a 403 for a role that is not entitled to it.
 */
import type { Ionicons } from '@expo/vector-icons';
import type { AuthUser, RoleName } from '../api/types';

export type TabName =
  | 'dashboard'
  | 'map'
  | 'permits'
  | 'field'
  | 'alerts'
  | 'payments'
  | 'forests'
  | 'assistant'
  | 'sync'
  | 'profile';

export interface TabDefinition {
  name: TabName;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
}

export const TAB_DEFINITIONS: Record<TabName, TabDefinition> = {
  dashboard: { name: 'dashboard', title: 'Home', icon: 'grid-outline', href: '/dashboard' },
  map: { name: 'map', title: 'Map', icon: 'map-outline', href: '/map' },
  permits: { name: 'permits', title: 'Permits', icon: 'document-text-outline', href: '/permits' },
  field: { name: 'field', title: 'Field', icon: 'walk-outline', href: '/field' },
  alerts: { name: 'alerts', title: 'Alerts', icon: 'warning-outline', href: '/alerts' },
  payments: { name: 'payments', title: 'Payments', icon: 'card-outline', href: '/payments' },
  forests: { name: 'forests', title: 'Forests', icon: 'leaf-outline', href: '/forests' },
  assistant: { name: 'assistant', title: 'Assistant', icon: 'sparkles-outline', href: '/assistant' },
  sync: { name: 'sync', title: 'Sync', icon: 'cloud-upload-outline', href: '/sync' },
  profile: { name: 'profile', title: 'Profile', icon: 'person-circle-outline', href: '/profile' },
};

const ROLE_TABS: Record<RoleName, TabName[]> = {
  ADMINISTRATOR: ['dashboard', 'permits', 'alerts', 'map', 'profile'],
  GOVERNMENT_FOREST_OFFICER: ['dashboard', 'permits', 'field', 'alerts', 'profile'],
  ENVIRONMENTAL_OFFICER: ['dashboard', 'map', 'field', 'alerts', 'profile'],
  FOREST_INSPECTOR: ['dashboard', 'field', 'map', 'alerts', 'profile'],
  FIELD_OPERATOR: ['dashboard', 'field', 'map', 'sync', 'profile'],
  COMPANY_REPRESENTATIVE: ['dashboard', 'permits', 'field', 'payments', 'profile'],
  FOREST_EXPLORER: ['dashboard', 'forests', 'assistant', 'map', 'profile'],
};

/**
 * The account's governing role: the highest `level` the server granted, not
 * simply the first element. An administrator who also holds an inspector role
 * must still get the administrator navigation.
 */
export function primaryRoleSummary(user: AuthUser | null) {
  const roles = user?.roles ?? [];
  if (roles.length === 0) return null;
  return [...roles].sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0] ?? null;
}

export function primaryRoleName(user: AuthUser | null): RoleName {
  const roles = user?.roles ?? [];
  if (roles.length === 0) return 'FOREST_EXPLORER';
  const ranked = [...roles].sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
  const known = ranked.find((role) => role.name in ROLE_TABS);
  return (known?.name ?? ranked[0]?.name ?? 'FOREST_EXPLORER') as RoleName;
}

export function tabsFor(user: AuthUser | null): TabDefinition[] {
  const role = primaryRoleName(user);
  // A role the app does not know must never silently collapse to the narrowest
  // experience: fall back to the permissions the server actually granted.
  const tabs = ROLE_TABS[role] ?? tabsFromPermissions(user?.permissions ?? []);
  return tabs.map((name) => TAB_DEFINITIONS[name]);
}

function tabsFromPermissions(permissions: string[]): TabName[] {
  const can = (permission: string) => permissions.includes('*') || permissions.includes(permission);
  const tabs: TabName[] = ['dashboard'];
  if (can('permits:read') || can('permits:read_own')) tabs.push('permits');
  if (can('inspections:read') || can('inspections:read_own') || can('exploitation:read_own')) tabs.push('field');
  if (can('ai:alerts_read')) tabs.push('alerts');
  if (can('payments:read') || can('payments:read_own')) tabs.push('payments');
  if (tabs.length < 5) tabs.push('map');
  tabs.push('profile');
  return Array.from(new Set(tabs)).slice(0, 5) as TabName[];
}

/** Presentation-level view of the signed-in account, derived from roles + company. */
export interface RoleContext {
  role: RoleName;
  /** Reviews permits, cases and alerts (government, environment, admin). */
  isRegulator: boolean;
  isAdministrator: boolean;
  /** Works in the field: inspectors and operators. */
  isFieldWorker: boolean;
  /** Belongs to a company and is pinned to its own records. */
  isCompanyAccount: boolean;
  /** May browse public forest data. */
  isPublicAccount: boolean;
  /** May file a permit application. */
  canApplyForPermit: boolean;
  /** May decide on permits. */
  canDecidePermit: boolean;
  /** May act on environmental cases. */
  canHandleViolations: boolean;
  /** May review AI alerts. */
  canReviewAlerts: boolean;
  /** May run an AI analysis. */
  canRunAnalysis: boolean;
  /** May record field data with the device GPS. */
  canCaptureField: boolean;
  /** May verify payments with the provider. */
  canVerifyPayments: boolean;
  /** May generate regulatory reports. */
  canGenerateReports: boolean;
}

export function roleContext(user: AuthUser | null, hasPermission: (permission: string) => boolean): RoleContext {
  const role = primaryRoleName(user);
  // The wildcard grant is the server's own definition of an administrator, so
  // it is authoritative even if the role vocabulary ever changes again.
  const isAdministrator = role === 'ADMINISTRATOR' || hasPermission('*');
  const isCompanyAccount = Boolean(user?.company?.id) && !isAdministrator;

  return {
    role,
    isAdministrator,
    isRegulator: isAdministrator || role === 'GOVERNMENT_FOREST_OFFICER' || role === 'ENVIRONMENTAL_OFFICER',
    isFieldWorker: role === 'FOREST_INSPECTOR' || role === 'FIELD_OPERATOR' || role === 'ENVIRONMENTAL_OFFICER',
    isCompanyAccount,
    isPublicAccount: role === 'FOREST_EXPLORER',
    canApplyForPermit: hasPermission('permits:create') || hasPermission('permits:manage_own'),
    canDecidePermit: hasPermission('permits:approve') || hasPermission('permits:reject') || isAdministrator,
    canHandleViolations: hasPermission('environmental:update') || hasPermission('environmental:confirm'),
    canReviewAlerts: hasPermission('ai:alerts_review'),
    canRunAnalysis: hasPermission('ai:analysis_run'),
    canCaptureField:
      hasPermission('exploitation:create') || hasPermission('inspections:create') || hasPermission('inspections:execute'),
    canVerifyPayments: hasPermission('payments:verify'),
    canGenerateReports: hasPermission('reports:create'),
  };
}
