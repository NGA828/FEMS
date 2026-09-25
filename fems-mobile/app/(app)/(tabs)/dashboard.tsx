/**
 * Role-aware dashboard.
 *
 * The same screen composes itself from the signed-in account: a government
 * officer sees the decision queue and the compliance picture, a company sees its
 * permits, volumes, balance and payments, a field worker sees assigned
 * inspections and queued captures, and a public account sees the forest register.
 * Every number comes from a statistics endpoint or a scoped list query — nothing
 * is computed from stale local copies.
 */
import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthProvider';
import { canRead } from '../../../src/auth/permissions';
import { roleContext, tabsFor } from '../../../src/navigation/tabs';
import {
  useActivityStatistics,
  useAlertStatistics,
  useForestStatistics,
  useGisStatistics,
  useInspectionStatistics,
  usePaymentStatistics,
  usePermitStatistics,
  usePermits,
  useAlerts,
  useInspections,
  usePayments,
  useViolationStatistics,
  useViolations,
  useUnreadCount,
} from '../../../src/api/queries';
import { useNetworkStatus } from '../../../src/hooks/useNetworkStatus';
import { useOfflineQueue } from '../../../src/hooks/useOfflineQueue';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Divider,
  ErrorState,
  Heading,
  IconButton,
  Row,
  Section,
  Skeleton,
  SkeletonList,
  StatTile,
  StatusPill,
  Title,
  Tiny,
  useTone,
} from '../../../src/ui';
import { riskColor } from '../../../src/theme/tokens';
import {
  alertStatusLabel,
  alertTypeLabel,
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatNumber,
  formatRelative,
  formatVolume,
  fullName,
  inspectionStatusLabel,
  inspectionTypeLabel,
  permitStatusLabel,
  permitTypeLabel,
  paymentPurposeLabel,
  paymentStatusLabel,
  riskLabel,
  severityLabel,
} from '../../../src/lib/format';

