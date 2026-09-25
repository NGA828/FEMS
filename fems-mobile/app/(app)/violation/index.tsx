/**
 * Environmental case register.
 *
 * Cases are the regulatory record of what was actually established in the field —
 * they are never created by the AI engine on its own, only by an officer, from an
 * inspection or an observation. Penalties, remediation deadlines and payments are
 * read from the API, which computes them from the penalty records.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useViolationStatistics, useViolations } from '../../../src/api/queries';
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
  RiskPill,
  Row,
  SearchBar,
  Section,
  SkeletonList,
  StatTile,
  StatusPill,
  Tiny,
  Title,
} from '../../../src/ui';
import { formatCurrency, formatCurrencyCompact, formatDate, formatRelative, severityLabel, violationStatusLabel } from '../../../src/lib/format';

const STATUS_FILTERS = ['OPEN', 'UNDER_INVESTIGATION', 'CONFIRMED', 'ESCALATED', 'RESOLVED', 'DISMISSED'] as const;
const SEVERITY_FILTERS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

export default function ViolationRegisterScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, hasPermission } = useAuth();
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  const [status, setStatus] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = useMemo(
    () => ({
      status: status ?? undefined,
      severity: severity ?? undefined,
      overdueRemediation: overdueOnly ? ('true' as const) : undefined,
      page,
      limit: 15,
    }),
    [status, severity, overdueOnly, page],
  );

  const violations = useViolations(query);
  const statistics = useViolationStatistics();
  const items = violations.data?.items ?? [];
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((entry) =>
      `${entry.reference} ${entry.title} ${entry.description} ${entry.company?.name ?? ''} ${entry.forest?.name ?? ''}`.toLowerCase().includes(term),
    );
  }, [items, search]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
        refreshControl={
          <RefreshControl
            refreshing={violations.isRefetching}
            onRefresh={() => {
              void violations.refetch();
              void statistics.refetch();
            }}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        ListHeaderComponent={
          <View>
            <Title style={{ marginBottom: 4 }}>Environmental cases</Title>
            <Caption tone="muted" style={{ marginBottom: 14 }}>
              {user?.company ? `${user.company.name} — cases recorded against your operations` : 'Findings documented by inspections and field observations'}
            </Caption>

            {statistics.data ? (
              <>
                <Row gap={10} wrap style={{ marginBottom: 12 }}>
                  <StatTile label="Cases" value={statistics.data.total} icon="alert-circle-outline" />
                  <StatTile label="Open" value={statistics.data.openCases} icon="folder-open-outline" tone="warning" />
                  <StatTile label="Remediation overdue" value={statistics.data.overdueRemediation} icon="alarm-outline" tone="danger" />
                  <StatTile label="Estimated damage" value={formatCurrencyCompact(statistics.data.estimatedDamageXAF, language)} icon="trending-down-outline" />
                </Row>
                <Card style={{ marginBottom: 12 }}>
                  <Row justify="space-between" style={{ marginBottom: 8 }}>
                    <Caption tone="muted">Penalties</Caption>
                    <Badge label={statistics.data.penalties.settled ? 'all settled' : 'outstanding'} tone={statistics.data.penalties.settled ? 'success' : 'warning'} />
                  </Row>
                  <Row gap={10} wrap>
                    <Badge label={`assessed ${formatCurrencyCompact(statistics.data.penalties.penaltyAmountXAF, language)}`} tone="neutral" />
                    <Badge label={`paid ${formatCurrencyCompact(statistics.data.penalties.paidXAF, language)}`} tone="success" />
                    <Badge label={`outstanding ${formatCurrencyCompact(statistics.data.penalties.outstandingXAF, language)}`} tone="warning" />
                  </Row>
                  {statistics.data.monthly.length > 0 ? (
                    <View style={{ marginTop: 12 }}>
                      <Caption tone="muted" style={{ marginBottom: 6 }}>
                        Cases opened per month
                      </Caption>
                      <MonthBars data={statistics.data.monthly.map((entry) => ({ month: entry.month, value: entry.count }))} />
                    </View>
                  ) : null}
                </Card>
              </>
            ) : null}

            <SearchBar value={search} onChangeText={setSearch} placeholder="Search reference, title, company or forest" onSubmit={() => setPage(1)} />
            <Row gap={8} wrap style={{ marginTop: 12 }}>
              <Chip label="Any status" selected={!status} onPress={() => setStatus(null)} />
              {STATUS_FILTERS.map((entry) => (
                <Chip key={entry} label={violationStatusLabel(entry, language)} selected={status === entry} onPress={() => setStatus(entry)} />
              ))}
            </Row>
            <Row gap={8} wrap style={{ marginTop: 8, marginBottom: 12 }}>
              <Chip label="Any severity" selected={!severity} onPress={() => setSeverity(null)} />
              {SEVERITY_FILTERS.map((entry) => (
                <Chip key={entry} label={severityLabel(entry, language)} selected={severity === entry} onPress={() => setSeverity(entry)} />
              ))}
              <Chip label="Remediation overdue" selected={overdueOnly} onPress={() => setOverdueOnly((current) => !current)} />
            </Row>
          </View>
        }
        ListEmptyComponent={
          violations.isLoading ? (
            <SkeletonList rows={4} />
          ) : violations.isError ? (
            <ErrorState error={violations.error} onRetry={() => violations.refetch()} />
          ) : (
            <EmptyState
              icon="shield-checkmark-outline"
              title="No case recorded"
              description="A case is opened from documented facts: raise it from an inspection or from a field observation, never from a hunch."
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/violation/[id]', params: { id: item.id } })}
            accessibilityRole="button"
            accessibilityLabel={`Case ${item.reference}, ${severityLabel(item.severity, language)}`}
            style={({ pressed }) => ({ marginBottom: 12, opacity: pressed ? 0.86 : 1 })}
          >
            <Card>
              <Row justify="space-between" style={{ marginBottom: 6 }}>
                <Row gap={6} style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '700' }}>{item.title}</Body>
                  {item.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
                </Row>
                <StatusPill status={item.status} label={violationStatusLabel(item.status, language)} />
              </Row>
              <Row gap={8} wrap style={{ marginBottom: 8 }}>
                <RiskPill level={item.severity} label={severityLabel(item.severity, language)} />
                {item.penalty && item.penalty.penaltyAmountXAF > 0 ? (
                  <Badge label={`penalty ${formatCurrencyCompact(item.penalty.penaltyAmountXAF, language)}`} tone={item.penalty.settled ? 'success' : 'warning'} />
                ) : null}
                {item.remediationOverdue ? <Badge label="remediation overdue" tone="danger" icon="alarm-outline" compact /> : null}
              </Row>
              <Caption tone="muted" style={{ marginBottom: 8 }} lines={2}>
                {item.description}
              </Caption>
              <Row gap={10} wrap>
                <Tiny tone="faint">{item.reference}</Tiny>
                {item.forest ? <Tiny tone="faint">· {item.forest.name}</Tiny> : null}
                {item.company ? <Tiny tone="faint">· {item.company.name}</Tiny> : null}
              </Row>
              <Row justify="space-between" style={{ marginTop: 8 }}>
                <Tiny tone="faint">detected {formatRelative(item.detectedAt, language)}</Tiny>
                {item.remediationDeadline ? <Tiny tone="faint">remediation by {formatDate(item.remediationDeadline, language)}</Tiny> : null}
              </Row>
            </Card>
          </Pressable>
        )}
        ListFooterComponent={
          items.length > 0 && violations.data?.meta?.hasNextPage ? (
            <Section>
              <Button label="Load more" variant="secondary" icon="chevron-down" onPress={() => setPage((current) => current + 1)} />
            </Section>
          ) : hasPermission('environmental:create') ? (
            <Section>
              <Card>
                <Row gap={10}>
                  <Ionicons name="information-circle-outline" size={18} color={theme.colors.info} />
                  <Caption tone="muted" style={{ flex: 1 }}>
                    Cases are raised from an inspection or an observation so that every case carries the field evidence behind it. Open an inspection or an
                    observation and use “Open a case” there.
                  </Caption>
                </Row>
              </Card>
            </Section>
          ) : null
        }
      />
    </View>
  );
}
