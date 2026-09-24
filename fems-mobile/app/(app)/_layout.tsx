/**
 * Authenticated shell.
 *
 * Blocks the whole group behind a valid session, flushes the offline queue when
 * the API becomes reachable again and keeps the connectivity/queue banner in
 * view above every screen, because a field officer needs to know at a glance
 * whether what they just captured has reached the ministry.
 */
import React, { useEffect, useRef } from 'react';
import { Redirect, Stack } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/auth/AuthProvider';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { useOfflineQueue } from '../../src/hooks/useOfflineQueue';
import { useTheme } from '../../src/theme/theme';
import { Body, Button, Caption, Notice, Row, useToast } from '../../src/ui';

export default function AppLayout() {
  const { status } = useAuth();
  const theme = useTheme();
  const toast = useToast();
  const network = useNetworkStatus();
  const queue = useOfflineQueue();
  const wasOffline = useRef(false);

  // Flush queued field records as soon as the API answers again.
  useEffect(() => {
    if (network.offline) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current && queue.pending > 0 && !queue.syncing) {
      wasOffline.current = false;
      void queue
        .sync()
        .then((outcome) => {
          if (outcome.created + outcome.duplicates > 0) toast.success('Field data synchronised', outcome.message);
          else if (outcome.rejected > 0) toast.error('Some records were rejected', outcome.message);
        })
        .catch(() => toast.error('Synchronisation failed', 'Open the sync screen to see the pending records.'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network.offline, queue.pending]);

  if (status === 'loading') return null;
  if (status !== 'authenticated') return <Redirect href="/login" />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {network.offline ? (
        <View style={{ paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 52 : 30, paddingBottom: 10 }}>
          <Notice tone="warning" icon={<Ionicons name="cloud-offline-outline" size={16} color={theme.colors.warning} />} title="Working offline">
            {queue.pending > 0
              ? `${queue.pending} field record${queue.pending === 1 ? '' : 's'} waiting on this device. They will be sent automatically when the API is reachable.`
              : 'The FEMS API cannot be reached. Screens will show what was last loaded.'}
          </Notice>
          <Row gap={8} style={{ marginTop: 8 }}>
            <Button label="Check connection" size="sm" variant="secondary" icon="refresh" loading={network.checking} onPress={() => void network.recheck()} />
            {queue.pending > 0 ? (
              <Button label="Synchronise now" size="sm" icon="cloud-upload-outline" loading={queue.syncing} onPress={() => void queue.sync()} />
            ) : null}
          </Row>
        </View>
      ) : null}

      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: theme.colors.background } }} />
    </View>
  );
}
