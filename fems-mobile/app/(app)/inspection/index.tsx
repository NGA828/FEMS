/**
 * Inspection register.
 *
 * The list is server-filtered (status, type, outcome, forest, `mine`), and the
 * counters come from `GET /inspections/statistics` — including the open cases by
 * severity, which is what a regulator actually needs to see before closing a
 * visit. Creating an inspection is a permission the API enforces; the button is
 * only drawn when the account holds it.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInspectionStatistics, useInspections } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Row,
  SearchBar,
  Section,
  SegmentedControl,
  SkeletonList,
  StatTile,
  StatusPill,
  Tiny,
  Title,
} from '../../../src/ui';
import { formatDate, formatRelative, inspectionOutcomeLabel, inspectionStatusLabel, inspectionTypeLabel, severityLabel } from '../../../src/lib/format';

const STATUS_FILTERS = ['SCHEDULED', 'IN_PROGRESS', 'SUBMITTED', 'REVIEWED', 'CLOSED'] as const;
const TYPE_FILTERS = ['ROUTINE', 'COMPLIANCE', 'ENVIRONMENTAL', 'POST_ACTIVITY', 'INCIDENT', 'VERIFICATION'] as const;

export default function InspectionRegisterScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, hasPermission } = useAuth();
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [status, setStatus] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = useMemo(
    () => ({
      mine: scope === 'mine' ? ('true' as const) : undefined,
      status: status ?? undefined,
      type: type ?? undefined,
      search: search.trim() || undefined,
      page,
      limit: 15,
    }),
    [scope, status, type, search, page],
  );

  const inspections = useInspections(query);
  const statistics = useInspectionStatistics();
  const items = inspections.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
        refreshControl={
          <RefreshControl
            refreshing={inspections.isRefetching}
            onRefresh={() => {
              void inspections.refetch();
              void statistics.refetch();
            }}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        ListHeaderComponent={
          <View>
            <Row justify="space-between" align="flex-start" style={{ marginBottom: 14 }}>
              <View style={{ flex: 1 }}>
                <Title>Inspections</Title>
                <Caption tone="muted">Field visits, checklists, compliance scores and evidence</Caption>
              </View>
              {hasPermission('inspections:create') ? (
                <Button label="Schedule" icon="add" size="sm" onPress={() => router.push('/inspection/new')} />
              ) : null}
            </Row>

            {statistics.data ? (
              <Row gap={10} wrap style={{ marginBottom: 14 }}>
                <StatTile label="Total" value={statistics.data.total} icon="clipboard-outline" />
                <StatTile
                  label="Average compliance"
                  value={`${Math.round(statistics.data.averageComplianceScore)}%`}
                  icon="speedometer-outline"
                  tone={statistics.data.averageComplianceScore >= 75 ? 'success' : 'warning'}
                />
                <StatTile
                  label="Open cases"
                  value={statistics.data.openViolationsBySeverity.reduce((total, entry) => total + entry.count, 0)}
                  hint={statistics.data.openViolationsBySeverity.map((entry) => `${entry.count} ${severityLabel(entry.severity, language)}`).join(' · ')}
                  icon="alert-circle-outline"
                  tone="danger"
                />
              </Row>
            ) : null}

            <View style={{ marginBottom: 12 }}>
              <SegmentedControl
                value={scope}
                onChange={(next) => {
                  setScope(next);
                  setPage(1);
                }}
                options={[
                  { value: 'mine', label: 'Assigned to me' },
                  { value: 'all', label: 'All in my scope' },
                ]}
              />
            </View>

            <SearchBar value={search} onChangeText={setSearch} placeholder="Search reference, title or forest" onSubmit={() => setPage(1)} />

            <Row gap={8} wrap style={{ marginTop: 12 }}>
              <Chip label="Any status" selected={!status} onPress={() => setStatus(null)} />
              {STATUS_FILTERS.map((entry) => (
                <Chip key={entry} label={inspectionStatusLabel(entry, language)} selected={status === entry} onPress={() => setStatus(entry)} />
              ))}
            </Row>
            <Row gap={8} wrap style={{ marginTop: 8, marginBottom: 12 }}>
              <Chip label="Any type" selected={!type} onPress={() => setType(null)} />
              {TYPE_FILTERS.map((entry) => (
                <Chip key={entry} label={inspectionTypeLabel(entry, language)} selected={type === entry} onPress={() => setType(entry)} />
              ))}
            </Row>

            {inspections.data?.meta ? (
              <Caption tone="muted" style={{ marginBottom: 8 }}>
                {inspections.data.meta.total ?? items.length} inspection(s)
                {inspections.data.meta.totalPages && inspections.data.meta.totalPages > 1
                  ? ` · page ${inspections.data.meta.page ?? page} of ${inspections.data.meta.totalPages}`
                  : ''}
              </Caption>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          inspections.isLoading ? (
            <SkeletonList rows={4} />
          ) : inspections.isError ? (
            <ErrorState error={inspections.error} onRetry={() => inspections.refetch()} />
          ) : (
            <EmptyState
              icon="clipboard-outline"
              title={scope === 'mine' ? 'Nothing assigned to you' : 'No inspection in scope'}
              description={
                scope === 'mine'
                  ? 'Inspections assigned to your account appear here. Switch to “All in my scope” to see the register.'
                  : 'No inspection matches the filters. Clear them to see the full register.'
              }
              actionLabel={scope === 'mine' ? 'Show the register' : 'Clear filters'}
              onAction={() => {
                if (scope === 'mine') setScope('all');
                else {
                  setStatus(null);
                  setType(null);
                  setSearch('');
                }
              }}
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/inspection/[id]', params: { id: item.id } })}
            accessibilityRole="button"
            accessibilityLabel={`Inspection ${item.reference}`}
            style={({ pressed }) => ({ marginBottom: 12, opacity: pressed ? 0.85 : 1 })}
          >
            <Card>
              <Row justify="space-between" style={{ marginBottom: 6 }}>
                <Row gap={6} style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '700' }}>{item.reference}</Body>
                  {item.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
                </Row>
                <StatusPill status={item.status} label={inspectionStatusLabel(item.status, language)} />
              </Row>

              <Body lines={2} style={{ marginBottom: 8 }}>
                {item.title}
              </Body>

              <Row gap={10} wrap style={{ marginBottom: 8 }}>
                <Tiny tone="faint">{inspectionTypeLabel(item.type, language)}</Tiny>
                {item.forest ? <Tiny tone="faint">· {item.forest.name}</Tiny> : null}
                {item.company ? <Tiny tone="faint">· {item.company.name}</Tiny> : null}
              </Row>

              <Row justify="space-between">
                <Tiny tone="muted">
                  {item.inspector ? `${item.inspector.firstName} ${item.inspector.lastName}` : 'unassigned'} ·{' '}
                  {item.scheduledFor ? formatRelative(item.scheduledFor, language) : formatDate(item.createdAt ?? null, language)}
                </Tiny>
                {item.complianceScore !== null && item.complianceScore !== undefined ? (
                  <Badge
                    label={`${Math.round(item.complianceScore)}% · ${inspectionOutcomeLabel(item.outcome, language)}`}
                    tone={item.complianceScore >= 90 ? 'success' : item.complianceScore >= 75 ? 'primary' : item.complianceScore >= 55 ? 'warning' : 'danger'}
                  />
                ) : null}
              </Row>

              {item._count ? (
                <Row gap={12} style={{ marginTop: 8 }}>
                  <Tiny tone="faint">{item._count.evidences ?? 0} evidence</Tiny>
                  <Tiny tone="faint">{item._count.observations ?? 0} observations</Tiny>
                  {(item._count.violations ?? 0) > 0 ? <Tiny style={{ color: theme.colors.danger }}>{item._count.violations} cases opened</Tiny> : null}
                </Row>
              ) : null}
            </Card>
          </Pressable>
        )}
        ListFooterComponent={
          items.length > 0 && inspections.data?.meta?.hasNextPage ? (
            <Section>
              <Button label="Load more" variant="secondary" icon="chevron-down" onPress={() => setPage((current) => current + 1)} />
            </Section>
          ) : (
            <Section>
              <Card>
                <Row gap={10}>
                  <Ionicons name="information-circle-outline" size={18} color={theme.colors.info} />
                  <Caption tone="muted" style={{ flex: 1 }}>
                    An inspection must be started on site before it can be submitted: the API records the device position, the accuracy and the distance from
                    the target, and refuses a close while cases opened by the visit are still open.
                  </Caption>
                </Row>
              </Card>
            </Section>
          )
        }
      />
    </View>
  );
}
