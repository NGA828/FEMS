/**
 * Analysis detail.
 *
 * Everything the run recorded: the detector version that produced it, how many
 * rules were evaluated, the findings with their reasoning and the entities they
 * point at, and the alerts it raised. The alerts are listed with their review
 * status so it is obvious that a human still has to rule on each one.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { AiAlert, AiAnalysis } from '../../../src/api/types';
import { useAnalysis } from '../../../src/api/queries';
import { alertStatusLabel, alertTypeLabel, formatDateTime, formatNumber, formatRelative, humanize, riskLabel } from '../../../src/lib/format';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  BarChart,
  Body,
  Button,
  Caption,
  Card,
  Definition,
  ErrorState,
  Notice,
  Overline,
  PageHeader,
  Row,
  Screen,
  Section,
  SkeletonDetail,
  Tiny,
} from '../../../src/ui';

/** Where a finding's entity lives, when FEMS has a screen for it. */
function entityRoute(entityType?: string | null, entityId?: string | null): { pathname: string; params: { id: string } } | null {
  if (!entityId) return null;
  switch (entityType) {
    case 'ExploitationPermit':
      return { pathname: '/permit/[id]', params: { id: entityId } };
    case 'ExploitationActivity':
      return { pathname: '/activity/[id]', params: { id: entityId } };
    case 'Inspection':
      return { pathname: '/inspection/[id]', params: { id: entityId } };
    case 'FieldObservation':
      return { pathname: '/observation/[id]', params: { id: entityId } };
    case 'AIAlert':
      return { pathname: '/alert/[id]', params: { id: entityId } };
    case 'EnvironmentalViolation':
      return { pathname: '/violation/[id]', params: { id: entityId } };
    default:
      return null;
  }
}

