/**
 * Background sync of the offline queue.
 *
 * Called on reconnect, on app focus and from the "Synchronise now" affordance in
 * the offline banner. Records the server accepted (created or recognised as a
 * duplicate of an earlier submission) leave the queue; records the server
 * rejected stay with the returned error code so nothing is silently dropped.
 */
import { activitiesApi, observationsApi, type OfflineSyncResult } from '../api/endpoints';
import { ApiError } from '../api/client';
import { offlineQueue, type QueuedRecord } from './queue';

export interface SyncOutcome {
  created: number;
  duplicates: number;
  rejected: number;
  remaining: number;
  ok: boolean;
  message: string;
}

function messageFor(result: OfflineSyncResult): string {
  const parts: string[] = [];
  if (result.created) parts.push(`${result.created} created`);
  if (result.duplicates) parts.push(`${result.duplicates} already on the server`);
  if (result.rejected) parts.push(`${result.rejected} rejected`);
  return parts.length ? parts.join(' · ') : 'Nothing to synchronise';
}

async function syncActivities(records: Extract<QueuedRecord, { kind: 'ACTIVITY' }>[]): Promise<SyncOutcome | null> {
  if (!records.length) return null;
  try {
    const result = await activitiesApi.syncOffline(records.map((record) => record.payload));
    const settled = records
      .filter((record) => !result.errors?.some((error) => error.clientRef === record.payload.clientRef))
      .map((record) => record.id);
    await offlineQueue.remove(settled);
    const failed = records.filter((record) => result.errors?.some((error) => error.clientRef === record.payload.clientRef));
    if (failed.length) {
      await offlineQueue.markFailed(
        failed.map((record) => record.id),
        failed
          .map((record) => result.errors?.find((error) => error.clientRef === record.payload.clientRef)?.message)
          .filter(Boolean)
          .join('; ') || 'Rejected by the server',
      );
    }
    return {
      created: result.created,
      duplicates: result.duplicates,
      rejected: result.rejected,
      remaining: failed.length,
      ok: true,
      message: messageFor(result),
    };
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'Synchronisation failed';
    await offlineQueue.markFailed(records.map((record) => record.id), message);
    return { created: 0, duplicates: 0, rejected: 0, remaining: records.length, ok: false, message };
  }
}

async function syncObservations(records: Extract<QueuedRecord, { kind: 'OBSERVATION' }>[]): Promise<SyncOutcome | null> {
  if (!records.length) return null;
  try {
    const result = await observationsApi.syncOffline(records.map((record) => record.payload));
    const settled = records
      .filter((record) => !result.errors?.some((error) => error.clientRef === record.payload.clientRef))
      .map((record) => record.id);
    await offlineQueue.remove(settled);
    const failed = records.filter((record) => result.errors?.some((error) => error.clientRef === record.payload.clientRef));
    if (failed.length) {
      await offlineQueue.markFailed(
        failed.map((record) => record.id),
        failed
          .map((record) => result.errors?.find((error) => error.clientRef === record.payload.clientRef)?.message)
          .filter(Boolean)
          .join('; ') || 'Rejected by the server',
      );
    }
    return {
      created: result.created,
      duplicates: result.duplicates,
      rejected: result.rejected,
      remaining: failed.length,
      ok: true,
      message: messageFor(result),
    };
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'Synchronisation failed';
    await offlineQueue.markFailed(records.map((record) => record.id), message);
    return { created: 0, duplicates: 0, rejected: 0, remaining: records.length, ok: false, message };
  }
}

/** Pushes every queued record to the API and reports what happened. */
export async function syncOfflineQueue(): Promise<SyncOutcome> {
  const snapshot = await offlineQueue.snapshot();
  if (!snapshot.records.length) {
    return { created: 0, duplicates: 0, rejected: 0, remaining: 0, ok: true, message: 'Nothing to synchronise' };
  }

  const activityRecords = snapshot.records.filter((record): record is Extract<QueuedRecord, { kind: 'ACTIVITY' }> => record.kind === 'ACTIVITY');
  const observationRecords = snapshot.records.filter(
    (record): record is Extract<QueuedRecord, { kind: 'OBSERVATION' }> => record.kind === 'OBSERVATION',
  );

  const outcomes = [await syncActivities(activityRecords), await syncObservations(observationRecords)].filter(
    (outcome): outcome is SyncOutcome => outcome !== null,
  );

  const totals = outcomes.reduce(
    (accumulator, outcome) => ({
      created: accumulator.created + outcome.created,
      duplicates: accumulator.duplicates + outcome.duplicates,
      rejected: accumulator.rejected + outcome.rejected,
      remaining: accumulator.remaining + outcome.remaining,
      ok: accumulator.ok && outcome.ok,
    }),
    { created: 0, duplicates: 0, rejected: 0, remaining: 0, ok: true },
  );

  return {
    ...totals,
    message: outcomes.map((outcome) => outcome.message).join(' · ') || 'Nothing to synchronise',
  };
}
