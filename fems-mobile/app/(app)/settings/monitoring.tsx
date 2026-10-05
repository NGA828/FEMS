/**
 * System monitoring.
 *
 * What this deployment is actually doing right now: how many requests it is
 * serving and how many of them fail, which routes are slow, whether the nightly
 * jobs ran and succeeded, how much disk the uploaded files are consuming, and a
 * single health verdict built from all of it. Everything shown here is measured
 * by the API — nothing is inferred from configuration.
 */
import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSystemHealth, useSystemMetrics } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { formatDateTime, formatNumber, formatRelative } from '../../../src/lib/format';
import { useTheme } from '../../../src/theme/theme';
import {
  safeGoBack,
  Badge,
  BarChart,
  Body,
  Caption,
  Card,
  Definition,
  EmptyState,
  ErrorState,
  Notice,
  Overline,
  PageHeader,
  ProgressBar,
  Row,
  Screen,
  Section,
  SkeletonList,
  StatTile,
  Tiny,
} from '../../../src/ui';

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days`;
}

export default function SystemMonitoringScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { hasAnyPermission } = useAuth();

  const allowed = hasAnyPermission('system:monitor', 'system:health', 'settings:manage', '*');
  const metrics = useSystemMetrics(allowed);
  const health = useSystemHealth(allowed);

  if (!allowed) {
    return (
      <Screen>
        <PageHeader title="System monitoring" onBack={safeGoBack} />
        <EmptyState
          icon="lock-closed-outline"
          title="Not available for your role"
          description="Monitoring the deployment requires the system:monitor permission."
        />
      </Screen>
    );
  }

  if (metrics.isLoading && !metrics.data) {
    return (
      <Screen>
        <PageHeader title="System monitoring" onBack={safeGoBack} />
        <SkeletonList rows={6} />
      </Screen>
    );
  }

  if (metrics.isError || !metrics.data) {
    return (
      <Screen>
        <PageHeader title="System monitoring" onBack={safeGoBack} />
        <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} title="The metrics could not be read" />
      </Screen>
    );
  }

  const data = metrics.data;
  const verdict = health.data?.status;
  const failingJobs = data.jobs.filter((job) => job.lastRun?.status === 'FAILED');

  return (
    <Screen refresh={{ refreshing: metrics.isRefetching, onRefresh: () => { void metrics.refetch(); void health.refetch(); } }}>
      <PageHeader
        title="System monitoring"
        subtitle={`${data.environment} · measured since ${formatRelative(data.process.startedAt, 'en')}`}
        onBack={safeGoBack}
      />

      {verdict ? (
        <Notice
          tone={verdict === 'OK' ? 'success' : verdict === 'DEGRADED' ? 'warning' : 'danger'}
          title={verdict === 'OK' ? 'All components healthy' : verdict === 'DEGRADED' ? 'Running degraded' : 'A component is failing'}
        >
          {health.data?.components.filter((component) => component.status !== 'OK').map((component) => component.label).join(', ') ||
            'Email, push, payments, AI, storage, the database, the scheduled jobs and the disk were all checked.'}
        </Notice>
      ) : null}

      <Row gap={10} wrap style={{ marginBottom: 4 }}>
        <StatTile label="Requests served" value={formatNumber(data.requests.total, 'en')} icon="swap-horizontal-outline" />
        <StatTile
          label="Error rate"
          value={`${data.requests.errorRate}%`}
          icon="alert-circle-outline"
          tone={data.requests.serverErrors > 0 ? 'danger' : data.requests.errorRate > 10 ? 'warning' : 'success'}
          hint={`${data.requests.serverErrors} server · ${data.requests.clientErrors} rejected`}
        />
        <StatTile label="Average response" value={`${data.requests.averageMs} ms`} icon="speedometer-outline" />
        <StatTile label="Throughput" value={`${data.requests.throughputPerMinute}/min`} icon="pulse-outline" hint={`${data.requests.inFlight} in flight`} />
      </Row>

      <Section title="Process">
        <Card>
          <Definition label="Uptime" value={duration(data.process.uptimeSeconds)} />
          <Definition label="Started" value={formatDateTime(data.process.startedAt, 'en')} />
          <Definition label="Node" value={`${data.process.nodeVersion} · pid ${data.process.pid}`} />
          <Definition label="Memory" value={`${data.process.memory.heapUsedMb} / ${data.process.memory.heapTotalMb} MB heap · ${data.process.memory.rssMb} MB resident`} />
          <Definition
            label="Database"
            value={data.database.reachable ? `reachable in ${data.database.latencyMs} ms` : `unreachable — ${data.database.error ?? 'no answer'}`}
          />
        </Card>
      </Section>

      {data.requests.perMinute.length > 0 ? (
        <Section title="Requests per minute (last quarter of an hour)">
          <Card>
            <BarChart
              data={data.requests.perMinute.map((bucket) => ({
                label: bucket.minute.slice(11),
                value: bucket.requests,
                tone: bucket.errors > 0 ? 'HIGH' : 'LOW',
              }))}
              height={110}
            />
            <Caption tone="faint" style={{ marginTop: 6 }}>
              A bar is highlighted when at least one request in that minute was rejected.
            </Caption>
          </Card>
        </Section>
      ) : null}

      <Section title="Scheduled jobs">
        {failingJobs.length > 0 ? (
          <Notice tone="danger" title="A scheduled job failed">
            {failingJobs.map((job) => job.name).join(', ')} did not complete on the last run.
          </Notice>
        ) : null}
        <Card>
          {data.jobs.length === 0 ? (
            <Caption tone="muted">No job has been registered by this process yet.</Caption>
          ) : (
            data.jobs.map((job) => (
              <View key={job.name} style={{ marginBottom: 12 }}>
                <Row justify="space-between">
                  <Body style={{ fontWeight: '700' }}>{job.name}</Body>
                  <Badge
                    label={job.lastRun ? job.lastRun.status.toLowerCase() : 'never run'}
                    tone={!job.lastRun ? 'neutral' : job.lastRun.status === 'SUCCESS' ? 'success' : 'danger'}
                    compact
                  />
                </Row>
                <Tiny tone="faint">
                  {job.lastRun
                    ? `${formatDateTime(job.lastRun.finishedAt, 'en')} · ${job.lastRun.durationMs} ms${job.lastRun.message ? ` · ${job.lastRun.message}` : ''}`
                    : 'Has not run since the API started. Nightly jobs run at 04:00 and 05:30.'}
                </Tiny>
                <Tiny tone="faint">{`${job.runs} run(s) this process, ${job.failures} failure(s)`}</Tiny>
              </View>
            ))
          )}
        </Card>
      </Section>

      <Section title="Busiest routes">
        <Card>
          {data.routes.length === 0 ? (
            <Caption tone="muted">No request has been served yet.</Caption>
          ) : (
            data.routes.slice(0, 8).map((route) => (
              <Row key={route.route} justify="space-between" style={{ marginBottom: 8 }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Caption lines={1}>{route.route}</Caption>
                  <Tiny tone="faint">{`${route.count} call(s) · ${route.errors} failed · max ${route.maxMs} ms`}</Tiny>
                </View>
                <Badge label={`${route.averageMs} ms`} tone={route.averageMs > 800 ? 'warning' : 'neutral'} compact />
              </Row>
            ))
          )}
        </Card>
      </Section>

      {data.slowest.length > 0 ? (
        <Section title="Slowest recent requests">
          <Card>
            {data.slowest.slice(0, 6).map((entry, index) => (
              <Row key={`${entry.route}-${entry.at}-${index}`} gap={8} style={{ marginBottom: 6 }}>
                <Ionicons name="time-outline" size={15} color={entry.ms > 1000 ? theme.colors.warning : theme.colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Caption lines={1}>{entry.route}</Caption>
                  <Tiny tone="faint">{`${formatDateTime(entry.at, 'en')} · HTTP ${entry.status}`}</Tiny>
                </View>
                <Badge label={`${entry.ms} ms`} tone={entry.ms > 1000 ? 'warning' : 'neutral'} compact />
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Storage">
        <Card>
          <Definition label="Driver" value={`${data.storage.driver} · ${data.storage.directory}`} />
          <Definition label="Files recorded" value={`${formatNumber(data.storage.files, 'en')} file(s) · ${data.storage.totalMb} MB`} />
          {data.storage.byKind.map((bucket) => (
            <Row key={bucket.key} justify="space-between" style={{ marginTop: 4 }}>
              <Tiny tone="faint">{bucket.key}</Tiny>
              <Tiny>{`${bucket.files} · ${bucket.mb} MB`}</Tiny>
            </Row>
          ))}
          {data.storage.diskFreePercent !== null ? (
            <View style={{ marginTop: 10 }}>
              <Overline>Disk</Overline>
              <ProgressBar
                value={100 - data.storage.diskFreePercent}
                tone={data.storage.diskFreePercent < 15 ? 'danger' : data.storage.diskFreePercent < 30 ? 'warning' : 'success'}
                label={`${data.storage.diskFreePercent}% free — ${formatNumber(data.storage.diskFreeMb ?? 0, 'en')} of ${formatNumber(data.storage.diskTotalMb ?? 0, 'en')} MB`}
              />
            </View>
          ) : null}
        </Card>
      </Section>

      <Section title="Last 24 hours">
        <Card>
          <Definition label="Audited actions" value={formatNumber(data.workload.auditedActions, 'en')} />
          <Definition label="Sign-ins" value={`${data.workload.logins} successful · ${data.workload.failedLogins} refused`} />
          <Definition label="Notifications created" value={formatNumber(data.workload.notificationsCreated, 'en')} />
          <Definition label="Active sessions" value={formatNumber(data.workload.activeSessions, 'en')} />
        </Card>
      </Section>

      {health.data ? (
        <Section title="Components">
          <Card>
            {health.data.components.map((component) => (
              <Row key={component.key} gap={10} style={{ marginBottom: 10 }}>
                <Ionicons
                  name={component.status === 'OK' ? 'checkmark-circle-outline' : component.status === 'DEGRADED' ? 'warning-outline' : 'close-circle-outline'}
                  size={16}
                  color={component.status === 'OK' ? theme.colors.success : component.status === 'DEGRADED' ? theme.colors.warning : theme.colors.danger}
                />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '600' }}>{component.label}</Body>
                  <Tiny tone="faint">{component.detail}</Tiny>
                </View>
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}

      <Caption tone="faint" style={{ marginTop: 4, marginBottom: 24 }}>
        Request counters live in the API process memory and reset when it restarts; the storage, workload and database figures are read from the register itself.
      </Caption>
    </Screen>
  );
}
