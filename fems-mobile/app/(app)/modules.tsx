/**
 * Module catalogue.
 *
 * One place that lists every screen the signed-in account can actually open,
 * grouped by domain. Entries are filtered by the account's permissions, so the
 * hub never offers a link that would answer 403 — and the screens behind it still
 * check again on the server.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { canRead } from '../../src/auth/permissions';
import { useAlerts } from '../../src/api/queries';
import { useTheme } from '../../src/theme/theme';
import { Badge, Body, Caption, Card, Overline, Row, Section, Title } from '../../src/ui';

interface ModuleEntry {
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  /** Any of these permissions unlocks the entry; empty means always visible. */
  permissions: string[];
  roles?: string[];
}

const MODULES: { group: string; entries: ModuleEntry[] }[] = [
  {
    group: 'Registers',
    entries: [
      {
        label: 'Forest register',
        description: 'Forests, zones, protected areas and the annual allowable cut',
        icon: 'leaf-outline',
        route: '/forests',
        permissions: [],
      },
      {
        label: 'Permits',
        description: 'Applications, decisions, documents and renewals',
        icon: 'document-text-outline',
        route: '/permits',
        permissions: ['permits:read', 'permits:read_own'],
      },
      {
        label: 'Companies',
        description: 'Company profiles, verification status and documents',
        icon: 'business-outline',
        route: '/company',
        permissions: ['companies:read', 'companies:read_own'],
      },
    ],
  },
  {
    group: 'Operations',
    entries: [
      {
        label: 'Exploitation activities',
        description: 'Planned and recorded field work with GPS positions',
        icon: 'cube-outline',
        route: '/activity',
        permissions: ['exploitation:read', 'exploitation:read_own'],
      },
      {
        label: 'Capture activity',
        description: 'Record harvest work with the device GPS',
        icon: 'walk-outline',
        route: '/activity/capture',
        permissions: ['exploitation:create'],
      },
      {
        label: 'Equipment',
        description: 'Machines, chainsaws and trucks with their utilisation',
        icon: 'construct-outline',
        route: '/equipment',
        permissions: ['equipment:read'],
      },
      {
        label: 'Field observations',
        description: 'Findings captured in the field, with evidence',
        icon: 'eye-outline',
        route: '/observation',
        permissions: ['observations:read'],
      },
      {
        label: 'Record observation',
        description: 'Capture a field finding with position and photos',
        icon: 'camera-outline',
        route: '/observation/new',
        permissions: ['observations:create'],
      },
    ],
  },
  {
    group: 'Compliance',
    entries: [
      {
        label: 'Inspections',
        description: 'Checklists, compliance scores, evidence and outcomes',
        icon: 'clipboard-outline',
        route: '/inspection',
        permissions: ['inspections:read', 'inspections:read_own'],
      },
      {
        label: 'Environmental cases',
        description: 'Violations, penalties, remediation and resolution',
        icon: 'alert-circle-outline',
        route: '/violation',
        permissions: ['environmental:read'],
      },
      {
        label: 'Payments',
        description: 'Fees, royalties and penalties with provider verification',
        icon: 'card-outline',
        route: '/payments',
        permissions: ['payments:read', 'payments:read_own'],
      },
    ],
  },
  {
    group: 'Intelligence',
    entries: [
      {
        label: 'AI alert console',
        description: 'Signals raised by the rule engine, awaiting human review',
        icon: 'warning-outline',
        route: '/alerts',
        permissions: ['ai:alerts_read'],
      },
      {
        label: 'Forest Intelligence',
        description: 'Run a risk or anomaly analysis over real records',
        icon: 'pulse-outline',
        route: '/analysis',
        permissions: ['ai:analysis_run'],
      },
      {
        label: 'Forest Assistant',
        description: 'Ask questions about the data you are entitled to read',
        icon: 'sparkles-outline',
        route: '/assistant',
        permissions: ['ai:assistant_use'],
      },
      {
        label: 'Reports',
        description: 'Regulatory datasets in JSON, CSV or PDF',
        icon: 'bar-chart-outline',
        route: '/report',
        permissions: ['reports:read', 'reports:read_own'],
      },
    ],
  },
  {
    group: 'Field tools',
    entries: [
      {
        label: 'Map',
        description: 'Forests, zones, activities, cases and alerts on one map',
        icon: 'map-outline',
        route: '/map',
        permissions: ['gis:read', 'gis:read_public'],
      },
      {
        label: 'Offline queue',
        description: 'Field records waiting to reach the server',
        icon: 'cloud-upload-outline',
        route: '/sync',
        permissions: [],
      },
      {
        label: 'Notifications',
        description: 'Decision, inspection and payment messages',
        icon: 'notifications-outline',
        route: '/notifications',
        permissions: [],
      },
    ],
  },
  {
    group: 'Administration',
    entries: [
      {
        label: 'Users',
        description: 'Accounts, roles, status and password resets',
        icon: 'people-outline',
        route: '/user',
        permissions: ['users:read'],
      },
      {
        label: 'Audit trail',
        description: 'Who did what, when, with which result',
        icon: 'list-outline',
        route: '/audit',
        permissions: ['audit:read'],
      },
      {
        label: 'Settings',
        description: 'Profile, notifications and app preferences',
        icon: 'settings-outline',
        route: '/settings',
        permissions: [],
      },
    ],
  },
];

export default function ModulesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { hasPermission, user } = useAuth();
  const alerts = useAlerts({ awaitingReview: 'true', limit: 1 });

  const canSee = (entry: ModuleEntry) =>
    entry.permissions.length === 0 || entry.permissions.some((permission) => hasPermission(permission));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }}
    >
      <Title style={{ marginBottom: 4 }}>All modules</Title>
      <Caption tone="muted" style={{ marginBottom: 18 }}>
        {user?.roles?.[0]?.label ?? 'Your role'} · every screen below is wired to the live FEMS API.
      </Caption>

      {MODULES.map((group) => {
        const entries = group.entries.filter(canSee);
        if (entries.length === 0) return null;
        return (
          <Section key={group.group} title={group.group}>
            {entries.map((entry) => (
              <Pressable
                key={entry.route}
                onPress={() => router.push(entry.route as never)}
                accessibilityRole="button"
                accessibilityLabel={entry.label}
                style={({ pressed }) => ({ marginBottom: 10, opacity: pressed ? 0.85 : 1 })}
              >
                <Card>
                  <Row gap={12}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: theme.radii.md,
                        backgroundColor: theme.colors.primarySoft,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name={entry.icon} size={19} color={theme.colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Row justify="space-between" gap={8}>
                        <Body style={{ fontWeight: '600' }}>{entry.label}</Body>
                        {entry.route === '/alerts' && (alerts.data?.meta?.total ?? 0) > 0 ? (
                          <Badge label={`${alerts.data?.meta?.total} waiting`} tone="warning" compact />
                        ) : null}
                      </Row>
                      <Caption tone="muted" lines={2}>
                        {entry.description}
                      </Caption>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textFaint} />
                  </Row>
                </Card>
              </Pressable>
            ))}
          </Section>
        );
      })}

      <Section title="About this build">
        <Card>
          <Overline style={{ marginBottom: 6 }}>Data</Overline>
          <Caption tone="muted">
            Everything shown in the app comes from the FEMS API and the MySQL database behind it. Seeded demonstration records are flagged
            <Body style={{ fontWeight: '600' }}> isDemo</Body> and carry DEMO- references; positions captured in the app come from the device GPS.
          </Caption>
        </Card>
      </Section>
      <View style={{ height: 12 }} />
    </ScrollView>
  );
}
