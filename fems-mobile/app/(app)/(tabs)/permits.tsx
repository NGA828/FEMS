/**
 * Permit register.
 *
 * Lists the permits the account may read (every company for a regulator, its own
 * for a company account), with a server-side status filter, search and paging.
 * Each row opens the permit detail where the state machine actions live — the
 * transitions offered there come from `GET /permits/:id/actions`, so the app can
 * never invent one the backend would refuse.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePermits, usePermitStatistics } from '../../../src/api/queries';
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
  SkeletonList,
  StatTile,
  StatusPill,
  Tiny,
  Title,
} from '../../../src/ui';
import { daysUntil, formatCurrencyCompact, formatDate, formatVolume, permitStatusLabel, permitTypeLabel } from '../../../src/lib/format';

const STATUS_FILTERS: { value: string | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'PAYMENT_PENDING', label: 'Payment pending' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'EXPIRED', label: 'Expired' },
];

export default function PermitsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string }>();
  const { user, hasPermission, permissions } = useAuth();

  const [status, setStatus] = useState<string | null>(params.status ?? null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const canCreatePermit = hasPermission('permits:create');
  const scopedToCompany = Boolean(user?.company?.id) && !permissions.includes('*');

  const query = useMemo(
    () => ({ status: status ?? undefined, search: search.trim() || undefined, page, limit: 15 }),
    [status, search, page],
  );

  const permits = usePermits(query);
  const statistics = usePermitStatistics();

  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';
  const items = permits.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: theme.tabBarHeight + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={permits.isRefetching}
            onRefresh={() => {
              void permits.refetch();
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
                <Title>Permits</Title>
                <Caption tone="muted">
                  {scopedToCompany
                    ? `Applications and permits held by ${user?.company?.name}`
                    : 'Applications, decisions and valid exploitation rights'}
                </Caption>
              </View>
              {canCreatePermit ? (
                <Button label="New" icon="add" size="sm" onPress={() => router.push('/permit/new')} />
              ) : null}
            </Row>

            {statistics.data ? (
              <Row gap={10} wrap style={{ marginBottom: 16 }}>
                <StatTile label="Total" value={statistics.data.total} icon="document-text-outline" />
                <StatTile
                  label="Approved volume"
                  value={formatVolume(statistics.data.totalVolumeApprovedM3, language)}
                  icon="cube-outline"
                  tone="accent"
                />
                <StatTile
                  label="Fees invoiced"
                  value={formatCurrencyCompact(statistics.data.totalFeeAmount, 'XAF', language)}
                  icon="cash-outline"
                  tone="success"
                />
                {!scopedToCompany ? (
                  <StatTile
                    label="Awaiting decision"
                    value={
                      (statistics.data.byStatus.find((entry) => entry.status === 'SUBMITTED')?.count ?? 0) +
                      (statistics.data.byStatus.find((entry) => entry.status === 'UNDER_REVIEW')?.count ?? 0)
                    }
                    icon="hourglass-outline"
                    tone="warning"
                  />
                ) : null}
              </Row>
            ) : null}

            <SearchBar value={search} onChangeText={setSearch} placeholder="Search permit number, title or company" onSubmit={() => setPage(1)} />
            <Row gap={8} wrap style={{ marginVertical: 12 }}>
              {STATUS_FILTERS.map((filter) => (
                <Chip
                  key={filter.label}
                  label={filter.label}
                  selected={status === filter.value}
                  onPress={() => {
                    setStatus(filter.value);
                    setPage(1);
                  }}
                />
              ))}
            </Row>

            {permits.data?.meta ? (
              <Caption tone="muted" style={{ marginBottom: 8 }}>
                {permits.data.meta.total ?? items.length} permit(s)
                {permits.data.meta.totalPages && permits.data.meta.totalPages > 1
                  ? ` · page ${permits.data.meta.page ?? page} of ${permits.data.meta.totalPages}`
                  : ''}
              </Caption>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          permits.isLoading ? (
            <SkeletonList rows={4} />
          ) : permits.isError ? (
            <ErrorState error={permits.error} onRetry={() => permits.refetch()} />
          ) : (
            <EmptyState
              icon="document-text-outline"
              title={status ? 'No permit in this state' : 'No permit yet'}
              description={
                status
                  ? 'No permit matches the selected status and search.'
                  : scopedToCompany
                    ? 'Your company has no permit on record. Create an application to start the process.'
                    : 'No permit has been filed yet.'
              }
              actionLabel={status ? 'Clear filters' : canCreatePermit ? 'Create an application' : undefined}
              onAction={
                status
                  ? () => {
                      setStatus(null);
                      setSearch('');
                    }
                  : canCreatePermit
                    ? () => router.push('/permit/new')
                    : undefined
              }
            />
          )
        }
        renderItem={({ item }) => {
          const days = daysUntil(item.endDate);
          const outstanding = item.status === 'PAYMENT_PENDING';
          return (
            <Pressable
              onPress={() => router.push({ pathname: '/permit/[id]', params: { id: item.id } })}
              accessibilityRole="button"
              accessibilityLabel={`Permit ${item.permitNumber}, status ${permitStatusLabel(item.status, language)}`}
              style={({ pressed }) => ({ marginBottom: 12, opacity: pressed ? 0.85 : 1 })}
            >
              <Card>
                <Row justify="space-between" style={{ marginBottom: 6 }}>
                  <Row gap={6} style={{ flex: 1 }}>
                    <Body style={{ fontWeight: '700' }}>{item.permitNumber}</Body>
                    {item.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
                  </Row>
                  <StatusPill status={item.status} label={permitStatusLabel(item.status, language)} />
                </Row>

                <Body lines={2} style={{ marginBottom: 8 }}>
                  {item.title}
                </Body>

                <Row gap={10} wrap style={{ marginBottom: 8 }}>
                  <Row gap={4}>
                    <Ionicons name="pricetag-outline" size={12} color={theme.colors.textFaint} />
                    <Tiny tone="faint">{permitTypeLabel(item.type, language)}</Tiny>
                  </Row>
                  <Row gap={4}>
                    <Ionicons name="business-outline" size={12} color={theme.colors.textFaint} />
                    <Tiny tone="faint" lines={1}>
                      {item.company?.name}
                    </Tiny>
                  </Row>
                  <Row gap={4}>
                    <Ionicons name="leaf-outline" size={12} color={theme.colors.textFaint} />
                    <Tiny tone="faint" lines={1}>
                      {item.forest?.name}
                    </Tiny>
                  </Row>
                </Row>

                <Row justify="space-between">
                  <Tiny tone="muted">
                    {formatVolume(item.volumeApprovedM3 ?? item.volumeRequestedM3, language)} · {formatDate(item.startDate, language)} →{' '}
                    {formatDate(item.endDate, language)}
                  </Tiny>
                  {days !== null && days >= 0 && days <= 90 ? (
                    <Badge label={`${days} d left`} tone={days <= 30 ? 'danger' : 'warning'} compact />
                  ) : outstanding ? (
                    <Badge label="fee due" tone="warning" compact />
                  ) : null}
                </Row>

                {item._count ? (
                  <Row gap={12} style={{ marginTop: 8 }}>
                    <Tiny tone="faint">{item._count.activities ?? 0} activities</Tiny>
                    <Tiny tone="faint">{item._count.payments ?? 0} payments</Tiny>
                    <Tiny tone="faint">{item._count.inspections ?? 0} inspections</Tiny>
                    {(item._count.violations ?? 0) > 0 ? <Tiny style={{ color: theme.colors.danger }}>{item._count.violations} cases</Tiny> : null}
                  </Row>
                ) : null}
              </Card>
            </Pressable>
          );
        }}
        ListFooterComponent={
          items.length > 0 && permits.data?.meta?.hasNextPage ? (
            <View style={{ marginTop: 8 }}>
              <Section>
                <Button label="Load more" variant="secondary" icon="chevron-down" onPress={() => setPage((current) => current + 1)} />
              </Section>
            </View>
          ) : (
            <Section>
              <Card>
                <Row gap={10}>
                  <Ionicons name="information-circle-outline" size={18} color={theme.colors.info} />
                  <Caption tone="muted" style={{ flex: 1 }}>
                    A permit only becomes operational when it is approved, the fee is settled and the validity window is open. Exploitation against any
                    other state is refused by the API.
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