export default function DashboardScreen() {
  const theme = useTheme();
  const tone = useTone();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, hasPermission, permissions, canReadAll } = useAuth();
  const network = useNetworkStatus();
  const queue = useOfflineQueue();

  const context = useMemo(() => roleContext(user, hasPermission), [user, hasPermission]);
  const language = (user?.preferredLanguage === 'fr' ? 'fr' : 'en') as 'en' | 'fr';
  const today = new Date();

  // Only the modules this account may read are queried at all.
  const mayReadPermits = canRead(permissions, 'permits');
  const mayReadPayments = canRead(permissions, 'payments') && !roleContext(user, hasPermission).isPublicAccount;
  const mayReadInspections = canRead(permissions, 'inspections');
  const mayReadViolations = canRead(permissions, 'environmental');
  const mayReadAlerts = canRead(permissions, 'aiAlerts');
  const mayReadExploitation = canRead(permissions, 'exploitation');
  const mayReadForests = canRead(permissions, 'forests');
  const mayReadGis = canRead(permissions, 'gis');

  const permitStats = usePermitStatistics();
  const paymentStats = usePaymentStatistics();
  const inspectionStats = useInspectionStatistics();
  const violationStats = useViolationStatistics();
  const alertStats = useAlertStatistics();
  const activityStats = useActivityStatistics();
  const forestStats = useForestStatistics();
  const gisStats = useGisStatistics();
  const unread = useUnreadCount();

  const awaitingMyAction = usePermits({ awaitingMyAction: true, limit: 4 });
  const expiring = usePermits({ expiringWithinDays: 90, limit: 4 });
  const pendingAlerts = useAlerts({ awaitingReview: 'true', limit: 4 });
  const openCases = useViolations({ status: 'OPEN', limit: 4 });
  const myInspections = useInspections({ mine: 'true', limit: 4 });
  const recentPayments = usePayments({ limit: 4 });

  const refreshing =
    permitStats.isRefetching ||
    alertStats.isRefetching ||
    inspectionStats.isRefetching ||
    violationStats.isRefetching ||
    paymentStats.isRefetching ||
    activityStats.isRefetching;

  const refreshAll = () => {
    void Promise.all([
      permitStats.refetch(),
      paymentStats.refetch(),
      inspectionStats.refetch(),
      violationStats.refetch(),
      alertStats.refetch(),
      activityStats.refetch(),
      forestStats.refetch(),
      gisStats.refetch(),
      unread.refetch(),
    ]);
  };

  const greeting = today.getHours() < 12 ? 'Good morning' : today.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const roleLabel = user?.roles?.[0]?.label ?? 'User';
  const tabs = tabsFor(user);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: theme.tabBarHeight + 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />}
    >
      {/* ------------------------------------------------------------- header */}
      <Row justify="space-between" align="flex-start" style={{ marginBottom: 18 }}>
        <View style={{ flex: 1 }}>
          <Caption tone="muted">
            {greeting} · {formatDate(today, language)}
          </Caption>
          <Title lines={1}>{user ? fullName(user) : ''}</Title>
          <Row gap={6} style={{ marginTop: 6 }} wrap>
            <Badge label={roleLabel} tone="primary" icon="shield-checkmark-outline" />
            {user?.company ? <Badge label={user.company.name} tone="accent" icon="business-outline" /> : null}
            {network.offline ? <Badge label="Offline" tone="warning" icon="cloud-offline-outline" /> : <Badge label="Connected" tone="success" icon="cloud-done-outline" />}
            {queue.pending > 0 ? <Badge label={`${queue.pending} queued`} tone="info" icon="cloud-upload-outline" /> : null}
          </Row>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <IconButton
            icon="notifications-outline"
            label="Notifications"
            badge={unread.data?.unread ?? 0}
            onPress={() => router.push('/notifications')}
          />
          <IconButton icon="ellipsis-horizontal" label="All modules" onPress={() => router.push('/modules')} />
        </View>
      </Row>

      {/* --------------------------------------------------------- quick actions */}
      <Section title="Quick actions">
        <Row gap={10} wrap>
          {context.canApplyForPermit ? (
            <Button label="New permit" icon="add-circle-outline" size="sm" onPress={() => router.push('/permit/new')} />
          ) : null}
          {context.canCaptureField ? (
            <Button label="Capture activity" icon="walk-outline" size="sm" variant="secondary" onPress={() => router.push('/activity/capture')} />
          ) : null}
          {mayReadInspections ? (
            <Button label="Inspections" icon="clipboard-outline" size="sm" variant="secondary" onPress={() => router.push('/inspection')} />
          ) : null}
          {context.canReviewAlerts ? (
            <Button label="Alert console" icon="warning-outline" size="sm" variant="secondary" onPress={() => router.push('/alerts')} />
          ) : null}
          {context.canVerifyPayments ? (
            <Button label="Verify payments" icon="card-outline" size="sm" variant="secondary" onPress={() => router.push('/payments')} />
          ) : null}
          {context.canGenerateReports ? (
            <Button label="Reports" icon="bar-chart-outline" size="sm" variant="secondary" onPress={() => router.push('/report')} />
          ) : null}
          {mayReadGis ? <Button label="Map" icon="map-outline" size="sm" variant="secondary" onPress={() => router.push('/map')} /> : null}
          {context.canCaptureField ? (
            <Button label="Sync queue" icon="cloud-upload-outline" size="sm" variant="ghost" onPress={() => router.push('/sync')} />
          ) : null}
        </Row>
      </Section>

      {/* --------------------------------------------------------------- tiles */}
      <Section title={context.isPublicAccount ? 'Forest resources' : 'Operational picture'}>
        {forestStats.isLoading && context.isPublicAccount ? (
          <SkeletonList rows={2} />
        ) : (
          <Row gap={10} wrap>
            {mayReadForests && forestStats.data ? (
              <StatTile
                label="Forests"
                value={formatNumber(forestStats.data.total)}
                hint={`${forestStats.data.byRegion?.length ?? 0} regions · ${forestStats.data.totalAreaHa ? `${formatNumber(forestStats.data.totalAreaHa)} ha` : ''}`}
                icon="leaf-outline"
                onPress={() => router.push('/forests')}
              />
            ) : null}

            {mayReadPermits && permitStats.data ? (
              context.isCompanyAccount ? (
                <>
                  <StatTile
                    label="My permits"
                    value={formatNumber(permitStats.data.total)}
                    hint={`${formatVolume(permitStats.data.totalVolumeApprovedM3, language)} approved`}
                    icon="document-text-outline"
                    onPress={() => router.push('/permits')}
                  />
                  <StatTile
                    label="Fees invoiced"
                    value={formatCurrencyCompact(permitStats.data.totalFeeAmount, 'XAF', language)}
                    hint={`${permitStats.data.byStatus.find((entry) => entry.status === 'PAYMENT_PENDING')?.count ?? 0} awaiting payment`}
                    icon="cash-outline"
                    tone="accent"
                  />
                </>
              ) : (
                <>
                  <StatTile
                    label="Permits"
                    value={formatNumber(permitStats.data.total)}
                    hint={`${permitStats.data.byStatus.find((entry) => entry.status === 'SUBMITTED')?.count ?? 0} submitted · ${
                      permitStats.data.byStatus.find((entry) => entry.status === 'UNDER_REVIEW')?.count ?? 0
                    } under review`}
                    icon="document-text-outline"
                    onPress={() => router.push('/permits')}
                  />
                  <StatTile
                    label="Active"
                    value={formatNumber(permitStats.data.byStatus.find((entry) => entry.status === 'ACTIVE')?.count ?? 0)}
                    hint={`${formatVolume(permitStats.data.totalVolumeApprovedM3, language)} approved`}
                    icon="checkmark-circle-outline"
                    tone="success"
                    onPress={() => router.push({ pathname: '/permits', params: { status: 'ACTIVE' } })}
                  />
                </>
              )
            ) : null}

            {mayReadExploitation && activityStats.data ? (
              <StatTile
                label={context.isCompanyAccount ? 'My harvested volume' : 'Harvested volume'}
                value={formatVolume(activityStats.data.harvestedVolumeM3, language)}
                hint={
                  activityStats.data.plannedVolumeM3 > 0
                    ? `${activityStats.data.total} activities · ${Math.round(
                        (activityStats.data.harvestedVolumeM3 / activityStats.data.plannedVolumeM3) * 100,
                      )}% of the declared plan`
                    : `${activityStats.data.total} activities recorded`
                }
                icon="cube-outline"
                tone="accent"
                onPress={() => router.push('/activity')}
              />
            ) : null}

            {mayReadAlerts && alertStats.data ? (
              <StatTile
                label="Alerts awaiting review"
                value={formatNumber(alertStats.data.awaitingReview)}
                hint={`${alertStats.data.overdueReview} past the ${alertStats.data.reviewSlaHours}h SLA`}
                icon="warning-outline"
                tone={alertStats.data.overdueReview > 0 ? 'danger' : 'warning'}
                onPress={() => router.push('/alerts')}
              />
            ) : null}

            {mayReadViolations && violationStats.data ? (
              <StatTile
                label="Open cases"
                value={formatNumber(violationStats.data.openCases)}
                hint={`${formatCurrencyCompact(violationStats.data.penalties.outstandingXAF, 'XAF', language)} penalties outstanding`}
                icon="alert-circle-outline"
                tone={violationStats.data.openCases > 0 ? 'danger' : 'success'}
                onPress={() => router.push('/violation')}
              />
            ) : null}

            {mayReadPayments && paymentStats.data && !context.isPublicAccount ? (
              <StatTile
                label={context.isCompanyAccount ? 'My payments' : 'Payments'}
                value={formatCurrencyCompact(paymentStats.data.totalAmount, 'XAF', language)}
                hint={`${paymentStats.data.byStatus.find((entry) => entry.status === 'SUCCESSFUL')?.count ?? 0} settled · ${
                  paymentStats.data.byStatus.find((entry) => entry.status === 'PENDING')?.count ?? 0
                } pending`}
                icon="card-outline"
                tone="accent"
                onPress={() => router.push('/payments')}
              />
            ) : null}

            {mayReadInspections && inspectionStats.data ? (
              <StatTile
                label="Inspections"
                value={formatNumber(inspectionStats.data.total)}
                hint={`average compliance ${Math.round(inspectionStats.data.averageComplianceScore)}%`}
                icon="clipboard-outline"
                tone="info"
                onPress={() => router.push('/inspection')}
              />
            ) : null}

            {mayReadGis && gisStats.data ? (
              <StatTile
                label="Mapped features"
                value={formatNumber(gisStats.data.featureCounts.reduce((total, entry) => total + entry.count, 0))}
                hint={`${gisStats.data.fieldCheckins} field check-ins`}
                icon="map-outline"
                onPress={() => router.push('/map')}
              />
            ) : null}
          </Row>
        )}
      </Section>

      {/* ------------------------------------------------------- work in progress */}
      {context.canDecidePermit ? (
        <Section
          title="Awaiting your decision"
          action={
            <Pressable onPress={() => router.push('/permits')} accessibilityRole="button" accessibilityLabel="Open permit register">
              <Caption tone="primary" style={{ fontWeight: '700' }}>
                Open register
              </Caption>
            </Pressable>
          }
        >
          {awaitingMyAction.isLoading ? (
            <SkeletonList rows={2} />
          ) : awaitingMyAction.isError ? (
            <ErrorState error={awaitingMyAction.error} onRetry={() => awaitingMyAction.refetch()} />
          ) : (awaitingMyAction.data?.items.length ?? 0) === 0 ? (
            <Card>
              <Row gap={10}>
                <Ionicons name="checkmark-done-outline" size={22} color={theme.colors.success} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '600' }}>Nothing is waiting on you</Body>
                  <Caption tone="muted">No permit has reached a step that requires your decision.</Caption>
                </View>
              </Row>
            </Card>
          ) : (
            <Card padded={false}>
              {awaitingMyAction.data?.items.map((permit, index) => (
                <Pressable
                  key={permit.id}
                  onPress={() => router.push({ pathname: '/permit/[id]', params: { id: permit.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Permit ${permit.permitNumber}`}
                  style={({ pressed }) => ({
                    padding: 14,
                    backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: tone.colors.border,
                  })}
                >
                  <Row justify="space-between" style={{ marginBottom: 4 }}>
                    <Body style={{ fontWeight: '700' }}>{permit.permitNumber}</Body>
                    <StatusPill status={permit.status} label={permitStatusLabel(permit.status, language)} />
                  </Row>
                  <Caption tone="muted" lines={1}>
                    {permit.title}
                  </Caption>
                  <Row gap={8} style={{ marginTop: 6 }} wrap>
                    <Tiny tone="faint">{permit.company?.name}</Tiny>
                    <Tiny tone="faint">·</Tiny>
                    <Tiny tone="faint">{permit.forest?.name}</Tiny>
                    <Tiny tone="faint">·</Tiny>
                    <Tiny tone="faint">{formatVolume(permit.volumeRequestedM3, language)}</Tiny>
                  </Row>
                </Pressable>
              ))}
            </Card>
          )}
        </Section>
      ) : null}

      {context.canReviewAlerts ? (
        <Section
          title="Alerts awaiting human review"
          action={
            <Pressable onPress={() => router.push('/alerts')} accessibilityRole="button" accessibilityLabel="Open alert console">
              <Caption tone="primary" style={{ fontWeight: '700' }}>
                Console
              </Caption>
            </Pressable>
          }
        >
          {pendingAlerts.isLoading ? (
            <SkeletonList rows={2} />
          ) : pendingAlerts.isError ? (
            <ErrorState error={pendingAlerts.error} onRetry={() => pendingAlerts.refetch()} />
          ) : (pendingAlerts.data?.items.length ?? 0) === 0 ? (
            <Card>
              <Row gap={10}>
                <Ionicons name="shield-checkmark-outline" size={22} color={theme.colors.success} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '600' }}>No alert is waiting for a reviewer</Body>
                  <Caption tone="muted">The rule engine has no unreviewed signal in your scope.</Caption>
                </View>
              </Row>
            </Card>
          ) : (
            <Card padded={false}>
              {pendingAlerts.data?.items.map((alert, index) => {
                const palette = riskColor(tone, alert.riskLevel);
                return (
                  <Pressable
                    key={alert.id}
                    onPress={() => router.push({ pathname: '/alert/[id]', params: { id: alert.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={`Alert ${alert.reference}`}
                    style={({ pressed }) => ({
                      padding: 14,
                      backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
                      borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: tone.colors.border,
                    })}
                  >
                    <Row justify="space-between" style={{ marginBottom: 4 }}>
                      <Badge label={riskLabel(alert.riskLevel, language)} tone={alert.riskLevel === 'CRITICAL' ? 'danger' : alert.riskLevel === 'HIGH' ? 'warning' : 'neutral'} />
                      <Tiny tone="faint">{formatRelative(alert.detectedAt, language)}</Tiny>
                    </Row>
                    <Body style={{ fontWeight: '600' }} lines={2}>
                      {alert.title}
                    </Body>
                    <Row gap={6} style={{ marginTop: 4 }} wrap>
                      <Tiny style={{ color: palette.fg }}>{alertTypeLabel(alert.type, language)}</Tiny>
                      {alert.forest ? <Tiny tone="faint">· {alert.forest.name}</Tiny> : null}
                      {alert.review?.overdue ? <Badge label="SLA breached" tone="danger" compact /> : null}
                    </Row>
                  </Pressable>
                );
              })}
            </Card>
          )}
        </Section>
      ) : null}

      {mayReadInspections && context.isFieldWorker ? (
        <Section
          title="My inspections"
          action={
            <Pressable onPress={() => router.push('/inspection')} accessibilityRole="button" accessibilityLabel="Open inspection list">
              <Caption tone="primary" style={{ fontWeight: '700' }}>
                All inspections
              </Caption>
            </Pressable>
          }
        >
          {myInspections.isLoading ? (
            <SkeletonList rows={2} />
          ) : (myInspections.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon="clipboard-outline"
              title="No inspection assigned to you"
              description="An officer can assign an inspection to you from the inspection register; it then appears here with its checklist."
              actionLabel="Open inspection register"
              onAction={() => router.push('/inspection')}
            />
          ) : (
            <Card padded={false}>
              {myInspections.data?.items.map((inspection, index) => (
                <Pressable
                  key={inspection.id}
                  onPress={() => router.push({ pathname: '/inspection/[id]', params: { id: inspection.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Inspection ${inspection.reference}`}
                  style={({ pressed }) => ({
                    padding: 14,
                    backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: tone.colors.border,
                  })}
                >
                  <Row justify="space-between" style={{ marginBottom: 4 }}>
                    <Body style={{ fontWeight: '700' }}>{inspection.reference}</Body>
                    <StatusPill status={inspection.status} label={inspectionStatusLabel(inspection.status, language)} />
                  </Row>
                  <Caption tone="muted" lines={1}>
                    {inspectionTypeLabel(inspection.type, language)} · {inspection.title}
                  </Caption>
                  <Row gap={8} style={{ marginTop: 6 }} wrap>
                    <Tiny tone="faint">{inspection.forest?.name}</Tiny>
                    {inspection.scheduledFor ? <Tiny tone="faint">· due {formatDate(inspection.scheduledFor, language)}</Tiny> : null}
                  </Row>
                </Pressable>
              ))}
            </Card>
          )}
        </Section>
      ) : null}

      {mayReadPermits && context.isCompanyAccount ? (
        <Section
          title="Permits nearing expiry"
          action={
            <Pressable onPress={() => router.push('/permits')} accessibilityRole="button" accessibilityLabel="Open my permits">
              <Caption tone="primary" style={{ fontWeight: '700' }}>
                My permits
              </Caption>
            </Pressable>
          }
        >
          {expiring.isLoading ? (
            <SkeletonList rows={2} />
          ) : (expiring.data?.items.length ?? 0) === 0 ? (
            <Card>
              <Row gap={10}>
                <Ionicons name="calendar-outline" size={22} color={theme.colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '600' }}>No permit expires in the next 90 days</Body>
                  <Caption tone="muted">Renewals can be requested up to 60 days before expiry.</Caption>
                </View>
              </Row>
            </Card>
          ) : (
            <Card padded={false}>
              {expiring.data?.items.map((permit, index) => (
                <Pressable
                  key={permit.id}
                  onPress={() => router.push({ pathname: '/permit/[id]', params: { id: permit.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Permit ${permit.permitNumber}`}
                  style={({ pressed }) => ({
                    padding: 14,
                    backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  })}
                >
                  <Row justify="space-between">
                    <Body style={{ fontWeight: '700' }}>{permit.permitNumber}</Body>
                    <Badge label={`ends ${formatDate(permit.endDate, language)}`} tone="warning" />
                  </Row>
                  <Caption tone="muted" style={{ marginTop: 2 }} lines={1}>
                    {permitTypeLabel(permit.type, language)} · {permit.forest?.name}
                  </Caption>
                </Pressable>
              ))}
            </Card>
          )}
        </Section>
      ) : null}

      {mayReadViolations && !context.isPublicAccount ? (
        <Section
          title="Open environmental cases"
          action={
            <Pressable onPress={() => router.push('/violation')} accessibilityRole="button" accessibilityLabel="Open case register">
              <Caption tone="primary" style={{ fontWeight: '700' }}>
                Case register
              </Caption>
            </Pressable>
          }
        >
          {openCases.isLoading ? (
            <SkeletonList rows={2} />
          ) : (openCases.data?.items.length ?? 0) === 0 ? (
            <Card>
              <Row gap={10}>
                <Ionicons name="leaf-outline" size={22} color={theme.colors.success} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '600' }}>No open case in your scope</Body>
                  <Caption tone="muted">Cases open from documented field evidence and stay until they are resolved or dismissed.</Caption>
                </View>
              </Row>
            </Card>
          ) : (
            <Card padded={false}>
              {openCases.data?.items.map((violation, index) => (
                <Pressable
                  key={violation.id}
                  onPress={() => router.push({ pathname: '/violation/[id]', params: { id: violation.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Case ${violation.reference}`}
                  style={({ pressed }) => ({
                    padding: 14,
                    backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: tone.colors.border,
                  })}
                >
                  <Row justify="space-between" style={{ marginBottom: 4 }}>
                    <Body style={{ fontWeight: '700' }}>{violation.reference}</Body>
                    <Badge
                      label={severityLabel(violation.severity, language)}
                      tone={violation.severity === 'CRITICAL' ? 'danger' : violation.severity === 'HIGH' ? 'warning' : 'neutral'}
                    />
                  </Row>
                  <Caption tone="muted" lines={2}>
                    {violation.title}
                  </Caption>
                  {violation.penalty && violation.penalty.outstandingXAF > 0 ? (
                    <Tiny style={{ color: theme.colors.danger, marginTop: 4 }}>
                      {formatCurrency(violation.penalty.outstandingXAF, 'XAF', language)} outstanding
                    </Tiny>
                  ) : null}
                </Pressable>
              ))}
            </Card>
          )}
        </Section>
      ) : null}

      {mayReadPayments && !context.isPublicAccount ? (
        <Section
          title={context.isCompanyAccount ? 'My recent payments' : 'Recent payments'}
          action={
            <Pressable onPress={() => router.push('/payments')} accessibilityRole="button" accessibilityLabel="Open payments">
              <Caption tone="primary" style={{ fontWeight: '700' }}>
                All payments
              </Caption>
            </Pressable>
          }
        >
          {recentPayments.isLoading ? (
            <SkeletonList rows={2} />
          ) : (recentPayments.data?.items.length ?? 0) === 0 ? (
            <Card>
              <Row gap={10}>
                <Ionicons name="card-outline" size={22} color={theme.colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '600' }}>No payment recorded yet</Body>
                  <Caption tone="muted">Permit fees, royalties and penalties appear here once they are initiated.</Caption>
                </View>
              </Row>
            </Card>
          ) : (
            <Card padded={false}>
              {recentPayments.data?.items.map((payment, index) => (
                <Pressable
                  key={payment.id}
                  onPress={() => router.push({ pathname: '/payment/[id]', params: { id: payment.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Payment ${payment.reference}`}
                  style={({ pressed }) => ({
                    padding: 14,
                    backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: tone.colors.border,
                  })}
                >
                  <Row justify="space-between" style={{ marginBottom: 4 }}>
                    <Body style={{ fontWeight: '700' }}>{formatCurrency(payment.amount, payment.currency ?? 'XAF', language)}</Body>
                    <StatusPill status={payment.status} label={paymentStatusLabel(payment.status, language)} />
                  </Row>
                  <Caption tone="muted" lines={1}>
                    {paymentPurposeLabel(payment.purpose, language)} · {payment.reference}
                  </Caption>
                  <Tiny tone="faint" style={{ marginTop: 4 }}>
                    {payment.provider ?? '—'} · {formatRelative(payment.createdAt ?? payment.initiatedAt, language)}
                  </Tiny>
                </Pressable>
              ))}
            </Card>
          )}
        </Section>
      ) : null}

      {/* ------------------------------------------------------------ shortcuts */}
      <Section title="All modules">
        <Row gap={10} wrap>
          {tabs.map((tab) => (
            <Pressable
              key={tab.name}
              onPress={() => router.push(tab.href as never)}
              accessibilityRole="button"
              accessibilityLabel={tab.title}
              style={({ pressed }) => ({
                flexGrow: 1,
                flexBasis: 100,
                alignItems: 'center',
                gap: 6,
                paddingVertical: 14,
                borderRadius: tone.radii.lg,
                backgroundColor: pressed ? theme.colors.primarySoft : theme.colors.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
              })}
            >
              <Ionicons name={tab.icon} size={20} color={theme.colors.primary} />
              <Caption style={{ fontWeight: '600' }}>{tab.title}</Caption>
            </Pressable>
          ))}
        </Row>
      </Section>

      <Card>
        <Row gap={10}>
          <Ionicons name="information-circle-outline" size={20} color={theme.colors.info} />
          <View style={{ flex: 1, gap: 2 }}>
            <Body style={{ fontWeight: '600' }}>{canReadAll('permits') ? 'Regulatory scope' : 'Your data scope'}</Body>
            <Caption tone="muted">
              {canReadAll('permits')
                ? 'You see every record your role is entitled to across all companies and forests.'
                : user?.company
                  ? `Your account is attached to ${user.company.name}: registers and totals are limited to that company.`
                  : 'Records are limited to what your role is entitled to read.'}
            </Caption>
          </View>
        </Row>
      </Card>

      <View style={{ height: 24 }} />
      <Tiny tone="faint" style={{ textAlign: 'center' }}>
        FEMS · Ministry of Forestry and Wildlife · data as of {formatRelative(new Date(), language)}
      </Tiny>
    </ScrollView>
  );
}
