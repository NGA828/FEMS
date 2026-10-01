/**
 * Settings.
 *
 * Delivery preferences per notification event, and the state of everything FEMS
 * depends on: the payment provider, the AI provider, the mail/SMS transport and
 * the database behind the API. Each integration reports what it really is — a
 * provider that has no credentials says so instead of pretending to work.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { ApiError } from '../../../src/api/client';
import { apiConfig } from '../../../src/api/config';
import type { NotificationPreference, NotificationType } from '../../../src/api/types';
import {
  useAiStatus,
  useGisStatistics,
  useHealthCheck,
  useIntegrations,
  useNotificationPreferences,
  usePaymentProvider,
  useSendTestEmail,
  useUpdateNotificationPreference,
} from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { formatNumber, humanize, notificationTypeLabel } from '../../../src/lib/format';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  ChecklistToggle,
  Definition,
  ErrorState,
  Notice,
  Overline,
  PageHeader,
  Row,
  Screen,
  Section,
  SkeletonList,
  TextField,
  Tiny,
  useToast,
} from '../../../src/ui';

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { user, refreshUser, devWarnings, hasPermission, hasAnyPermission } = useAuth();

  const preferences = useNotificationPreferences();
  const updatePreference = useUpdateNotificationPreference();
  const provider = usePaymentProvider();
  const ai = useAiStatus();
  const health = useHealthCheck();
  const gis = useGisStatistics();

  // Integration status is administrator-only on the server; do not fire the
  // request (and a guaranteed 403) for an account that cannot read it.
  const canReadIntegrations = hasAnyPermission('settings:read', 'settings:manage');
  const canMonitor = hasAnyPermission('system:monitor', 'system:health', 'settings:manage');
  const canManageSettings = hasPermission('settings:manage');
  const integrations = useIntegrations(true, canReadIntegrations);
  const sendTestEmail = useSendTestEmail();

  const mail = (integrations.data?.integrations ?? []).find((entry) => entry.key === 'mail');
  const [testRecipient, setTestRecipient] = useState('');

  const runMailTest = async () => {
    try {
      const result = await sendTestEmail.mutateAsync(testRecipient.trim() || undefined);
      if (result.status === 'SENT') {
        toast.success('Test email sent', result.message);
      } else {
        toast.error('The email was not delivered', result.error ?? result.message);
      }
    } catch (error) {
      toast.error('Could not send the test email', error instanceof ApiError ? error.message : undefined);
    }
  };

  const integrationTone = (state: string): 'success' | 'warning' | 'danger' | 'neutral' => {
    if (state === 'READY') return 'success';
    if (state === 'UNREACHABLE') return 'danger';
    if (state === 'MISCONFIGURED') return 'warning';
    return 'neutral';
  };

  const [busyType, setBusyType] = useState<NotificationType | null>(null);

  const applyPreference = async (preference: NotificationPreference, channel: 'inAppEnabled' | 'pushEnabled' | 'emailEnabled', value: boolean) => {
    setBusyType(preference.type);
    try {
      await updatePreference.mutateAsync({ ...preference, [channel]: value });
    } catch (error) {
      toast.error('Could not save the preference', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusyType(null);
    }
  };

  return (
    <Screen refresh={health.isRefetching ? { refreshing: true, onRefresh: () => health.refetch() } : undefined}>
      <PageHeader title="Settings" subtitle="Delivery, integrations and system state" onBack={() => router.back()} />

      <Section title="Notification delivery">
        <Caption tone="muted" style={{ marginBottom: 8 }}>
          FEMS always records a notification in the app; these switches decide what else is delivered for each event type.
        </Caption>
        {preferences.isLoading ? <SkeletonList rows={3} /> : null}
        {preferences.isError ? <ErrorState error={preferences.error} onRetry={() => preferences.refetch()} /> : null}
        {(preferences.data ?? []).map((preference) => (
          <Card key={preference.type} style={{ marginBottom: 8 }}>
            <Row justify="space-between" style={{ marginBottom: 6 }}>
              <Body style={{ fontWeight: '600', flex: 1 }}>{notificationTypeLabel(preference.type)}</Body>
              {busyType === preference.type ? <Badge label="saving…" tone="neutral" compact /> : null}
            </Row>
            <Row justify="space-between" align="center" style={{ paddingVertical: 6 }}>
              <View style={{ flex: 1 }}>
                <Body>In-app</Body>
                <Caption tone="muted">Always on — the notification feed inside FEMS.</Caption>
              </View>
              <Badge label="always on" tone="neutral" compact />
            </Row>
            <ChecklistToggle
              label="Push"
              description="Sent to the devices registered for this account."
              value={preference.pushEnabled}
              onChange={(value) => void applyPreference(preference, 'pushEnabled', value)}
            />
            <ChecklistToggle
              label="Email"
              description="Sent to the account email address."
              value={preference.emailEnabled}
              onChange={(value) => void applyPreference(preference, 'emailEnabled', value)}
            />
          </Card>
        ))}
      </Section>

      {canReadIntegrations ? (
        <Section title="Email delivery">
          {integrations.isLoading ? (
            <Tiny tone="faint">Checking the mail transport…</Tiny>
          ) : integrations.isError ? (
            <ErrorState error={integrations.error} onRetry={() => integrations.refetch()} />
          ) : mail ? (
            <Card>
              <Row justify="space-between" style={{ marginBottom: 8 }}>
                <Body style={{ fontWeight: '700', flex: 1 }}>{mail.label}</Body>
                <Badge label={humanize(mail.state)} tone={integrationTone(mail.state)} />
              </Row>
              <Definition label="Host" value={mail.details.host ? `${mail.details.host}:${mail.details.port}` : 'not set'} tone={mail.details.host ? undefined : 'warning'} />
              <Definition label="Encryption" value={mail.details.secure ? 'implicit TLS (465)' : 'STARTTLS (587)'} />
              <Definition label="Account" value={(mail.details.username as string) ?? 'unauthenticated relay'} />
              <Definition label="Password" value={mail.details.passwordSet ? 'set' : 'not set'} tone={mail.details.passwordSet ? undefined : 'warning'} />
              <Definition label="Sends as" value={(mail.details.from as string) ?? '—'} />
              {mail.missing.length ? (
                <Notice tone="warning" title="Missing configuration">
                  Set {mail.missing.join(', ')} in fems-backend/.env and restart the API. Until then FEMS sends no verification code,
                  no password-reset code and no notification email — it reports the failure instead of pretending to deliver.
                </Notice>
              ) : (
                <Caption tone="muted" style={{ marginTop: 6 }}>
                  {mail.summary}
                </Caption>
              )}

              {canManageSettings && mail.state !== 'DISABLED' ? (
                <View style={{ marginTop: 12 }}>
                  <TextField
                    label="Send a test to"
                    value={testRecipient}
                    onChangeText={setTestRecipient}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    placeholder={user?.email ?? 'name@example.com'}
                    help="Leave empty to send the test to your own account address."
                  />
                  <Button
                    label="Send test email"
                    icon="mail-outline"
                    variant="secondary"
                    loading={sendTestEmail.isPending}
                    onPress={() => void runMailTest()}
                  />
                </View>
              ) : null}
            </Card>
          ) : (
            <Card>
              <Caption tone="muted">The mail transport state could not be read.</Caption>
            </Card>
          )}
        </Section>
      ) : null}

      {canReadIntegrations && (integrations.data?.integrations.length ?? 0) > 0 ? (
        <Section title="Other integrations">
          <Card>
            {integrations.data?.integrations
              .filter((entry) => entry.key !== 'mail')
              .map((entry) => (
                <View key={entry.key} style={{ marginBottom: 10 }}>
                  <Row justify="space-between" align="center">
                    <Body style={{ fontWeight: '600', flex: 1 }}>{entry.label}</Body>
                    <Badge label={humanize(entry.state)} tone={integrationTone(entry.state)} compact />
                  </Row>
                  <Tiny tone="faint">{entry.summary}</Tiny>
                </View>
              ))}
            <Button
              label="Re-check integrations"
              variant="secondary"
              icon="refresh-outline"
              loading={integrations.isFetching}
              onPress={() => void integrations.refetch()}
            />
          </Card>
        </Section>
      ) : null}

      <Section title="Payments">
        {provider.isLoading ? (
          <Tiny tone="faint">Checking the provider…</Tiny>
        ) : provider.data ? (
          <Card>
            <Row justify="space-between" style={{ marginBottom: 8 }}>
              <Body style={{ fontWeight: '700' }}>{humanize(provider.data.provider)}</Body>
              <Badge label={provider.data.sandbox ? 'sandbox' : 'live'} tone={provider.data.sandbox ? 'warning' : 'success'} />
            </Row>
            <Definition label="Configured" value={provider.data.configured ? 'yes' : 'no'} tone={provider.data.configured ? 'success' : 'warning'} />
            <Definition label="Currency" value={provider.data.currency} />
            <Definition label="Webhook" value={provider.data.webhookConfigured ? 'receiver configured' : 'not configured'} />
            {provider.data.missing?.length ? (
              <Notice tone="warning" title="Missing configuration">
                The provider is not configured: {provider.data.missing.join(', ')}. Mobile payments stay disabled until the environment carries those values —
                FEMS never fakes a provider response.
              </Notice>
            ) : (
              <Caption tone="muted">{provider.data.message}</Caption>
            )}
          </Card>
        ) : (
          <Card>
            <Caption tone="muted">The payment provider state could not be read.</Caption>
          </Card>
        )}
      </Section>

      <Section title="Artificial intelligence">
        {ai.isLoading ? (
          <Tiny tone="faint">Checking the AI service…</Tiny>
        ) : ai.data ? (
          <Card>
            <Row justify="space-between" style={{ marginBottom: 8 }}>
              <Body style={{ fontWeight: '700' }}>{ai.data.provider}</Body>
              <Badge label={ai.data.providerConfigured ? `${ai.data.provider} configured` : 'rule engine only'} tone={ai.data.providerConfigured ? 'success' : 'warning'} />
            </Row>
            <Definition label="Detector" value={ai.data.deterministicEngine.version} />
            <Definition label="Rules in the engine" value={formatNumber(ai.data.deterministicEngine.rules.length)} />
            <Definition label="Alert review SLA" value={`${ai.data.capabilities.alertReviewSlaHours} hours`} />
            <Definition label="Max assistant question" value={`${formatNumber(ai.data.capabilities.maxQuestionLength)} characters`} />
            <Caption tone="muted" style={{ marginTop: 8 }}>
              {ai.data.providerConfigured
                ? `${ai.data.provider} (${ai.data.model}) is configured, so analyses and assistant answers may be written by the model. Every output still requires a human decision.`
                : 'No AI provider key is configured. FEMS runs its deterministic rule engine instead — real findings computed from the database, never invented text.'}
            </Caption>
          </Card>
        ) : (
          <Card>
            <Caption tone="muted">The AI service state could not be read.</Caption>
          </Card>
        )}
      </Section>

      <Section title="System">
        <Card>
          {health.data ? (
            <>
              <Row justify="space-between" style={{ marginBottom: 8 }}>
                <Body style={{ fontWeight: '700' }}>{health.data.service}</Body>
                <Badge label={health.data.status} tone={health.data.status === 'ok' ? 'success' : 'danger'} />
              </Row>
              <Definition label="Version" value={health.data.version} />
              <Definition label="Environment" value={health.data.environment} />
              <Definition label="Database" value={`${health.data.checks.database} (${health.data.checks.databaseLatencyMs} ms)`} tone={health.data.checks.database === 'up' ? 'success' : 'danger'} />
              <Definition label="Uptime" value={`${Math.floor(health.data.uptimeSeconds / 60)} min`} />
            </>
          ) : (
            <Caption tone="muted">{health.isError ? 'The API health endpoint is unreachable.' : 'Reading the service state…'}</Caption>
          )}
          <Definition label="API base" value={apiConfig.baseUrl} tone="muted" />
          <Definition label="App version" value={Constants.expoConfig?.version ?? 'development build'} tone="muted" />
          <Definition
            label="Mail transport"
            value={
              mail
                ? mail.state === 'READY'
                  ? `verified — ${String(mail.details.host ?? '')}`
                  : `${humanize(mail.state).toLowerCase()}${mail.missing.length ? ` (missing ${mail.missing.join(', ')})` : ''}`
                : canReadIntegrations
                  ? 'checking…'
                  : 'visible to administrators only'
            }
            tone={mail ? (mail.state === 'READY' ? 'success' : 'warning') : 'muted'}
          />
        </Card>
        <Row gap={8} wrap style={{ marginTop: 10 }}>
          <Button label="Re-check now" variant="secondary" icon="refresh-outline" loading={health.isRefetching} onPress={() => { void health.refetch(); void provider.refetch(); void ai.refetch(); if (canReadIntegrations) void integrations.refetch(); }} />
          {canMonitor ? (
            <Button label="System monitoring" icon="pulse-outline" onPress={() => router.push('/settings/monitoring')} />
          ) : null}
        </Row>
      </Section>

      {gis.data ? (
        <Section title="Register">
          <Card>
            <Definition label="Forests" value={formatNumber(gis.data.forests)} />
            <Definition label="Zones" value={formatNumber(gis.data.zones)} />
            <Definition label="Recorded field check-ins" value={formatNumber(gis.data.fieldCheckins)} />
            <Definition
              label="Forests without a boundary"
              value={formatNumber(gis.data.forestsWithoutBoundary)}
              tone={gis.data.forestsWithoutBoundary > 0 ? 'warning' : 'success'}
            />
            <Definition
              label="Geographic features"
              value={formatNumber(gis.data.featureCounts.reduce((total, row) => total + row.count, 0))}
            />
          </Card>
        </Section>
      ) : null}

      <Section title="Account">
        <Card>
          <Definition label="Signed in as" value={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`} />
          <Definition label="Email" value={user?.email ?? '—'} />
          <Definition label="Roles" value={user?.roles.map((role) => role.label).join(', ') || '—'} />
          <Definition label="Company" value={user?.company?.name ?? 'not linked'} />
          {user?.preferredLanguage ? <Definition label="Language" value={user.preferredLanguage === 'fr' ? 'Français' : 'English'} tone="muted" /> : null}
        </Card>
        <Row gap={8} wrap style={{ marginTop: 10 }}>
          <Button label="Refresh my session" variant="secondary" icon="refresh-outline" onPress={() => void refreshUser().then(() => toast.success('Session refreshed', 'Roles and permissions re-read from the API.'))} />
          <Button label="My profile" variant="secondary" icon="person-outline" onPress={() => router.push('/profile')} />
        </Row>
      </Section>

      {devWarnings.length ? (
        <Notice tone="warning" title="Development warnings">
          {devWarnings.join(' ')}
        </Notice>
      ) : null}

      <Overline style={{ marginBottom: 6 }}>Documentation</Overline>
      <Card>
        <Row gap={8} style={{ marginBottom: 6 }}>
          <Ionicons name="book-outline" size={16} color={theme.colors.primary} />
          <Tiny style={{ flex: 1 }}>
            The REST contract for every endpoint used by this app is published by the API itself, generated from the running controllers.
          </Tiny>
        </Row>
        <Tiny tone="faint">Open {apiConfig.baseUrl.replace(/\/api\/v1$/, '')}/api/v1/docs while the API is running.</Tiny>
      </Card>
      <View style={{ height: 8 }} />
    </Screen>
  );
}
