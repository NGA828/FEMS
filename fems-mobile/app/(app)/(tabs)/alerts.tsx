/**
 * AI alert console — "Mission Control".
 *
 * Alerts are produced by the deterministic rule engine (and, when Gemini is
 * configured, enriched by it). None of them accuses anyone: the console shows the
 * detector, the evidence, the confidence and the human-review state, and every
 * decision is taken here by an officer with `ai:alerts_review`.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AlertType } from '../../../src/api/types';
import { useAiStatus, useAlertStatistics, useAlerts } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { roleContext } from '../../../src/navigation/tabs';
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
  Notice,
  Overline,
  RiskPill,
  Row,
  SearchBar,
  Section,
  SegmentedControl,
  SkeletonList,
  StatTile,
  StatusPill,
  Tiny,
  Title,
  ToneScope,
} from '../../../src/ui';
import { alertStatusLabel, alertTypeLabel, formatDateTime, formatPercent, formatRelative, riskLabel } from '../../../src/lib/format';

const TYPE_FILTERS: AlertType[] = [
  'OVER_HARVESTING',
  'PERMIT_VIOLATION',
  'UNAUTHORIZED_ACTIVITY',
  'OPERATIONAL_ANOMALY',
  'PROTECTED_AREA_ENCROACHMENT',
  'ENVIRONMENTAL_HAZARD',
  'PAYMENT_ANOMALY',
  'DOCUMENT_ANOMALY',
  'DEFORESTATION_RISK',
  'FIELD_REPORT_ANOMALY',
];

export default function AlertsTab() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, hasPermission } = useAuth();
  const context = roleContext(user, hasPermission);
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  const [scope, setScope] = useState<'review' | 'all'>('review');
  const [type, setType] = useState<string | null>(null);
  const [risk, setRisk] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = useMemo(
    () => ({
      awaitingReview: (scope === 'review' ? 'true' : undefined) as 'true' | undefined,
      type: type ?? undefined,
      riskLevel: risk ?? undefined,
      page,
      limit: 15,
    }),
    [scope, type, risk, page],
  );

  const alerts = useAlerts(query);
  const statistics = useAlertStatistics();
  const status = useAiStatus();
  const items = alerts.data?.items ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((alert) => `${alert.reference} ${alert.title} ${alert.description} ${alert.forest?.name ?? ''}`.toLowerCase().includes(term));
  }, [items, search]);

  return (
    <ToneScope tone="dark">
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
          refreshControl={
            <RefreshControl
              refreshing={alerts.isRefetching}
              onRefresh={() => {
                void alerts.refetch();
                void statistics.refetch();
              }}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
          ListHeaderComponent={
            <View>
              <Row justify="space-between" align="flex-start" style={{ marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Overline style={{ marginBottom: 4 }}>Detection console</Overline>
                  <Title>AI alerts</Title>
                  <Caption tone="muted">
                    Engine {status.data?.deterministicEngine.version ?? '—'} · {status.data?.geminiConfigured ? 'Gemini enrichment active' : 'rule engine only'}
                  </Caption>
                </View>
                {context.canRunAnalysis ? (
                  <Button label="Run analysis" size="sm" icon="pulse-outline" onPress={() => router.push({ pathname: '/report/new', params: { type: 'AI_ANALYSIS' } })} />
                ) : null}
              </Row>

              {status.data && !status.data.geminiConfigured ? (
                <View style={{ marginBottom: 12 }}>
                  <Notice tone="info" title="Deterministic engine only">
                    {status.data.message ??
                      'GEMINI_API_KEY is not configured, so no narrative model is called. The rule engine below runs for real on the FEMS data and produces every alert you see here.'}
                  </Notice>
                </View>
              ) : null}

              {statistics.data ? (
                <>
                  <Row gap={10} wrap style={{ marginBottom: 10 }}>
                    <StatTile label="Alerts" value={statistics.data.total} icon="warning-outline" />
                    <StatTile label="Awaiting review" value={statistics.data.awaitingReview} icon="hourglass-outline" tone="warning" />
                    <StatTile label="Overdue review" value={statistics.data.overdueReview} icon="alarm-outline" tone="danger" />
                    <StatTile label="Confirmed" value={statistics.data.confirmed} icon="checkmark-circle-outline" tone="success" />
                  </Row>
                  <Card style={{ marginBottom: 12 }}>
                    <Row justify="space-between" style={{ marginBottom: 8 }}>
                      <Caption tone="muted">Human review</Caption>
                      <Tiny tone="faint">SLA {statistics.data.reviewSlaHours}h</Tiny>
                    </Row>
                    <Row gap={10} wrap>
                      <Badge label={`${statistics.data.humanReview.awaitingFirstReview} awaiting first review`} tone="warning" />
                      <Badge label={`${statistics.data.humanReview.reviewed} reviewed`} tone="primary" />
                      <Badge label={`${statistics.data.humanReview.confirmedByOfficer} confirmed by an officer`} tone="danger" />
                      <Badge label={`${statistics.data.humanReview.dismissedByOfficer} dismissed`} tone="neutral" />
                      {statistics.data.humanReview.confirmationRate !== null ? (
                        <Badge label={`confirmation rate ${formatPercent(statistics.data.humanReview.confirmationRate * 100)}`} tone="info" />
                      ) : null}
                    </Row>
                    <Caption tone="faint" style={{ marginTop: 8 }}>
                      An alert only becomes a case when a human officer confirms it. The engine never files a case on its own.
                    </Caption>
                  </Card>
                </>
              ) : null}

              <SegmentedControl
                value={scope}
                options={[
                  { value: 'review', label: 'Needs review' },
                  { value: 'all', label: 'All alerts' },
                ]}
                onChange={(value) => {
                  setScope(value === 'review' ? 'review' : 'all');
                  setPage(1);
                }}
              />

              <SearchBar value={search} onChangeText={setSearch} placeholder="Search reference, title or forest" onSubmit={() => setPage(1)} />
              <Row gap={8} wrap style={{ marginTop: 12 }}>
                <Chip label="Any risk" selected={!risk} onPress={() => setRisk(null)} />
                {(['CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as const).map((entry) => (
                  <Chip key={entry} label={riskLabel(entry, language)} selected={risk === entry} onPress={() => setRisk(entry)} />
                ))}
              </Row>
              <Row gap={8} wrap style={{ marginTop: 8, marginBottom: 12 }}>
                <Chip label="Any detector" selected={!type} onPress={() => setType(null)} />
                {TYPE_FILTERS.slice(0, 6).map((entry) => (
                  <Chip key={entry} label={alertTypeLabel(entry, language)} selected={type === entry} onPress={() => setType(entry)} />
                ))}
              </Row>
            </View>
          }
          ListEmptyComponent={
            alerts.isLoading ? (
              <SkeletonList rows={4} />
            ) : alerts.isError ? (
              <ErrorState error={alerts.error} onRetry={() => alerts.refetch()} />
            ) : (
              <EmptyState
                icon={scope === 'review' ? 'checkmark-done-outline' : 'warning-outline'}
                title={scope === 'review' ? 'Nothing waiting for review' : 'No alert recorded'}
                description={
                  scope === 'review'
                    ? 'Every alert in your scope has a recorded human decision. Switch to "All alerts" to read the history.'
                    : 'Run an analysis to let the rule engine scan the permits, activities, payments and inspections in your scope.'
                }
                actionLabel={scope === 'review' ? 'See all alerts' : undefined}
                onAction={scope === 'review' ? () => setScope('all') : undefined}
              />
            )
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/alert/[id]', params: { id: item.id } })}
              accessibilityRole="button"
              accessibilityLabel={`Alert ${item.reference}, ${riskLabel(item.riskLevel, language)}`}
              style={({ pressed }) => ({ marginBottom: 12, opacity: pressed ? 0.88 : 1 })}
            >
              <Card>
                <Row justify="space-between" style={{ marginBottom: 6 }}>
                  <Row gap={6} style={{ flex: 1 }}>
                    <Body style={{ fontWeight: '700' }}>{item.title}</Body>
                    {item.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
                  </Row>
                  <StatusPill status={item.status} label={alertStatusLabel(item.status, language)} />
                </Row>
                <Row gap={8} wrap style={{ marginBottom: 8 }}>
                  <RiskPill level={item.riskLevel} label={riskLabel(item.riskLevel, language)} />
                  <Badge label={alertTypeLabel(item.type, language)} tone="primary" />
                  {item.review?.overdue ? <Badge label="review overdue" tone="danger" icon="alarm-outline" compact /> : null}
                  {item.confidence !== undefined && item.confidence !== null ? (
                    <Badge label={`confidence ${formatPercent(Number(item.confidence) * 100)}`} tone="neutral" compact />
                  ) : null}
                </Row>
                <Caption tone="muted" style={{ marginBottom: 8 }} lines={2}>
                  {item.reasoning ?? item.description}
                </Caption>
                <Row gap={10} wrap>
                  <Tiny tone="faint">{item.detector}</Tiny>
                  {item.forest ? <Tiny tone="faint">· {item.forest.name}</Tiny> : null}
                  {item.company ? <Tiny tone="faint">· {item.company.name}</Tiny> : null}
                </Row>
                <Row justify="space-between" style={{ marginTop: 8 }}>
                  <Tiny tone="faint">{formatDateTime(item.detectedAt, language)}</Tiny>
                  <Row gap={6}>
                    <Ionicons name="chevron-forward-outline" size={14} color={theme.colors.textFaint} />
                    <Tiny tone="faint">{formatRelative(item.detectedAt, language)}</Tiny>
                  </Row>
                </Row>
              </Card>
            </Pressable>
          )}
          ListFooterComponent={
            items.length > 0 && alerts.data?.meta?.hasNextPage ? (
              <Section>
                <Button label="Load more" variant="secondary" icon="chevron-down" onPress={() => setPage((current) => current + 1)} />
              </Section>
            ) : (
              <Section>
                <Card>
                  <Row gap={10}>
                    <Ionicons name="shield-half-outline" size={18} color={theme.colors.info} />
                    <Caption tone="muted" style={{ flex: 1 }}>
                      Alerts are advisory. A confirmation requires a written reason and, for field verification, a linked inspection — the guardrails reported by
                      the API are {status.data?.guardrails.length ?? 0}.
                    </Caption>
                  </Row>
                </Card>
              </Section>
            )
          }
        />
      </View>
    </ToneScope>
  );
}
