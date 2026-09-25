/**
 * Exploitation activity register.
 *
 * Server-filtered by status, type, permit, forest and period. Each row shows the
 * declared plan against what was actually harvested and where the position came
 * from (device GPS vs. recorded), which is what an inspector checks against the
 * register during a visit.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActivities, useActivityStatistics } from '../../../src/api/queries';
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
  MonthBars,
  Row,
  SearchBar,
  Section,
  SkeletonList,
  StatTile,
  StatusPill,
  Tiny,
  Title,
} from '../../../src/ui';
import { activityStatusLabel, activityTypeLabel, formatDate, formatVolume } from '../../../src/lib/format';

const STATUS_FILTERS = ['PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'SUSPENDED', 'CANCELLED'] as const;
const TYPE_FILTERS = ['TIMBER_HARVEST', 'LOG_TRANSPORT', 'FOREST_SURVEY', 'ROAD_CONSTRUCTION', 'PLANTING', 'SALVAGE_LOGGING'] as const;

export default function ActivityRegisterScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, hasPermission } = useAuth();
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  const [status, setStatus] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = useMemo(
    () => ({ status: status ?? undefined, activityType: type ?? undefined, search: search.trim() || undefined, page, limit: 15 }),
    [status, type, search, page],
  );

  const activities = useActivities(query);
  const statistics = useActivityStatistics({ months: 12 });
  const items = activities.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
        refreshControl={
          <RefreshControl
            refreshing={activities.isRefetching}
            onRefresh={() => {
              void activities.refetch();
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
                <Title>Exploitation activities</Title>
                <Caption tone="muted">
                  {user?.company ? `${user.company.name} operations` : 'Declared work, harvested volumes and field positions'}
                </Caption>
              </View>
              {hasPermission('exploitation:create') ? (
                <Button label="Capture" icon="add" size="sm" onPress={() => router.push('/activity/capture')} />
              ) : null}
            </Row>

            {statistics.data ? (
              <Row gap={10} wrap style={{ marginBottom: 14 }}>
                <StatTile label="Activities" value={statistics.data.total} icon="cube-outline" />
                <StatTile
                  label="Planned volume"
                  value={formatVolume(statistics.data.plannedVolumeM3, language)}
                  icon="analytics-outline"
                />
                <StatTile
                  label="Harvested"
                  value={formatVolume(statistics.data.harvestedVolumeM3, language)}
                  hint={`${statistics.data.harvestedTrees} trees recorded`}
                  icon="leaf-outline"
                  tone={statistics.data.harvestedVolumeM3 > statistics.data.plannedVolumeM3 ? 'danger' : 'success'}
                />
              </Row>
            ) : null}

            {statistics.data?.monthly?.length ? (
              <Card style={{ marginBottom: 16 }}>
                <Caption tone="muted" style={{ marginBottom: 8 }}>
                  Harvested volume by month (m³)
                </Caption>
                <MonthBars data={statistics.data.monthly.map((entry: { month: string; volumeM3: number }) => ({ month: entry.month, value: entry.volumeM3 }))} />
              </Card>
            ) : null}

            <SearchBar value={search} onChangeText={setSearch} placeholder="Search reference, permit or forest" onSubmit={() => setPage(1)} />
            <Row gap={8} wrap style={{ marginTop: 12 }}>
              <Chip label="Any status" selected={!status} onPress={() => setStatus(null)} />
              {STATUS_FILTERS.map((entry) => (
                <Chip key={entry} label={activityStatusLabel(entry, language)} selected={status === entry} onPress={() => setStatus(entry)} />
              ))}
            </Row>
            <Row gap={8} wrap style={{ marginTop: 8, marginBottom: 12 }}>
              <Chip label="Any type" selected={!type} onPress={() => setType(null)} />
              {TYPE_FILTERS.map((entry) => (
                <Chip key={entry} label={activityTypeLabel(entry, language)} selected={type === entry} onPress={() => setType(entry)} />
              ))}
            </Row>
          </View>
        }
        ListEmptyComponent={
          activities.isLoading ? (
            <SkeletonList rows={4} />
          ) : activities.isError ? (
            <ErrorState error={activities.error} onRetry={() => activities.refetch()} />
          ) : (
            <EmptyState
              icon="cube-outline"
              title="No activity recorded"
              description="Exploitation is always declared against an active permit. Capture the first activity with the device GPS."
              actionLabel={hasPermission('exploitation:create') ? 'Capture an activity' : undefined}
              onAction={hasPermission('exploitation:create') ? () => router.push('/activity/capture') : undefined}
            />
          )
        }
        renderItem={({ item }) => {
          const planned = Number(item.plannedVolumeM3);
          const harvested = Number(item.harvestedVolumeM3 ?? 0);
          const ratio = planned > 0 ? harvested / planned : 0;
          return (
            <Pressable
              onPress={() => router.push({ pathname: '/activity/[id]', params: { id: item.id } })}
              accessibilityRole="button"
              accessibilityLabel={`Activity ${item.reference}`}
              style={({ pressed }) => ({ marginBottom: 12, opacity: pressed ? 0.85 : 1 })}
            >
              <Card>
                <Row justify="space-between" style={{ marginBottom: 6 }}>
                  <Row gap={6} style={{ flex: 1 }}>
                    <Body style={{ fontWeight: '700' }}>{item.reference}</Body>
                    {item.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
                  </Row>
                  <StatusPill status={item.status} label={activityStatusLabel(item.status, language)} />
                </Row>
                <Caption tone="muted" style={{ marginBottom: 8 }}>
                  {activityTypeLabel(item.activityType, language)} · {item.permit?.permitNumber} · {item.forest?.name}
                </Caption>
                <Row justify="space-between" style={{ marginBottom: 4 }}>
                  <Tiny tone="muted">
                    {formatVolume(harvested, language)} of {formatVolume(planned, language)}
                  </Tiny>
                  <Tiny style={{ color: ratio > 1.05 ? theme.colors.danger : theme.colors.textMuted }}>{Math.round(ratio * 100)}%</Tiny>
                </Row>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceAlt, overflow: 'hidden' }}>
                  <View
                    style={{
                      width: `${Math.min(100, ratio * 100)}%`,
                      height: 6,
                      backgroundColor: ratio > 1.05 ? theme.colors.danger : theme.colors.primary,
                    }}
                  />
                </View>
                <Row gap={10} style={{ marginTop: 8 }} wrap>
                  <Tiny tone="faint">{item.gpsSource === 'DEVICE_GPS' ? 'device GPS' : (item.gpsSource ?? 'no GPS')}</Tiny>
                  <Tiny tone="faint">· {formatDate(item.plannedStartDate, language)}</Tiny>
                  {item.assignedTo ? <Tiny tone="faint">· {item.assignedTo.firstName} {item.assignedTo.lastName}</Tiny> : null}
                  {item.syncStatus && item.syncStatus !== 'SYNCED' ? <Badge label={item.syncStatus} tone="warning" compact /> : null}
                </Row>
              </Card>
            </Pressable>
          );
        }}
        ListFooterComponent={
          items.length > 0 && activities.data?.meta?.hasNextPage ? (
            <Section>
              <Button label="Load more" variant="secondary" icon="chevron-down" onPress={() => setPage((current) => current + 1)} />
            </Section>
          ) : (
            <Section>
              <Card>
                <Row gap={10}>
                  <Ionicons name="information-circle-outline" size={18} color={theme.colors.info} />
                  <Caption tone="muted" style={{ flex: 1 }}>
                    The API refuses an activity against a permit that is not active, and the rule engine raises an alert when the harvested volume passes the
                    approved one.
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
