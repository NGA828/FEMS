/**
 * Forest intelligence — analysis runs.
 *
 * An analysis is a real computation over the database: the detector applies its
 * published rules and writes what it found, with the rule version, the thresholds
 * and the entities it examined. When no AI provider is configured the
 * deterministic rule engine runs instead — and the screen says so.
 *
 * Nothing here accuses anybody. An analysis can raise an alert, and an alert only
 * becomes a case when a named officer reviews it and decides.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ApiError } from '../../../src/api/client';
import type { AiAnalysis, AiAnalysisType, Forest } from '../../../src/api/types';
import { useAiCatalogue, useAiStatus, useAnalyses, useForests, useRunAnalysis } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { formatDateTime, formatNumber, formatRelative, humanize, riskLabel } from '../../../src/lib/format';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  Definition,
  EmptyState,
  ErrorState,
  Notice,
  Overline,
  PageHeader,
  Row,
  Screen,
  Section,
  SelectSheet,
  SkeletonList,
  StatTile,
  Tiny,
  useToast,
} from '../../../src/ui';

const PERIODS = [30, 90, 180, 365] as const;

export default function AnalysisScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { hasPermission } = useAuth();

  const catalogue = useAiCatalogue();
  const status = useAiStatus();
  const analyses = useAnalyses({ limit: 20 });
  const forests = useForests({ limit: 100 });
  const run = useRunAnalysis();

  const [type, setType] = useState<AiAnalysisType | null>(null);
  const [forestId, setForestId] = useState<string | null>(null);
  const [periodDays, setPeriodDays] = useState<number>(90);
  const [lastResult, setLastResult] = useState<AiAnalysis | null>(null);

  const items = analyses.data?.items ?? [];
  const canRun = hasPermission('ai:analysis_run');

  const runSummary = useMemo(() => {
    const completed = items.filter((entry: AiAnalysis) => entry.status === 'COMPLETED');
    return {
      total: analyses.data?.meta?.total ?? items.length,
      completed: completed.length,
      failed: items.filter((entry: AiAnalysis) => entry.status === 'FAILED').length,
      alerts: items.reduce((total, entry) => total + (entry._count?.alerts ?? 0), 0),
    };
  }, [items, analyses.data?.meta?.total]);

  const submit = async () => {
    if (!type) {
      toast.error('Choose an analysis type', 'The type decides which rules run.');
      return;
    }
    try {
      const result = await run.mutateAsync({
        type,
        forestId: forestId ?? undefined,
        periodDays,
      });
      setLastResult(result);
      if (result.status === 'FAILED') {
        toast.error('Analysis failed', result.errorMessage ?? 'The service reported a failure.');
      } else {
        toast.success(
          'Analysis complete',
          `${result._count?.alerts ?? 0} alert(s) raised — each one needs a human review before it becomes a case.`,
        );
      }
    } catch (error) {
      toast.error('Could not run the analysis', error instanceof ApiError ? error.message : undefined);
    }
  };

  const analysisTypes = catalogue.data?.analysisTypes ?? [];

  return (
    <Screen refresh={analyses.isRefetching ? { refreshing: true, onRefresh: () => analyses.refetch() } : undefined}>
      <PageHeader
        title="Forest intelligence"
        subtitle="Rule-based detection over the register"
        onBack={() => router.back()}
        right={
          hasPermission('ai:alerts_read') ? (
            <Button label="Alerts" size="sm" variant="secondary" icon="warning-outline" onPress={() => router.push('/alerts')} />
          ) : undefined
        }
      />

      {status.data ? (
        <Notice
          tone={status.data.geminiConfigured ? 'info' : 'neutral'}
          title={status.data.geminiConfigured ? `Provider: ${status.data.provider}` : 'Deterministic rule engine only'}
        >
          {status.data.geminiConfigured
            ? `${status.data.message} Model: ${status.data.model}. Findings are still reviewed by a human before any regulatory step.`
            : status.data.message}
        </Notice>
      ) : null}

      <Row gap={8} wrap style={{ marginBottom: 12 }}>
        <StatTile label="Analyses" value={formatNumber(runSummary.total)} icon="analytics-outline" />
        <StatTile label="Completed" value={formatNumber(runSummary.completed)} icon="checkmark-done-outline" tone="success" />
        <StatTile label="Alerts raised" value={formatNumber(runSummary.alerts)} icon="warning-outline" tone={runSummary.alerts ? 'warning' : 'neutral'} />
        {runSummary.failed ? <StatTile label="Failed" value={formatNumber(runSummary.failed)} icon="close-circle-outline" tone="danger" /> : null}
      </Row>

      {canRun ? (
        <Section title="Run an analysis">
          <Caption tone="muted" style={{ marginBottom: 8 }}>
            FEMS computes the findings from the live register — permit state, declared volumes, payments, inspections and observations — and stores the result with
            the rule version that produced it.
          </Caption>
          {catalogue.isLoading ? <Tiny tone="faint">Loading the catalogue…</Tiny> : null}
          <SelectSheet
            label="Analysis type"
            value={type}
            required
            options={analysisTypes.map((value) => ({ value, label: humanize(value) }))}
            onChange={setType}
          />
          <SelectSheet
            label="Scope"
            value={forestId}
            options={[
              { value: '__none__', label: 'Whole register in my scope' },
              ...(forests.data?.items ?? []).map((forest: Forest) => ({ value: forest.id, label: `${forest.name} (${forest.code})` })),
            ]}
            onChange={(value) => setForestId(value === '__none__' ? null : value)}
          />
          <Overline style={{ marginBottom: 6 }}>Period</Overline>
          <Row gap={6} wrap style={{ marginBottom: 12 }}>
            {PERIODS.map((days) => (
              <Chip key={days} label={`${days} days`} selected={periodDays === days} onPress={() => setPeriodDays(days)} />
            ))}
          </Row>
          <Button
            label={run.isPending ? 'Running the rules…' : 'Run analysis'}
            icon="play-outline"
            loading={run.isPending}
            onPress={() => void submit()}
          />
          <Tiny tone="faint" style={{ marginTop: 6 }}>
            Some analysis types take several seconds: the API reads the register before answering.
          </Tiny>
        </Section>
      ) : (
        <Notice tone="neutral" title="Running analyses requires the ai:analysis_run permission">
          You can read the results below; ask an administrator for the analysis permission if you need to launch a run.
        </Notice>
      )}

      {lastResult ? (
        <Section title="Latest result">
          <Card>
            <Row justify="space-between" style={{ marginBottom: 8 }}>
              <Badge label={humanize(lastResult.type)} tone="primary" compact />
              <Badge
                label={lastResult.status}
                tone={lastResult.status === 'COMPLETED' ? 'success' : lastResult.status === 'FAILED' ? 'danger' : 'warning'}
                compact
              />
            </Row>
            <Body style={{ marginBottom: 8 }}>{lastResult.summary ?? 'No summary was recorded.'}</Body>
            <Definition label="Provider" value={`${lastResult.provider}${lastResult.model ? ` · ${lastResult.model}` : ''}`} />
            <Definition label="Latency" value={lastResult.latencyMs ? `${formatNumber(lastResult.latencyMs)} ms` : '—'} />
            <Row gap={8} wrap style={{ marginTop: 10 }}>
              <Button
                size="sm"
                variant="secondary"
                label="Details"
                icon="reader-outline"
                onPress={() => router.push({ pathname: '/analysis/[id]', params: { id: lastResult.id } })}
              />
              <Button
                size="sm"
                variant="secondary"
                label="See the alerts"
                icon="warning-outline"
                onPress={() => router.push('/alerts')}
              />
            </Row>
          </Card>
        </Section>
      ) : null}

      <Section title="History">
        {analyses.isLoading ? (
          <SkeletonList rows={4} />
        ) : analyses.isError ? (
          <ErrorState error={analyses.error} onRetry={() => analyses.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="analytics-outline"
            title="No analysis has been run yet"
            description={canRun ? 'Run a risk assessment or an anomaly detection pass to look for inconsistencies in the register.' : 'Results appear here once a service runs an analysis.'}
            actionLabel={canRun ? 'Run the first analysis' : undefined}
            onAction={() => setType(analysisTypes[0] ?? null)}
          />
        ) : (
          items.map((analysis: AiAnalysis) => (
            <Pressable
              key={analysis.id}
              onPress={() => router.push({ pathname: '/analysis/[id]', params: { id: analysis.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${humanize(analysis.type)} analysis, ${analysis.status}`}
              style={({ pressed }) => ({ marginBottom: 10, opacity: pressed ? 0.85 : 1 })}
            >
              <Card>
                <Row justify="space-between" style={{ marginBottom: 6 }}>
                  <Overline>{humanize(analysis.type)}</Overline>
                  <Badge
                    label={analysis.status}
                    tone={analysis.status === 'COMPLETED' ? 'success' : analysis.status === 'FAILED' ? 'danger' : 'warning'}
                    compact
                  />
                </Row>
                <Body lines={2}>{analysis.summary ?? 'No summary recorded.'}</Body>
                <Row gap={8} wrap style={{ marginTop: 6 }}>
                  {analysis.riskLevel ? <Badge label={riskLabel(analysis.riskLevel)} tone={analysis.riskLevel === 'CRITICAL' ? 'danger' : analysis.riskLevel === 'HIGH' ? 'warning' : 'neutral'} compact /> : null}
                  {analysis._count?.alerts ? <Badge label={`${analysis._count.alerts} alert(s)`} tone="warning" compact /> : null}
                  <Tiny tone="faint">{analysis.provider}</Tiny>
                </Row>
                <Row justify="space-between" style={{ marginTop: 8 }}>
                  <Tiny tone="faint">
                    {analysis.completedAt ? `completed ${formatRelative(analysis.completedAt, 'en')}` : `started ${formatDateTime(analysis.startedAt, 'en')}`}
                    {analysis.requestedBy ? ` · ${analysis.requestedBy.firstName} ${analysis.requestedBy.lastName}` : ''}
                  </Tiny>
                  <Ionicons name="chevron-forward-outline" size={16} color={theme.colors.textFaint} />
                </Row>
              </Card>
            </Pressable>
          ))
        )}
      </Section>

      {status.data?.guardrails.length ? (
        <Section title="What FEMS will not do">
          <Card>
            {status.data.guardrails.map((rule) => (
              <Row key={rule} gap={8} style={{ marginBottom: 6 }}>
                <Ionicons name="shield-checkmark-outline" size={15} color={theme.colors.primary} style={{ marginTop: 2 }} />
                <Caption tone="muted" style={{ flex: 1 }}>
                  {rule}
                </Caption>
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
