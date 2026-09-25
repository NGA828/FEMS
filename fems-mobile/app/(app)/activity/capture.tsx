/**
 * Field capture — exploitation activity.
 *
 * The dark "Mission Control" surface used in the field. The officer or operator
 * picks the permit the work belongs to (only permits the API returns for their
 * scope), confirms the position with the device GPS, states the planned volume
 * and submits. When the device has no connectivity the record is written to the
 * offline queue with a client reference and pushed later, so the same capture can
 * never be counted twice.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../../src/api/client';
import { useActivities, useCreateActivity, usePermits } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useDevicePosition, accuracyBand } from '../../../src/hooks/useDevicePosition';
import { useNetworkStatus } from '../../../src/hooks/useNetworkStatus';
import { useOfflineQueue } from '../../../src/hooks/useOfflineQueue';
import { newActivityClientRef, offlineQueue } from '../../../src/offline/queue';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Definition,
  Heading,
  Notice,
  Overline,
  Row,
  Section,
  SelectSheet,
  TextField,
  Tiny,
  Title,
  ToneScope,
  useToast,
} from '../../../src/ui';
import { activityTypeLabel, formatDate, formatVolume } from '../../../src/lib/format';

const ACTIVITY_TYPES = [
  { value: 'TIMBER_HARVEST', label: 'Timber harvest', description: 'Felling and bucking inside the approved area' },
  { value: 'LOG_TRANSPORT', label: 'Log transport', description: 'Moving logs to the loading bay or mill' },
  { value: 'FOREST_SURVEY', label: 'Forest survey', description: 'Inventory or boundary work' },
  { value: 'ROAD_CONSTRUCTION', label: 'Road construction', description: 'Opening or maintaining access tracks' },
  { value: 'SITE_CLEARING', label: 'Site clearing', description: 'Clearing for infrastructure' },
  { value: 'PLANTING', label: 'Planting', description: 'Replanting or enrichment planting' },
  { value: 'SALVAGE_LOGGING', label: 'Salvage logging', description: 'Recovering fallen or damaged timber' },
  { value: 'MAINTENANCE', label: 'Maintenance', description: 'Upkeep work in the forest' },
] as const;

export default function CaptureActivityScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ permitId?: string }>();
  const { user, hasPermission } = useAuth();
  const network = useNetworkStatus();
  const queue = useOfflineQueue();
  const position = useDevicePosition();

  const permits = usePermits({ status: 'ACTIVE', limit: 50 });
  const recentActivities = useActivities({ limit: 3 });
  const createActivity = useCreateActivity();

  const [permitId, setPermitId] = useState<string | null>(params.permitId ?? null);
  const [activityType, setActivityType] = useState<(typeof ACTIVITY_TYPES)[number]['value'] | null>('TIMBER_HARVEST');
  const [plannedVolume, setPlannedVolume] = useState('');
  const [plannedStart, setPlannedStart] = useState(new Date().toISOString().slice(0, 10));
  const [plannedEnd, setPlannedEnd] = useState('');
  const [equipmentSummary, setEquipmentSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';
  const band = accuracyBand(position.accuracyM);

  useEffect(() => {
    void position.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const permitOptions = useMemo(
    () =>
      (permits.data?.items ?? []).map((permit) => ({
        value: permit.id,
        label: `${permit.permitNumber} — ${permit.title}`,
        description: `${permit.company?.name ?? ''} · valid until ${formatDate(permit.endDate, language)} · ${formatVolume(
          permit.volumeApprovedM3 ?? permit.volumeRequestedM3,
          language,
        )} approved`,
      })),
    [permits.data, language],
  );

  const errors = useMemo(() => {
    const map: Record<string, string> = { ...serverFields };
    if (!permitId) map.permitId = 'Choose the permit this work belongs to.';
    if (!activityType) map.activityType = 'Choose the activity type.';
    if (!plannedVolume || Number(plannedVolume) <= 0) map.plannedVolumeM3 = 'Enter the planned volume in m³.';
    if (!plannedStart) map.plannedStartDate = 'Choose the date the work starts.';
    return map;
  }, [serverFields, permitId, activityType, plannedVolume, plannedStart]);

  const canSubmit = Boolean(permitId && activityType && plannedVolume && Number(plannedVolume) > 0 && plannedStart) && !submitting;

  const submit = async () => {
    if (!permitId || !activityType) return;
    setFailure(null);
    setServerFields({});
    setSubmitting(true);

    const fix = position.fix ?? (await position.refresh());
    if (!fix) {
      setSubmitting(false);
      setFailure(
        position.error?.message ??
          'No GPS position is available. FEMS does not invent coordinates: move to an open area and try again, or capture the record without a position from the office.',
      );
      return;
    }
    if (fix.mocked) {
      setSubmitting(false);
      setFailure('The device reports a simulated position. FEMS refuses to record field data from a mocked location.');
      return;
    }

    const clientRef = newActivityClientRef();
    const payload = {
      permitId,
      activityType,
      plannedVolumeM3: Number(plannedVolume),
      plannedStartDate: new Date(plannedStart).toISOString(),
      plannedEndDate: plannedEnd ? new Date(plannedEnd).toISOString() : undefined,
      latitude: fix.latitude,
      longitude: fix.longitude,
      locationAccuracyM: fix.accuracyM ?? undefined,
      gpsSource: fix.source,
      gpsCapturedAt: fix.capturedAt,
      equipmentSummary: equipmentSummary.trim() || undefined,
      observations: notes.trim() || undefined,
    };

    try {
      if (network.offline) {
        await offlineQueue.enqueueActivity({ ...payload, clientRef });
        toast.info('Saved on this device', 'The API is unreachable; the record will be sent automatically when the connection returns.');
        router.replace('/sync');
        return;
      }
      const activity = await createActivity.mutateAsync({ ...payload, clientRef });
      toast.success('Activity recorded', `${activity.reference} — ${activityStatusText(activity.status)}.`);
      router.replace({ pathname: '/activity/[id]', params: { id: activity.id } });
    } catch (error) {
      if (error instanceof ApiError && error.isOffline) {
        await offlineQueue.enqueueActivity({ ...payload, clientRef });
        toast.info('Saved on this device', 'The API could not be reached; the record is queued and will be synchronised.');
        router.replace('/sync');
        return;
      }
      if (error instanceof ApiError) {
        setServerFields(fieldErrors(error));
        setFailure(error.message);
      } else {
        setFailure(error instanceof Error ? error.message : 'The activity could not be recorded.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission('exploitation:create')) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <Notice tone="warning" title="Not available for your role">
          Capturing exploitation activities requires the `exploitation:create` permission, which your account does not hold. Reading the register remains
          available.
        </Notice>
        <View style={{ marginTop: 12 }}>
          <Button label="Open the activity register" variant="secondary" onPress={() => router.replace('/activity')} fullWidth />
        </View>
      </ScrollView>
    );
  }

  return (
    <ToneScope tone="dark">
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <Row justify="space-between" align="flex-start" style={{ marginBottom: 14 }}>
          <View style={{ flex: 1 }}>
            <Row gap={6}>
              <Ionicons name="walk-outline" size={18} color={theme.colors.primary} />
              <Overline>Field capture</Overline>
            </Row>
            <Title>Activity</Title>
            <Caption tone="muted">Declared against an active permit, with the position the device reports.</Caption>
          </View>
          <Button label="Close" variant="ghost" size="sm" onPress={() => router.back()} />
        </Row>

        <Card style={{ marginBottom: 14 }}>
          <Row justify="space-between" align="center" style={{ marginBottom: 10 }}>
            <Row gap={8}>
              <Badge
                label={network.offline ? 'Offline — will queue' : 'Online — sends now'}
                tone={network.offline ? 'warning' : 'success'}
                icon={network.offline ? 'cloud-offline-outline' : 'cloud-done-outline'}
              />
              {queue.pending > 0 ? <Badge label={`${queue.pending} queued`} tone="info" /> : null}
            </Row>
            <Pressable onPress={() => void position.refresh()} accessibilityRole="button" accessibilityLabel="Refresh GPS position">
              <Row gap={4}>
                <Ionicons name="navigate-outline" size={14} color={theme.colors.primary} />
                <Tiny style={{ color: theme.colors.primary }}>Refresh GPS</Tiny>
              </Row>
            </Pressable>
          </Row>

          <Row gap={8} wrap>
            <Badge
              label={position.fix ? `${position.fix.latitude.toFixed(6)}, ${position.fix.longitude.toFixed(6)}` : 'Waiting for a fix…'}
              tone={position.fix ? 'success' : 'warning'}
              icon="location-outline"
            />
            <Badge label={band.label} tone={band.tone === 'good' ? 'success' : band.tone === 'fair' ? 'warning' : 'danger'} />
            {position.fix?.mocked ? <Badge label="simulated — refused" tone="danger" /> : null}
          </Row>
          <Caption tone="faint" style={{ marginTop: 8 }}>
            {position.fix
              ? `Captured ${new Date(position.fix.capturedAt).toLocaleTimeString()} from ${position.fix.source === 'DEVICE_GPS' ? 'device GPS' : position.fix.source}.`
              : 'FEMS records the position the device reports. There is no default location: without a fix you can queue the record or retry outside.'}
          </Caption>
        </Card>

        {failure ? (
          <View style={{ marginBottom: 14 }}>
            <Notice tone="danger" title="Capture refused">
              {failure}
            </Notice>
          </View>
        ) : null}

        <Section title="Permit">
          <Card>
            <SelectSheet
              label="Permit"
              required
              value={permitId}
              options={permitOptions}
              onChange={setPermitId}
              placeholder={permits.isLoading ? 'Loading your permits…' : permitOptions.length ? 'Choose a permit' : 'No active permit in your scope'}
              error={errors.permitId}
            />
            {permits.data?.items.length === 0 ? (
              <Notice tone="warning" title="No active permit">
                Exploitation can only be recorded against an active permit. If a permit is waiting for payment or approval it cannot be used yet.
              </Notice>
            ) : null}
          </Card>
        </Section>

        <Section title="Work">
          <Card>
            <SelectSheet
              label="Activity type"
              required
              value={activityType}
              options={ACTIVITY_TYPES.map((entry) => ({ value: entry.value, label: entry.label, description: entry.description }))}
              onChange={setActivityType}
              error={errors.activityType}
            />
            <TextField
              label="Planned volume (m³)"
              required
              keyboardType="numeric"
              value={plannedVolume}
              onChangeText={setPlannedVolume}
              placeholder="250"
              suffix="m³"
              error={errors.plannedVolumeM3}
            />
            <Row gap={10}>
              <TextField label="Start" required value={plannedStart} onChangeText={setPlannedStart} style={{ flex: 1 }} placeholder="YYYY-MM-DD" />
              <TextField label="End (optional)" value={plannedEnd} onChangeText={setPlannedEnd} style={{ flex: 1 }} placeholder="YYYY-MM-DD" />
            </Row>
            <TextField
              label="Equipment summary"
              value={equipmentSummary}
              onChangeText={setEquipmentSummary}
              placeholder="2 chainsaws, 1 skidder, 1 truck"
              help="Free text; individual machines can be attached to the activity afterwards."
            />
            <TextField label="Observations" multiline value={notes} onChangeText={setNotes} placeholder="Species, weather, incidents" />
          </Card>
        </Section>

        <Section title="Summary">
          <Card>
            <Definition label="Permit" value={permitOptions.find((option) => option.value === permitId)?.label ?? '—'} />
            <Definition label="Type" value={activityType ? activityTypeLabel(activityType, language) : '—'} />
            <Definition label="Planned volume" value={formatVolume(plannedVolume || 0, language)} />
            <Definition label="Start" value={plannedStart ? formatDate(plannedStart, language) : '—'} />
            <Definition label="Position" value={position.fix ? `${position.fix.latitude.toFixed(5)}, ${position.fix.longitude.toFixed(5)}` : 'not captured'} />
          </Card>
        </Section>

        {recentActivities.data?.items.length ? (
          <Section title="Your recent captures">
            <Card padded={false}>
              {recentActivities.data.items.map((activity, index) => (
                <View key={activity.id} style={{ padding: 12, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
                  <Row justify="space-between">
                    <Body style={{ fontWeight: '600' }}>{activity.reference}</Body>
                    <Tiny tone="faint">{activityTypeLabel(activity.activityType, language)}</Tiny>
                  </Row>
                  <Caption tone="muted">
                    {formatVolume(activity.plannedVolumeM3, language)} planned · {activityStatusText(activity.status)}
                  </Caption>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        <Card style={{ marginBottom: 14 }}>
          <Row gap={10}>
            <Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.info} />
            <Caption tone="muted" style={{ flex: 1 }}>
              The API checks that the permit is active and inside its validity window, that the volume is within the approved envelope, and that the
              position was captured by the device (not typed in).
            </Caption>
          </Row>
        </Card>

        <Button
          label={network.offline ? 'Save to offline queue' : 'Submit activity'}
          icon={network.offline ? 'cloud-upload-outline' : 'send-outline'}
          size="lg"
          fullWidth
          loading={submitting}
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
        <Caption tone="faint" style={{ textAlign: 'center', marginTop: 8 }}>
          {formatDate(new Date(), language)} · {user?.firstName} {user?.lastName}
        </Caption>
      </ScrollView>
    </ToneScope>
  );
}

function activityStatusText(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
