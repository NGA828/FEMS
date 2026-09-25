/**
 * Audit trail.
 *
 * Every meaningful action in FEMS — sign-ins, permit transitions, payment
 * verifications, AI reviews, file uploads, account changes — with the actor, the
 * severity and the before/after values the API recorded. Read-only by design:
 * an audit entry cannot be edited or deleted from the application.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { AuditAction, AuditEntry, AuditSeverity } from '../../../src/api/types';
import { useAuditLog, useAuditSummary } from '../../../src/api/queries';
import { formatDateTime, formatNumber, formatRelative, humanize } from '../../../src/lib/format';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  BarChart,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Overline,
  PageHeader,
  Row,
  Screen,
  SearchBar,
  Section,
  SkeletonList,
  StatTile,
  TextField,
  Tiny,
} from '../../../src/ui';

const SEVERITIES: AuditSeverity[] = ['INFO', 'WARNING', 'CRITICAL'];

const COMMON_ACTIONS: AuditAction[] = [
  'LOGIN',
  'LOGIN_FAILED',
  'PERMIT_STATUS_CHANGE',
  'PAYMENT_VERIFIED',
  'AI_ALERT_REVIEW',
  'AI_ANALYSIS',
  'EXPORT',
  'DELETE',
  'ACCOUNT_STATUS_CHANGE',
  'ROLE_ASSIGNED',
  'SETTINGS_CHANGE',
];

const SEVERITY_TONE: Record<AuditSeverity, 'info' | 'warning' | 'danger'> = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'danger',
};

function Diff({ before, after }: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null }) {
  const theme = useTheme();
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])).slice(0, 12);
  if (keys.length === 0) return null;
  return (
    <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 8 }}>
      {keys.map((key) => {
        const from = before?.[key];
        const to = after?.[key];
        return (
          <Row key={key} gap={6} style={{ marginBottom: 4 }} align="flex-start">
            <Tiny tone="faint" style={{ width: 110 }}>
              {key}
            </Tiny>
            <Tiny style={{ flex: 1, color: theme.colors.danger }} lines={2}>
              {from === undefined ? '—' : JSON.stringify(from)}
            </Tiny>
            <Ionicons name="arrow-forward-outline" size={14} color={theme.colors.textFaint} />
            <Tiny style={{ flex: 1, color: theme.colors.success }} lines={2}>
              {to === undefined ? '—' : JSON.stringify(to)}
            </Tiny>
          </Row>
        );
      })}
    </View>
  );
}

export default function AuditTrailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ actorId?: string }>();

  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState<AuditSeverity | 'ALL'>('ALL');
  const [action, setAction] = useState<AuditAction | 'ALL'>('ALL');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actorId, setActorId] = useState<string | null>(params.actorId ?? null);

  const query = useMemo(
    () => ({
      limit: 50,
      severity: severity === 'ALL' ? undefined : severity,
      action: action === 'ALL' ? undefined : action,
      entityType: entityType.trim() || undefined,
      actorId: actorId ?? undefined,
      from: from ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59.000Z`).toISOString() : undefined,
    }),
    [severity, action, entityType, actorId, from, to],
  );

  const audit = useAuditLog(query);
  const summary = useAuditSummary(30);

  const items = audit.data?.items ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((entry: AuditEntry) =>
      [entry.description, entry.actorEmail, entry.entityType, entry.action].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [items, search]);

  const actorName = actorId ? items[0]?.actor : null;
  const activeFilters = severity !== 'ALL' || action !== 'ALL' || Boolean(entityType) || Boolean(from) || Boolean(to) || Boolean(actorId);

  return (
    <Screen refresh={audit.isRefetching ? { refreshing: true, onRefresh: () => audit.refetch() } : undefined}>
      <PageHeader
        title="Audit trail"
        subtitle={actorId ? 'Filtered on one account' : 'Everything FEMS recorded'}
        onBack={() => router.back()}
      />

      {summary.data ? (
        <>
          <Row gap={8} wrap style={{ marginBottom: 12 }}>
            <StatTile label={`Last ${summary.data.windowDays} days`} value={formatNumber(summary.data.total)} icon="pulse-outline" />
            <StatTile
              label="Critical"
              value={summary.data.bySeverity.find((row) => row.severity === 'CRITICAL')?.count ?? 0}
              icon="alert-circle-outline"
              tone={(summary.data.bySeverity.find((row) => row.severity === 'CRITICAL')?.count ?? 0) > 0 ? 'danger' : 'success'}
            />
            <StatTile label="Warnings" value={summary.data.bySeverity.find((row) => row.severity === 'WARNING')?.count ?? 0} icon="warning-outline" tone="warning" />
          </Row>

          <Section title="Most frequent actions">
            <Card>
              <BarChart
                data={summary.data.byAction.slice(0, 6).map((row) => ({ label: humanize(row.action), value: row.count }))}
                valueFormatter={(value) => formatNumber(value)}
              />
            </Card>
          </Section>

          {summary.data.mostActiveUsers.length ? (
            <Section title="Most active accounts">
              <Card>
                {summary.data.mostActiveUsers.map((entry) => (
                  <Pressable
                    key={entry.userId}
                    onPress={() => {
                      setActorId(entry.userId);
                      router.setParams({ actorId: entry.userId });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter the trail on ${entry.name}`}
                  >
                    <Row justify="space-between" style={{ marginBottom: 6 }}>
                      <View style={{ flex: 1 }}>
                        <Tiny style={{ fontWeight: '600' }}>{entry.name}</Tiny>
                        <Tiny tone="faint">{entry.email}</Tiny>
                      </View>
                      <Badge label={`${entry.count}`} tone="neutral" compact />
                    </Row>
                  </Pressable>
                ))}
              </Card>
            </Section>
          ) : null}
        </>
      ) : null}

      {actorId ? (
        <Row justify="space-between" style={{ marginBottom: 10 }}>
          <Caption tone="muted">
            Showing actions by {actorName ? `${actorName.firstName} ${actorName.lastName}` : 'the selected account'}.
          </Caption>
          <Button
            size="sm"
            variant="ghost"
            label="Clear"
            onPress={() => {
              setActorId(null);
              router.setParams({ actorId: undefined });
            }}
          />
        </Row>
      ) : null}

      <SearchBar value={search} onChangeText={setSearch} placeholder="Search the description…" />

      <View style={{ marginVertical: 10, gap: 8 }}>
        <Row gap={6} wrap>
          <Chip label="All severities" selected={severity === 'ALL'} onPress={() => setSeverity('ALL')} />
          {SEVERITIES.map((value) => (
            <Chip key={value} label={humanize(value)} selected={severity === value} onPress={() => setSeverity(value)} />
          ))}
        </Row>
        <Row gap={6} wrap>
          <Chip label="All actions" selected={action === 'ALL'} onPress={() => setAction('ALL')} />
          {COMMON_ACTIONS.map((value) => (
            <Chip key={value} label={humanize(value)} selected={action === value} onPress={() => setAction(value)} />
          ))}
        </Row>
        <Row gap={8}>
          <TextField label="Entity type" value={entityType} onChangeText={setEntityType} placeholder="ExploitationPermit" style={{ flex: 1 }} />
          <TextField label="From" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" style={{ flex: 1 }} />
          <TextField label="To" value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" style={{ flex: 1 }} />
        </Row>
      </View>

      {audit.isLoading ? (
        <SkeletonList rows={5} />
      ) : audit.isError ? (
        <ErrorState error={audit.error} onRetry={() => audit.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="list-outline"
          title={activeFilters || search ? 'Nothing matches these filters' : 'The trail is empty'}
          description={
            activeFilters || search
              ? 'Widen the period or clear a filter to see more entries.'
              : 'Audited actions appear here as soon as anyone uses FEMS.'
          }
          actionLabel={activeFilters || search ? 'Clear filters' : undefined}
          onAction={() => {
            setSeverity('ALL');
            setAction('ALL');
            setEntityType('');
            setFrom('');
            setTo('');
            setSearch('');
            setActorId(null);
          }}
        />
      ) : (
        filtered.map((entry: AuditEntry) => {
          const open = expanded === entry.id;
          const hasDiff = Boolean(entry.before && Object.keys(entry.before).length) || Boolean(entry.after && Object.keys(entry.after).length);
          return (
            <Pressable
              key={entry.id}
              onPress={() => setExpanded(open ? null : entry.id)}
              accessibilityRole="button"
              accessibilityLabel={`${humanize(entry.action)} — ${entry.description}`}
              accessibilityState={{ expanded: open }}
              style={({ pressed }) => ({ marginBottom: 8, opacity: pressed ? 0.9 : 1 })}
            >
              <Card>
                <Row justify="space-between" style={{ marginBottom: 4 }}>
                  <Row gap={8}>
                    <Badge label={humanize(entry.action)} tone={SEVERITY_TONE[entry.severity]} compact />
                    {entry.entityType ? <Tiny tone="faint">{entry.entityType}</Tiny> : null}
                  </Row>
                  <Tiny tone="faint">{formatRelative(entry.createdAt, 'en')}</Tiny>
                </Row>
                <Body lines={open ? undefined : 2}>{entry.description}</Body>
                <Tiny tone="faint" style={{ marginTop: 6 }}>
                  {entry.actor ? `${entry.actor.firstName} ${entry.actor.lastName}` : entry.actorEmail ?? 'system'}
                  {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
                  {` · ${formatDateTime(entry.createdAt, 'en')}`}
                </Tiny>
                {open ? (
                  <>
                    {hasDiff ? (
                      <>
                        <Overline style={{ marginTop: 10 }}>Change</Overline>
                        <Diff before={entry.before} after={entry.after} />
                      </>
                    ) : (
                      <Tiny tone="faint" style={{ marginTop: 8 }}>
                        This action recorded no field-level change.
                      </Tiny>
                    )}
                    {entry.userAgent ? (
                      <Tiny tone="faint" style={{ marginTop: 8 }} lines={2}>
                        {entry.userAgent}
                      </Tiny>
                    ) : null}
                    <Tiny tone="faint" style={{ marginTop: 8 }}>
                      Entry {entry.id} — the audit trail is append-only; FEMS offers no way to edit or delete an entry.
                    </Tiny>
                  </>
                ) : hasDiff ? (
                  <Tiny style={{ color: theme.colors.primary, marginTop: 6 }}>Tap to see the recorded change</Tiny>
                ) : null}
              </Card>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}
