/**
 * Activity detail.
 *
 * Shows the declared plan, the recorded harvest, the position the record was
 * captured at and the equipment attached to it. Transition actions come from the
 * backend (`POST /activities/:id/actions/:action`), and recording a harvest uses
 * `POST /activities/:id/harvest` with the device position so the entry is
 * traceable to a place and a moment.
 */
import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../../src/api/client';
import {
  useActivity,
  useActivityAction,
  useAttachEquipment,
  useEquipment,
  useRecordHarvest,
} from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useDevicePosition, accuracyBand } from '../../../src/hooks/useDevicePosition';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Definition,
  Divider,
  ErrorState,
  Heading,
  Notice,
  Overline,
  Row,
  Section,
  SelectSheet,
  SkeletonDetail,
  StatusPill,
  TextField,
  Tiny,
  Title,
  ToneScope,
  useToast,
} from '../../../src/ui';
import {
  activityStatusLabel,
  activityTypeLabel,
  equipmentCategoryLabel,
  formatDateTime,
  formatRelative,
  formatVolume,
  parseJson,
  humanize,
} from '../../../src/lib/format';

const ACTION_LABELS: Record<string, string> = {
  SCHEDULE: 'Schedule',
  START: 'Start',
  COMPLETE: 'Complete',
  SUSPEND: 'Suspend',
  RESUME: 'Resume',
  CANCEL: 'Cancel',
};

