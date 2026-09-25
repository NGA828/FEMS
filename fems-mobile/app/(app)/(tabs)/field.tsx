/**
 * Field hub.
 *
 * The working surface for inspectors, operators and company crews: what is
 * assigned to me, what is currently running, what is still queued on the device
 * and the capture shortcuts. Every list is a scoped API query (`mine=true` for
 * inspections, the caller's company for activities), so the hub shows the same
 * records the server will accept a submission against.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActivities, useEquipment, useInspections, useObservations } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useOfflineQueue } from '../../../src/hooks/useOfflineQueue';
import { useNetworkStatus } from '../../../src/hooks/useNetworkStatus';
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
  Row,
  Section,
  SkeletonList,
  StatTile,
  StatusPill,
  Tiny,
  Title,
} from '../../../src/ui';
import {
  activityStatusLabel,
  activityTypeLabel,
  equipmentStatusLabel,
  formatRelative,
  formatVolume,
  inspectionStatusLabel,
  inspectionTypeLabel,
  observationCategoryLabel,
  severityLabel,
} from '../../../src/lib/format';

type TabKey = 'inspections' | 'activities' | 'observations';

export default function FieldScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, hasPermission } = useAuth();
  const network = useNetworkStatus();
  const queue = useOfflineQueue();
  const [tab, setTab] = useState<TabKey>('inspections');

  const context = useMemo(() => roleContext(user, hasPermission), [user, hasPermission]);
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  // `mine=true` narrows the register to the caller's own inspections; the API
  // applies the same filter for inspectors and operators.
  const inspections = useInspections({ mine: 'true', limit: 10 });
  const activities = useActivities({ limit: 10 });
  const observations = useObservations({ limit: 10 });
  const equipment = useEquipment({ limit: 6 });

  const canCaptureActivity = hasPermission('exploitation:create');
  const canCaptureObservation = hasPermission('observations:create');

  const refreshing = inspections.isRefetching || activities.isRefetching || observations.isRefetching || queue.syncing;

  const refreshAll = () => {
    void inspections.refetch();
    void activities.refetch();
    void observations.refetch();
    void equipment.refetch();
    if (!network.offline && queue.pending > 0) void queue.sync();
  };

  const openInspections = (inspections.data?.items ?? []).filter((inspection) => inspection.status === 'SCHEDULED' || inspection.status === 'IN_PROGRESS');
  const runningActivities = (activities.data?.items ?? []).filter((activity) => activity.status === 'IN_PROGRESS' || activity.status === 'SCHEDULED');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: theme.tabBarHeight + 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />}
    >
      <Row justify="space-between" align="flex-start" style={{ marginBottom: 14 }}>
        <View style={{ flex: 1 }}>
          <Title>Field work</Title>
          <Caption tone="muted">
            {context.isCompanyAccount ? `${user?.company?.name} operations` : 'Inspections, activities and observations'}
          </Caption>
        </View>
        <Button label="Queue" size="sm" variant="secondary" icon="cloud-upload-outline" onPress={() => router.push('/sync')} />
      </Row>

      {queue.pending > 0 ? (
        <View style={{ marginBottom: 14 }}>
          <Notice tone="warning" title={`${queue.pending} record(s) waiting on this device`}>
            {network.offline
              ? 'Captured offline. They will be sent automatically when the API is reachable.'
              : 'The API is reachable — synchronise now to send them.'}
          </Notice>
          <Row gap={8} style={{ marginTop: 8 }}>
            <Button label="Synchronise" size="sm" icon="cloud-upload-outline" loading={queue.syncing} onPress={() => void queue.sync()} />
          </Row>
        </View>
      ) : null}

      <Row gap={10} wrap style={{ marginBottom: 16 }}>
        <StatTile label="Open inspections" value={openInspections.length} icon="clipboard-outline" tone={openInspections.length ? 'warning' : 'success'} onPress={() => router.push('/inspection')} />
        <StatTile label="Running activities" value={runningActivities.length} icon="cube-outline" tone="accent" onPress={() => router.push('/activity')} />
        <StatTile label="Field observations" value={observations.data?.meta?.total ?? 0} icon="eye-outline" onPress={() => router.push('/observation')} />
        <StatTile label="Queued offline" value={queue.pending} icon="cloud-upload-outline" tone={queue.pending ? 'danger' : 'success'} onPress={() => router.push('/sync')} />
      </Row>

      <Section title="Capture">
        <Row gap={10} wrap>
          {canCaptureActivity ? (
            <Pressable
              onPress={() => router.push('/activity/capture')}
              accessibilityRole="button"
              accessibilityLabel="Capture an exploitation activity"
              style={({ pressed }) => ({ flexGrow: 1, flexBasis: 150, opacity: pressed ? 0.85 : 1 })}
            >
              <Card>
                <Ionicons name="walk-outline" size={22} color={theme.colors.primary} />
                <Body style={{ fontWeight: '700', marginTop: 8 }}>Activity</Body>
                <Caption tone="muted">Harvest, transport, survey — with the device GPS</Caption>
              </Card>
            </Pressable>
          ) : null}
          {canCaptureObservation ? (
            <Pressable
              onPress={() => router.push('/observation/new')}
              accessibilityRole="button"
              accessibilityLabel="Record a field observation"
              style={({ pressed }) => ({ flexGrow: 1, flexBasis: 150, opacity: pressed ? 0.85 : 1 })}
            >
              <Card>
                <Ionicons name="camera-outline" size={22} color={theme.colors.primary} />
                <Body style={{ fontWeight: '700', marginTop: 8 }}>Observation</Body>
                <Caption tone="muted">Finding, photo and position</Caption>
              </Card>
            </Pressable>
          ) : null}
          {hasPermission('inspections:create') ? (
            <Pressable
              onPress={() => router.push('/inspection/new')}
              accessibilityRole="button"
              accessibilityLabel="Schedule an inspection"
              style={({ pressed }) => ({ flexGrow: 1, flexBasis: 150, opacity: pressed ? 0.85 : 1 })}
            >
              <Card>
                <Ionicons name="calendar-outline" size={22} color={theme.colors.primary} />
                <Body style={{ fontWeight: '700', marginTop: 8 }}>Inspection</Body>
                <Caption tone="muted">Schedule a visit and assign an inspector</Caption>
              </Card>
            </Pressable>
          ) : null}
          {hasPermission('equipment:read') ? (
            <Pressable
              onPress={() => router.push('/equipment')}
              accessibilityRole="button"
              accessibilityLabel="Equipment register"
              style={({ pressed }) => ({ flexGrow: 1, flexBasis: 150, opacity: pressed ? 0.85 : 1 })}
            >
              <Card>
                <Ionicons name="construct-outline" size={22} color={theme.colors.primary} />
                <Body style={{ fontWeight: '700', marginTop: 8 }}>Equipment</Body>
                <Caption tone="muted">Machines and their usage</Caption>
              </Card>
            </Pressable>
          ) : null}
        </Row>
      </Section>

      <Row gap={8} style={{ marginBottom: 12 }}>
        <Chip label="Inspections" selected={tab === 'inspections'} onPress={() => setTab('inspections')} />
        <Chip label="Activities" selected={tab === 'activities'} onPress={() => setTab('activities')} />
        <Chip label="Observations" selected={tab === 'observations'} onPress={() => setTab('observations')} />
      </Row>

      {tab === 'inspections' ? (
        <Section
          title="Assigned to me"
          action={
            <Pressable onPress={() => router.push('/inspection')} accessibilityRole="button" accessibilityLabel="Open the inspection register">
              <Caption tone="primary" style={{ fontWeight: '700' }}>
                Register
              </Caption>
            </Pressable>
          }
        >
          {inspections.isLoading ? (
            <SkeletonList rows={3} />
          ) : inspections.isError ? (
            <ErrorState error={inspections.error} onRetry={() => inspections.refetch()} />
          ) : (inspections.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon="clipboard-outline"
              title="Nothing assigned"
              description="When an officer assigns you an inspection it appears here with its checklist and GPS requirements."
            />
          ) : (
            (inspections.data?.items ?? []).map((inspection) => (
              <Pressable
                key={inspection.id}
                onPress={() => router.push({ pathname: '/inspection/[id]', params: { id: inspection.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Inspection ${inspection.reference}`}
                style={({ pressed }) => ({ marginBottom: 10, opacity: pressed ? 0.85 : 1 })}
              >
                <Card>
                  <Row justify="space-between" style={{ marginBottom: 4 }}>
                    <Body style={{ fontWeight: '700' }}>{inspection.reference}</Body>
                    <StatusPill status={inspection.status} label={inspectionStatusLabel(inspection.status, language)} />
                  </Row>
                  <Caption tone="muted" lines={1}>
                    {inspectionTypeLabel(inspection.type, language)} · {inspection.title}
                  </Caption>
                  <Row gap={10} style={{ marginTop: 6 }} wrap>
                    <Tiny tone="faint">{inspection.forest?.name}</Tiny>
                    {inspection.scheduledFor ? <Tiny tone="faint">· due {formatRelative(inspection.scheduledFor, language)}</Tiny> : null}
                    {inspection.company ? <Tiny tone="faint">· {inspection.company.name}</Tiny> : null}
                  </Row>
                </Card>
              </Pressable>
            ))
          )}
        </Section>
      ) : null}

      {tab === 'activities' ? (
        <Section
          title={context.isCompanyAccount ? 'Company activities' : 'Recent activities'}
          action={
            <Pressable onPress={() => router.push('/activity')} accessibilityRole="button" accessibilityLabel="Open the activity register">
              <Caption tone="primary" style={{ fontWeight: '700' }}>
                Register
              </Caption>
            </Pressable>
          }
        >
          {activities.isLoading ? (
            <SkeletonList rows={3} />
          ) : activities.isError ? (
            <ErrorState error={activities.error} onRetry={() => activities.refetch()} />
          ) : (activities.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon="cube-outline"
              title="No activity recorded"
              description="Activities are always declared against an active permit; capture one with the device GPS from the shortcut above."
              actionLabel={canCaptureActivity ? 'Capture an activity' : undefined}
              onAction={canCaptureActivity ? () => router.push('/activity/capture') : undefined}
            />
          ) : (
            (activities.data?.items ?? []).map((activity) => (
              <Pressable
                key={activity.id}
                onPress={() => router.push({ pathname: '/activity/[id]', params: { id: activity.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Activity ${activity.reference}`}
                style={({ pressed }) => ({ marginBottom: 10, opacity: pressed ? 0.85 : 1 })}
              >
                <Card>
                  <Row justify="space-between" style={{ marginBottom: 4 }}>
                    <Body style={{ fontWeight: '700' }}>{activity.reference}</Body>
                    <StatusPill status={activity.status} label={activityStatusLabel(activity.status, language)} />
                  </Row>
                  <Caption tone="muted" lines={1}>
                    {activityTypeLabel(activity.activityType, language)} · {activity.permit?.permitNumber} · {activity.forest?.name}
                  </Caption>
                  <Row justify="space-between" style={{ marginTop: 6 }}>
                    <Tiny tone="faint">
                      harvested {formatVolume(activity.harvestedVolumeM3 ?? 0, language)} / {formatVolume(activity.plannedVolumeM3, language)}
                    </Tiny>
                    {activity.syncStatus && activity.syncStatus !== 'SYNCED' ? <Badge label={activity.syncStatus} tone="warning" compact /> : null}
                    {activity.gpsSource ? <Badge label={activity.gpsSource === 'DEVICE_GPS' ? 'device GPS' : activity.gpsSource} tone="info" compact /> : null}
                  </Row>
                </Card>
              </Pressable>
            ))
          )}
        </Section>
      ) : null}

      {tab === 'observations' ? (
        <Section
          title="Recent observations"
          action={
            <Pressable onPress={() => router.push('/observation')} accessibilityRole="button" accessibilityLabel="Open the observation register">
              <Caption tone="primary" style={{ fontWeight: '700' }}>
                Register
              </Caption>
            </Pressable>
          }
        >
          {observations.isLoading ? (
            <SkeletonList rows={3} />
          ) : observations.isError ? (
            <ErrorState error={observations.error} onRetry={() => observations.refetch()} />
          ) : (observations.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon="eye-outline"
              title="No observation recorded"
              description="Observations document what was seen in the field: tree condition, encroachment, water bodies, wildlife."
              actionLabel={canCaptureObservation ? 'Record an observation' : undefined}
              onAction={canCaptureObservation ? () => router.push('/observation/new') : undefined}
            />
          ) : (
            (observations.data?.items ?? []).map((observation) => (
              <Pressable
                key={observation.id}
                onPress={() => router.push({ pathname: '/observation/[id]', params: { id: observation.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Observation ${observation.title}`}
                style={({ pressed }) => ({ marginBottom: 10, opacity: pressed ? 0.85 : 1 })}
              >
                <Card>
                  <Row justify="space-between" style={{ marginBottom: 4 }}>
                    <Body style={{ fontWeight: '600', flex: 1 }} lines={1}>
                      {observation.title}
                    </Body>
                    {observation.severity ? <Badge label={severityLabel(observation.severity, language)} tone="warning" /> : null}
                  </Row>
                  <Caption tone="muted" lines={2}>
                    {observationCategoryLabel(observation.category, language)} · {observation.description}
                  </Caption>
                  <Tiny tone="faint" style={{ marginTop: 4 }}>
                    {observation.forest?.name} · captured {formatRelative(observation.capturedAt, language)} · {observation.gpsSource ?? 'GPS'}
                  </Tiny>
                </Card>
              </Pressable>
            ))
          )}
        </Section>
      ) : null}

      {equipment.data && equipment.data.items.length > 0 ? (
        <Section
          title="Equipment"
          action={
            <Pressable onPress={() => router.push('/equipment')} accessibilityRole="button" accessibilityLabel="Open the equipment register">
              <Caption tone="primary" style={{ fontWeight: '700' }}>
                All equipment
              </Caption>
            </Pressable>
          }
        >
          <Card padded={false}>
            {equipment.data.items.slice(0, 5).map((item, index) => (
              <View
                key={item.id}
                style={{
                  padding: 14,
                  borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.border,
                }}
              >
                <Row justify="space-between">
                  <Body style={{ fontWeight: '600' }} lines={1}>
                    {item.name}
                  </Body>
                  <Badge label={equipmentStatusLabel(item.status, language)} tone={item.status === 'AVAILABLE' ? 'success' : item.status === 'IN_USE' ? 'info' : 'warning'} />
                </Row>
                <Caption tone="muted">
                  {item.registrationNumber ?? 'no plate'} · {item._count?.usage ?? 0} usage record(s)
                </Caption>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}
    </ScrollView>
  );
}
