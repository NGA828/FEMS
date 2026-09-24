/**
 * Role-aware navigation.
 *
 * Each of the eight roles gets a distinct working set of tabs — a field operator
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
  SUPER_ADMIN: ['dashboard', 'permits', 'alerts', 'map', 'profile'],
  ADMIN: ['dashboard', 'permits', 'alerts', 'map', 'profile'],
  GOVERNMENT_FOREST_OFFICER: ['dashboard', 'permits', 'field', 'alerts', 'profile'],
  ENVIRONMENTAL_OFFICER: ['dashboard', 'map', 'field', 'alerts', 'profile'],
  FOREST_INSPECTOR: ['dashboard', 'field', 'map', 'alerts', 'profile'],
  FIELD_OPERATOR: ['dashboard', 'field', 'map', 'sync', 'profile'],
  COMPANY_REPRESENTATIVE: ['dashboard', 'permits', 'field', 'payments', 'profile'],
  FOREST_EXPLORER: ['dashboard', 'forests', 'assistant', 'map', 'profile'],
  VISITOR: ['dashboard', 'forests', 'assistant', 'profile'],
};

export function tabsFor(user: AuthUser | null): TabDefinition[] {
  const role = (user?.roles?.[0]?.name ?? 'VISITOR') as RoleName;
  const tabs = ROLE_TABS[role] ?? ROLE_TABS.VISITOR;
  return tabs.map((name) => TAB_DEFINITIONS[name]);
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
  const role = (user?.roles?.[0]?.name ?? 'VISITOR') as RoleName;
  const isAdministrator = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const isCompanyAccount = Boolean(user?.company?.id) && !isAdministrator;

  return {
    role,
    isAdministrator,
    isRegulator: isAdministrator || role === 'GOVERNMENT_FOREST_OFFICER' || role === 'ENVIRONMENTAL_OFFICER',
    isFieldWorker: role === 'FOREST_INSPECTOR' || role === 'FIELD_OPERATOR' || role === 'ENVIRONMENTAL_OFFICER',
    isCompanyAccount,
    isPublicAccount: role === 'VISITOR' || role === 'FOREST_EXPLORER',
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