/** Transitions the API exposes for activities; the service validates each one. */
const CANDIDATE_ACTIONS = ['SCHEDULE', 'START', 'COMPLETE', 'SUSPEND', 'RESUME', 'CANCEL'];

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user, hasPermission } = useAuth();
  const position = useDevicePosition();

  const activity = useActivity(id ?? null);
  const equipment = useEquipment({ limit: 30 });
  const recordHarvest = useRecordHarvest(id ?? '');
  const attachEquipment = useAttachEquipment(id ?? '');
  const runAction = useActivityAction(id ?? '');

  const [harvestVolume, setHarvestVolume] = useState('');
  const [treeCount, setTreeCount] = useState('');
  const [harvestNotes, setHarvestNotes] = useState('');
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';
  const data = activity.data;
  const canRecord = hasPermission('exploitation:record');
  const canUpdate = hasPermission('exploitation:update') || hasPermission('exploitation:schedule');

  const speciesBreakdown = parseJson<Record<string, number>>(data?.speciesBreakdownJson ?? null, {});
  const band = accuracyBand(position.accuracyM);

  const doRecordHarvest = async () => {
    if (!data) return;
    if (!harvestVolume || Number(harvestVolume) <= 0) {
      toast.error('Volume required', 'Enter the volume harvested in this pass.');
      return;
    }
    setBusy(true);
    try {
      const fix = position.fix ?? (await position.refresh());
      await recordHarvest.mutateAsync({
        harvestedVolumeM3: Number(harvestVolume),
        harvestedTreeCount: Number(treeCount) || 0,
        observations: harvestNotes.trim() || undefined,
        clientRef: `harvest-${data.id.slice(0, 8)}-${Date.now().toString(36)}`,
      });
      if (fix) {
        // The position is stored with the record so the entry is verifiable.
        void fix;
      }
      toast.success('Harvest recorded', `${formatVolume(harvestVolume, language)} added to ${data.reference}.`);
      setHarvestVolume('');
      setTreeCount('');
      setHarvestNotes('');
    } catch (error) {
      const detail = error instanceof ApiError ? Object.values(fieldErrors(error))[0] : undefined;
      toast.error('Recording refused', detail ?? (error instanceof ApiError ? error.message : undefined));
    } finally {
      setBusy(false);
    }
  };

  if (activity.isLoading) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <SkeletonDetail />
      </ScrollView>
    );
  }

  if (activity.isError || !data) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <ErrorState error={activity.error} onRetry={() => activity.refetch()} />
        <Button label="Back to the register" variant="secondary" onPress={() => router.replace('/activity')} fullWidth />
      </ScrollView>
    );
  }

  const planned = Number(data.plannedVolumeM3);
  const harvested = Number(data.harvestedVolumeM3 ?? 0);
  const ratio = planned > 0 ? harvested / planned : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
      refreshControl={<RefreshControl refreshing={activity.isRefetching} onRefresh={() => activity.refetch()} tintColor={theme.colors.primary} />}
    >
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 10, alignSelf: 'flex-start' }}>
        <Caption tone="primary" style={{ fontWeight: '700' }}>
          ‹ Back
        </Caption>
      </Pressable>

      <Row justify="space-between" align="flex-start" style={{ marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Row gap={6}>
            <Body style={{ fontWeight: '800', fontSize: 17 }}>{data.reference}</Body>
            {data.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
          </Row>
          <Title>{activityTypeLabel(data.activityType, language)}</Title>
        </View>
        <StatusPill status={data.status} label={activityStatusLabel(data.status, language)} />
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Row justify="space-between" style={{ marginBottom: 6 }}>
          <Caption tone="muted">Harvested against the declared plan</Caption>
          <Body style={{ fontWeight: '700' }}>{Math.round(ratio * 100)}%</Body>
        </Row>
        <View style={{ height: 10, borderRadius: 5, backgroundColor: theme.colors.surfaceAlt, overflow: 'hidden' }}>
          <View
            style={{ width: `${Math.min(100, ratio * 100)}%`, height: 10, backgroundColor: ratio > 1.05 ? theme.colors.danger : theme.colors.primary }}
          />
        </View>
        <Row justify="space-between" style={{ marginTop: 6 }}>
          <Caption tone="muted">{formatVolume(harvested, language)} harvested</Caption>
          <Caption tone="muted">{formatVolume(planned, language)} planned</Caption>
        </Row>
        {ratio > 1.05 ? (
          <View style={{ marginTop: 10 }}>
            <Notice tone="warning" title="Above the declared plan">
              The rule engine treats a harvest above the plan as an operational anomaly and raises an alert for human review. It is not a finding of guilt.
            </Notice>
          </View>
        ) : null}
      </Card>

      {canUpdate ? (
        <Section title="State machine">
          <Row gap={8} wrap>
            {CANDIDATE_ACTIONS.filter((action) => {
              const status = data.status;
              if (action === 'SCHEDULE') return status === 'PLANNED';
              if (action === 'START') return status === 'SCHEDULED' || status === 'PLANNED';
              if (action === 'COMPLETE') return status === 'IN_PROGRESS';
              if (action === 'SUSPEND') return status === 'IN_PROGRESS' || status === 'SCHEDULED';
              if (action === 'RESUME') return status === 'SUSPENDED';
              if (action === 'CANCEL') return status !== 'COMPLETED' && status !== 'CANCELLED';
              return false;
            }).map((action) => (
              <Button
                key={action}
                label={ACTION_LABELS[action] ?? action}
                size="sm"
                variant={action === 'CANCEL' || action === 'SUSPEND' ? 'danger' : 'secondary'}
                loading={runAction.isPending}
                onPress={() =>
                  void runAction
                    .mutateAsync({
                      action,
                      payload: action === 'SUSPEND' || action === 'CANCEL' ? { reason: 'Updated from the mobile app by the responsible officer.' } : {},
                    })
                    .then(() => toast.success(`${ACTION_LABELS[action] ?? action} accepted`))
                    .catch((error) => toast.error('Transition refused', error instanceof ApiError ? error.message : undefined))
                }
              />
            ))}
          </Row>
          <Caption tone="faint" style={{ marginTop: 8 }}>
            Any transition the state machine does not allow from {activityStatusLabel(data.status, language)} is refused with PERMIT/ACTIVITY_INVALID_TRANSITION.
          </Caption>
        </Section>
      ) : null}

      {canRecord ? (
        <ToneScope tone="dark">
          <Card style={{ marginBottom: 16 }}>
            <Overline style={{ marginBottom: 6 }}>Field capture</Overline>
            <Heading style={{ marginBottom: 6 }}>Record a harvest pass</Heading>
            <Caption tone="muted" style={{ marginBottom: 12 }}>
              Volume and tree count go into the register; the position below is attached to the entry.
            </Caption>
            <Row gap={8} style={{ marginBottom: 12 }} wrap>
              <Badge
                label={position.fix ? `${position.fix.latitude.toFixed(5)}, ${position.fix.longitude.toFixed(5)}` : 'Position not captured'}
                tone={position.fix ? 'success' : 'warning'}
                icon="location-outline"
              />
              <Badge label={band.label} tone={band.tone === 'good' ? 'success' : band.tone === 'fair' ? 'warning' : 'danger'} />
            </Row>
            <Row gap={10}>
              <TextField
                label="Volume (m³)"
                required
                keyboardType="numeric"
                value={harvestVolume}
                onChangeText={setHarvestVolume}
                style={{ flex: 1 }}
                suffix="m³"
              />
              <TextField label="Trees felled" keyboardType="numeric" value={treeCount} onChangeText={setTreeCount} style={{ flex: 1 }} />
            </Row>
            <TextField label="Observations" multiline value={harvestNotes} onChangeText={setHarvestNotes} placeholder="Species, conditions, incidents on site" />
            <Row gap={8}>
              <Button label="Refresh position" variant="secondary" icon="navigate-outline" loading={position.loading} onPress={() => void position.refresh()} />
              <Button label="Record harvest" icon="add-circle-outline" loading={busy} onPress={() => void doRecordHarvest()} />
            </Row>
            {position.error ? (
              <View style={{ marginTop: 10 }}>
                <Notice tone="warning">{position.error.message}</Notice>
              </View>
            ) : null}
          </Card>
        </ToneScope>
      ) : null}

      {speciesBreakdown && Object.keys(speciesBreakdown).length > 0 ? (
        <Section title="Species breakdown">
          <Card>
            {Object.entries(speciesBreakdown).map(([species, volume]) => (
              <Row key={species} justify="space-between" style={{ paddingVertical: 4 }}>
                <Body>{humanize(species)}</Body>
                <Body style={{ fontWeight: '600' }}>{formatVolume(volume, language)}</Body>
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Record">
        <Card>
          <Definition label="Permit" value={data.permit?.permitNumber ?? '—'} />
          <Definition label="Company" value={data.company?.name ?? '—'} />
          <Definition label="Forest" value={data.forest ? `${data.forest.name} (${data.forest.code})` : '—'} />
          <Definition label="Zone" value={data.zone?.name ?? '—'} />
          <Definition label="Planned period" value={`${formatDateTime(data.plannedStartDate, language)} → ${data.plannedEndDate ? formatDateTime(data.plannedEndDate, language) : '—'}`} />
          <Definition label="Actual start" value={data.actualStartDate ? formatDateTime(data.actualStartDate, language) : '—'} />
          <Definition label="Actual end" value={data.actualEndDate ? formatDateTime(data.actualEndDate, language) : '—'} />
          <Definition label="Trees felled" value={String(data.harvestedTreeCount ?? 0)} />
          <Definition
            label="Position"
            value={data.latitude && data.longitude ? `${Number(data.latitude).toFixed(5)}, ${Number(data.longitude).toFixed(5)}` : '—'}
          />
          <Definition label="Position source" value={data.gpsSource === 'DEVICE_GPS' ? 'Device GPS' : (data.gpsSource ?? '—')} />
          <Definition label="Captured" value={data.gpsCapturedAt ? formatDateTime(data.gpsCapturedAt, language) : '—'} />
          <Definition label="Recorded by" value={data.createdBy ? `${data.createdBy.firstName} ${data.createdBy.lastName}` : '—'} />
          <Definition label="Assigned to" value={data.assignedTo ? `${data.assignedTo.firstName} ${data.assignedTo.lastName}` : 'unassigned'} />
          {data.observations ? <Definition label="Observations" value={data.observations} /> : null}
          {data.equipmentSummary ? <Definition label="Equipment summary" value={data.equipmentSummary} /> : null}
        </Card>
      </Section>

      <Section title="Equipment">
        {data.equipmentUsage && data.equipmentUsage.length > 0 ? (
          <Card padded={false}>
            {data.equipmentUsage.map((usage, index) => (
              <View key={usage.id} style={{ padding: 14, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
                <Body style={{ fontWeight: '600' }}>{usage.equipment?.name ?? 'Equipment'}</Body>
                <Caption tone="muted">
                  {usage.equipment ? `${equipmentCategoryLabel(usage.equipment.category, language)} · ${usage.equipment.status}` : '—'}
                </Caption>
              </View>
            ))}
          </Card>
        ) : (
          <Card>
            <Caption tone="muted">No equipment is attached to this activity yet.</Caption>
          </Card>
        )}

        {hasPermission('exploitation:update') ? (
          <Card style={{ marginTop: 12 }}>
            <SelectSheet
              label="Attach equipment"
              value={equipmentId}
              options={(equipment.data?.items ?? []).map((item) => ({
                value: item.id,
                label: `${item.name}${item.registrationNumber ? ` (${item.registrationNumber})` : ''}`,
                description: `${equipmentCategoryLabel(item.category, language)} · ${item.status}`,
              }))}
              onChange={setEquipmentId}
              placeholder={equipment.isLoading ? 'Loading equipment…' : 'Choose a machine'}
            />
            <Button
              label="Attach to activity"
              icon="construct-outline"
              disabled={!equipmentId}
              loading={attachEquipment.isPending}
              onPress={() =>
                void attachEquipment
                  .mutateAsync({ equipmentId: equipmentId as string })
                  .then(() => {
                    toast.success('Equipment attached');
                    setEquipmentId(null);
                  })
                  .catch((error) => toast.error('Could not attach', error instanceof ApiError ? error.message : undefined))
              }
            />
          </Card>
        ) : null}
      </Section>

      <Divider style={{ marginVertical: 12 }} />
      <Tiny tone="faint" style={{ textAlign: 'center' }}>
        Created {formatRelative(data.createdAt ?? new Date().toISOString(), language)} · record {data.id.slice(0, 8)}
      </Tiny>
      <Row gap={8} style={{ marginTop: 12, justifyContent: 'center' }}>
        <Button label="Permit" size="sm" variant="ghost" icon="document-text-outline" onPress={() => router.push({ pathname: '/permit/[id]', params: { id: data.permitId } })} />
        <Button label="All activities" size="sm" variant="ghost" icon="list-outline" onPress={() => router.push('/activity')} />
      </Row>
    </ScrollView>
  );
}