export default function AnalysisDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const analysis = useAnalysis(id ?? null);

  if (analysis.isLoading) {
    return (
      <Screen>
        <PageHeader title="Analysis" onBack={() => router.back()} />
        <SkeletonDetail />
      </Screen>
    );
  }

  if (analysis.isError || !analysis.data) {
    return (
      <Screen>
        <PageHeader title="Analysis" onBack={() => router.back()} />
        <ErrorState error={analysis.error} onRetry={() => analysis.refetch()} title="This analysis could not be loaded" />
      </Screen>
    );
  }

  const data: AiAnalysis = analysis.data;
  const result = data.result ?? null;
  const findings = result?.findings ?? [];
  const alerts = data.alerts ?? [];

  const riskBars = Object.entries(result?.byRisk ?? {}).map(([label, value]) => ({ label: riskLabel(label as never) ?? label, value: Number(value) }));
  const typeBars = Object.entries(result?.byType ?? {}).map(([label, value]) => ({ label: humanize(label), value: Number(value) }));

  return (
    <Screen refresh={analysis.isRefetching ? { refreshing: true, onRefresh: () => analysis.refetch() } : undefined}>
      <PageHeader title={humanize(data.type)} subtitle={data.id} onBack={() => router.back()} />

      {data.status === 'FAILED' ? (
        <Notice tone="danger" title="This run failed">
          {data.errorMessage ?? 'The service did not record a reason.'}
        </Notice>
      ) : null}

      <Card>
        <Row justify="space-between" style={{ marginBottom: 8 }}>
          <Badge label={data.status} tone={data.status === 'COMPLETED' ? 'success' : data.status === 'FAILED' ? 'danger' : 'warning'} />
          <Badge label={data.provider} tone="neutral" />
        </Row>
        <Body style={{ marginBottom: 8 }}>{data.summary ?? 'No summary recorded for this run.'}</Body>
        <Definition label="Model" value={data.model ?? 'not applicable'} />
        <Definition label="Detector" value={result?.detectorVersion ?? '—'} />
        <Definition label="Rules evaluated" value={result ? formatNumber(result.rulesEvaluated) : '—'} />
        <Definition label="Duplicates skipped" value={result?.duplicatesSkipped !== undefined ? formatNumber(result.duplicatesSkipped) : '—'} />
        <Definition label="Risk level" value={data.riskLevel ? riskLabel(data.riskLevel) : 'not scored'} />
        <Definition label="Confidence" value={data.confidence ? `${(Number(data.confidence) * 100).toFixed(0)} %` : '—'} />
        <Definition label="Alerts raised" value={formatNumber(result?.alertsRaised ?? data._count?.alerts ?? 0)} />
        <Definition label="Latency" value={data.latencyMs ? `${formatNumber(data.latencyMs)} ms` : '—'} />
        <Definition label="Requested by" value={data.requestedBy ? `${data.requestedBy.firstName} ${data.requestedBy.lastName}` : '—'} />
        <Definition label="Started" value={formatDateTime(data.startedAt, 'en')} tone="muted" />
        {data.completedAt ? <Definition label="Completed" value={formatDateTime(data.completedAt, 'en')} tone="muted" /> : null}
      </Card>

      {result?.seeded ? (
        <Notice tone="neutral" title="Seeded demo run">
          This analysis belongs to the demonstration dataset, so the demo story is complete on a fresh install. New runs compute over whatever is really in the
          database.
        </Notice>
      ) : null}

      {riskBars.length || typeBars.length ? (
        <Section title="Distribution">
          <Card>
            {riskBars.length ? (
              <>
                <Overline style={{ marginBottom: 6 }}>By risk</Overline>
                <BarChart data={riskBars} valueFormatter={(value) => formatNumber(value)} />
              </>
            ) : null}
            {typeBars.length ? (
              <View style={{ marginTop: 12 }}>
                <Overline style={{ marginBottom: 6 }}>By anomaly type</Overline>
                <BarChart data={typeBars} valueFormatter={(value) => formatNumber(value)} />
              </View>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {findings.length ? (
        <Section title={`Findings (${findings.length})`}>
          <Caption tone="muted" style={{ marginBottom: 8 }}>
            Each finding states the rule that fired and the numbers that made it fire, so an officer can check the reasoning instead of trusting it.
          </Caption>
          {findings.map((finding) => {
            const route = entityRoute(finding.entityType, finding.entityId);
            return (
              <Card key={`${finding.code}-${finding.entityId ?? finding.title}`} style={{ marginBottom: 8 }}>
                <Row justify="space-between" style={{ marginBottom: 4 }}>
                  <Badge label={humanize(finding.type)} tone="neutral" compact />
                  <Badge
                    label={riskLabel(finding.riskLevel as never) ?? finding.riskLevel}
                    tone={finding.riskLevel === 'CRITICAL' ? 'danger' : finding.riskLevel === 'HIGH' ? 'warning' : 'neutral'}
                    compact
                  />
                </Row>
                <Body style={{ fontWeight: '600', marginBottom: 4 }}>{finding.title}</Body>
                <Tiny tone="faint">{finding.code}</Tiny>
                {finding.reasoning ? (
                  <Caption tone="muted" style={{ marginTop: 6 }}>
                    {finding.reasoning}
                  </Caption>
                ) : null}
                <Row justify="space-between" style={{ marginTop: 8 }}>
                  <Tiny tone="faint">
                    {finding.confidence !== undefined ? `confidence ${(finding.confidence * 100).toFixed(0)} %` : 'no confidence score'}
                    {finding.entityType ? ` · ${humanize(finding.entityType)}` : ''}
                  </Tiny>
                  {route ? (
                    <Pressable onPress={() => router.push(route)} accessibilityRole="button" accessibilityLabel={`Open ${finding.entityType}`}>
                      <Row gap={4}>
                        <Tiny style={{ color: theme.colors.primary }}>Open record</Tiny>
                        <Ionicons name="chevron-forward-outline" size={14} color={theme.colors.primary} />
                      </Row>
                    </Pressable>
                  ) : null}
                </Row>
              </Card>
            );
          })}
        </Section>
      ) : (
        <Section title="Findings">
          <Card>
            <Caption tone="muted">
              {data.status === 'COMPLETED'
                ? 'The rules ran and found nothing to flag across the scope of this run.'
                : 'No findings were recorded.'}
            </Caption>
          </Card>
        </Section>
      )}

      {alerts.length ? (
        <Section title={`Alerts raised (${alerts.length})`}>
          <Notice tone="warning" title="Every alert needs a human decision">
            FEMS never marks a company or a person as illegally exploiting on the strength of a detector result. An alert becomes a case only when an officer
            reviews it and decides.
          </Notice>
          {alerts.map((alert: AiAlert) => (
            <Pressable
              key={alert.id}
              onPress={() => router.push({ pathname: '/alert/[id]', params: { id: alert.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${alert.title}, ${alertStatusLabel(alert.status)}`}
              style={({ pressed }) => ({ marginBottom: 8, opacity: pressed ? 0.85 : 1 })}
            >
              <Card>
                <Row justify="space-between" style={{ marginBottom: 4 }}>
                  <Badge label={alertTypeLabel(alert.type)} tone="neutral" compact />
                  <Badge
                    label={alertStatusLabel(alert.status)}
                    tone={alert.status === 'NEW' ? 'warning' : alert.status === 'CONFIRMED' ? 'danger' : alert.status === 'DISMISSED' ? 'neutral' : 'success'}
                    compact
                  />
                </Row>
                <Body lines={2}>{alert.title}</Body>
                <Tiny tone="faint" style={{ marginTop: 6 }}>
                  {riskLabel(alert.riskLevel)} risk · detected {formatRelative(alert.detectedAt, 'en')}
                </Tiny>
              </Card>
            </Pressable>
          ))}
        </Section>
      ) : (
        <Section title="Alerts">
          <Card>
            <Caption tone="muted">This run raised no alert.</Caption>
          </Card>
        </Section>
      )}

      {result?.warnings?.length ? (
        <Section title="Warnings recorded with the run">
          <Card>
            {result.warnings.map((warning) => (
              <Row key={warning} gap={8} style={{ marginBottom: 6 }}>
                <Ionicons name="alert-circle-outline" size={15} color={theme.colors.warning} style={{ marginTop: 2 }} />
                <Caption tone="muted" style={{ flex: 1 }}>
                  {warning}
                </Caption>
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}

      {result?.note ? (
        <Notice tone="neutral" title="Note from the detector">
          {result.note}
        </Notice>
      ) : null}

      <Row gap={8} wrap style={{ marginTop: 12 }}>
        <Button label="All analyses" variant="secondary" icon="analytics-outline" onPress={() => router.replace('/analysis')} />
        <Button label="Alert console" variant="secondary" icon="warning-outline" onPress={() => router.push('/alerts')} />
      </Row>
      <Tiny tone="faint" style={{ marginTop: 10 }}>
        Run {data.id} · provider {data.provider}
        {data.tokensUsed ? ` · ${formatNumber(data.tokensUsed)} tokens` : ''}
      </Tiny>
    </Screen>
  );
}
