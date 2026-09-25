/**
 * Offline queue.
 *
 * Lists exactly what is stored on the device, when it was captured, how many
 * times the API refused it and why. Records leave the queue only when the server
 * accepted them (created or recognised as duplicates); a rejected record stays
 * with the server's error message so nothing is silently discarded.
 */
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetworkStatus } from '../../../src/hooks/useNetworkStatus';
import { useOfflineQueue } from '../../../src/hooks/useOfflineQueue';
import { offlineQueue } from '../../../src/offline/queue';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Definition,
  Divider,
  EmptyState,
  Notice,
  Overline,
  Row,
  Section,
  Title,
  Tiny,
  useToast,
} from '../../../src/ui';
import { formatDateTime, formatRelative, formatVolume, humanize } from '../../../src/lib/format';

export default function SyncScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const network = useNetworkStatus();
  const queue = useOfflineQueue();

  const records = queue.records;

  const runSync = async () => {
    if (network.offline) {
      const reachable = await network.recheck();
      if (!reachable) {
        toast.error('Still offline', 'The FEMS API cannot be reached from this device right now.');
        return;
      }
    }
    const outcome = await queue.sync();
    if (!outcome.ok) toast.error('Synchronisation failed', outcome.message);
    else if (outcome.created + outcome.duplicates > 0) toast.success('Synchronised', outcome.message);
    else toast.info('Nothing to send', outcome.message);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: theme.tabBarHeight + 40 }}
      refreshControl={
        <RefreshControl refreshing={queue.syncing || network.checking} onRefresh={() => void runSync()} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />
      }
    >
      <Row justify="space-between" align="flex-start" style={{ marginBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <Title>Field data queue</Title>
          <Caption tone="muted">
            {queue.pending === 0
              ? 'Every record captured on this device has reached the server.'
              : `${queue.pending} record${queue.pending === 1 ? '' : 's'} waiting to be sent.`}
          </Caption>
        </View>
        <Ionicons
          name={network.offline ? 'cloud-offline-outline' : 'cloud-done-outline'}
          size={26}
          color={network.offline ? theme.colors.warning : theme.colors.success}
        />
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Row gap={10}>
          <View style={{ flex: 1 }}>
            <Row gap={6} wrap>
              <Badge label={network.offline ? 'Offline' : 'Online'} tone={network.offline ? 'warning' : 'success'} />
              <Badge label={`${queue.activities} activities`} tone="neutral" />
              <Badge label={`${queue.observations} observations`} tone="neutral" />
            </Row>
            <Caption tone="muted" style={{ marginTop: 8 }}>
              {queue.lastOutcome
                ? `Last run: ${queue.lastOutcome.message}`
                : 'Records are pushed automatically as soon as the API answers again.'}
            </Caption>
          </View>
        </Row>
        <Row gap={8} style={{ marginTop: 12 }}>
          <Button label="Synchronise now" icon="cloud-upload-outline" loading={queue.syncing} disabled={queue.pending === 0} onPress={() => void runSync()} />
          <Button
            label="Clear queue"
            variant="ghost"
            disabled={queue.pending === 0}
            onPress={() => {
              void offlineQueue.clear().then(() => toast.info('Queue cleared', 'Nothing was sent to the server.'));
            }}
          />
        </Row>
        {queue.pending > 0 ? (
          <View style={{ marginTop: 12 }}>
            <Notice tone="warning" title="Why clearing matters">
              A cleared record is lost: it was never sent to the ministry. Only clear if the data has been recorded another way.
            </Notice>
          </View>
        ) : null}
      </Card>

      <Section title="Queued records">
        {records.length === 0 ? (
          <EmptyState
            icon="cloud-done-outline"
            title="Nothing is queued"
            description="Signals permitting, field captures are written straight to the API. When the connection drops they land here instead."
            actionLabel="Capture an activity"
            onAction={() => router.push('/activity/capture')}
          />
        ) : (
          records.map((record) => (
            <Card key={record.id} style={{ marginBottom: 12 }}>
              <Row justify="space-between" style={{ marginBottom: 8 }}>
                <Badge
                  label={record.kind === 'ACTIVITY' ? 'Exploitation activity' : 'Field observation'}
                  tone={record.kind === 'ACTIVITY' ? 'accent' : 'info'}
                  icon={record.kind === 'ACTIVITY' ? 'cube-outline' : 'eye-outline'}
                />
                {record.lastError ? <Badge label={`${record.attempts} attempt(s)`} tone="danger" /> : <Badge label="Pending" tone="warning" />}
              </Row>
              <Definition label="Client reference" value={<Body style={{ fontWeight: '600' }}>{record.payload.clientRef}</Body>} />
              {record.kind === 'ACTIVITY' ? (
                <>
                  <Definition label="Type" value={humanize(record.payload.activityType)} />
                  <Definition label="Planned volume" value={formatVolume(record.payload.plannedVolumeM3)} />
                  <Definition label="Planned start" value={formatDateTime(record.payload.plannedStartDate)} />
                </>
              ) : (
                <>
                  <Definition label="Category" value={humanize(record.payload.category)} />
                  <Definition label="Title" value={record.payload.title} />
                </>
              )}
              <Definition
                label="Position"
                value={`${Number(record.payload.latitude).toFixed(5)}, ${Number(record.payload.longitude).toFixed(5)}${
                  record.payload.locationAccuracyM ? ` (±${Math.round(Number(record.payload.locationAccuracyM))} m)` : ''
                }`}
              />
              <Row justify="space-between">
                <Caption tone="faint">captured {formatRelative(record.createdAt)}</Caption>
                <Button
                  label="Discard"
                  size="sm"
                  variant="ghost"
                  onPress={() => void offlineQueue.remove([record.id]).then(() => toast.info('Record discarded'))}
                />
              </Row>
              {record.lastError ? (
                <View style={{ marginTop: 10 }}>
                  <Notice tone="danger" title="The server rejected this record">
                    {record.lastError}
                  </Notice>
                </View>
              ) : null}
              <Divider style={{ marginTop: 12 }} />
              <Tiny tone="faint" style={{ marginTop: 8 }}>
                Sending a record twice is safe: the client reference is the idempotency key, so the API counts it once.
              </Tiny>
            </Card>
          ))
        )}
      </Section>

      <Card>
        <Overline style={{ marginBottom: 6 }}>How offline capture works</Overline>
        <Caption tone="muted">
          Field records are captured with the device GPS while offline and stored with a client reference. On reconnect the batch is posted to
          <Body style={{ fontWeight: '600' }}> /activities/offline-sync</Body> and <Body style={{ fontWeight: '600' }}>/observations/offline-sync</Body>, which
          return one outcome per record (created, duplicate or rejected). Rejected records come back here with the server’s explanation.
        </Caption>
      </Card>
    </ScrollView>
  );
}
