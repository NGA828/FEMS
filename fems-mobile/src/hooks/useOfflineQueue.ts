/**
 * Offline queue hook.
 *
 * Screens that capture field data use this to queue a record when the API cannot
 * be reached and to show how many records are waiting. Nothing is written to the
 * queue while online: the record goes straight to the API so the server remains
 * the only source of truth.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { offlineQueue, type QueueSnapshot } from '../offline/queue';
import { syncOfflineQueue, type SyncOutcome } from '../offline/sync';

const EMPTY: QueueSnapshot = { records: [], activities: 0, observations: 0 };

export function useOfflineQueue() {
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(EMPTY);
  const [syncing, setSyncing] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<SyncOutcome | null>(null);

  useEffect(() => offlineQueue.subscribe(setSnapshot), []);

  const sync = useCallback(async (): Promise<SyncOutcome> => {
    setSyncing(true);
    try {
      const outcome = await syncOfflineQueue();
      setLastOutcome(outcome);
      return outcome;
    } finally {
      setSyncing(false);
    }
  }, []);

  const pending = snapshot.activities + snapshot.observations;

  return {
    ...snapshot,
    pending,
    syncing,
    lastOutcome,
    sync,
    /** True when a failed request is a connectivity problem rather than a rejection. */
    shouldQueue: (error: unknown) => error instanceof ApiError && error.isOffline,
  };
}
