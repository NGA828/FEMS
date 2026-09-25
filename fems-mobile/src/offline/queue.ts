/**
 * Offline field queue.
 *
 * Field officers work where there is no signal, so activity records and field
 * observations captured without connectivity are written to device storage with
 * a client-generated idempotency key. When the device is back online the batch is
 * posted to the API's batch endpoints (`/activities/offline-sync`,
 * `/observations/offline-sync`), which create what is new and report duplicates
 * by `clientRef`, so a retry can never double-count a harvest.
 *
 * The queue stores exactly what the API accepts; nothing is invented locally:
 * a record that is rejected stays in the queue with the server's error code so
 * the user can fix it and resubmit.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OfflineActivityRecord } from '../api/endpoints';
import type { CreateObservationPayload } from '../api/endpoints';

const QUEUE_KEY = 'fems.offline.queue.v1';

export type QueuedRecord =
  | { kind: 'ACTIVITY'; id: string; createdAt: string; attempts: number; lastError?: string; payload: OfflineActivityRecord }
  | { kind: 'OBSERVATION'; id: string; createdAt: string; attempts: number; lastError?: string; payload: CreateObservationPayload & { clientRef: string } };

export interface QueueSnapshot {
  records: QueuedRecord[];
  activities: number;
  observations: number;
}

function makeClientRef(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function newActivityClientRef(): string {
  return makeClientRef('offline-activity');
}

export function newObservationClientRef(): string {
  return makeClientRef('offline-observation');
}

export function newPaymentClientRef(): string {
  return makeClientRef('pay');
}

async function read(): Promise<QueuedRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function write(records: QueuedRecord[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(records));
}

const listeners = new Set<(snapshot: QueueSnapshot) => void>();

function snapshot(records: QueuedRecord[]): QueueSnapshot {
  return {
    records,
    activities: records.filter((record) => record.kind === 'ACTIVITY').length,
    observations: records.filter((record) => record.kind === 'OBSERVATION').length,
  };
}

async function emit(): Promise<QueueSnapshot> {
  const state = snapshot(await read());
  listeners.forEach((listener) => listener(state));
  return state;
}

export const offlineQueue = {
  subscribe(listener: (snapshot: QueueSnapshot) => void): () => void {
    listeners.add(listener);
    void this.snapshot().then(listener);
    return () => listeners.delete(listener);
  },

  async snapshot(): Promise<QueueSnapshot> {
    return snapshot(await read());
  },

  async enqueueActivity(payload: OfflineActivityRecord): Promise<QueuedRecord> {
    const record: QueuedRecord = { kind: 'ACTIVITY', id: payload.clientRef, createdAt: new Date().toISOString(), attempts: 0, payload };
    const records = await read();
    records.push(record);
    await write(records);
    await emit();
    return record;
  },

  async enqueueObservation(payload: CreateObservationPayload & { clientRef: string }): Promise<QueuedRecord> {
    const record: QueuedRecord = { kind: 'OBSERVATION', id: payload.clientRef, createdAt: new Date().toISOString(), attempts: 0, payload };
    const records = await read();
    records.push(record);
    await write(records);
    await emit();
    return record;
  },

  async remove(ids: string[]): Promise<void> {
    const records = await read();
    await write(records.filter((record) => !ids.includes(record.id)));
    await emit();
  },

  async markFailed(ids: string[], message: string): Promise<void> {
    const records = await read();
    const next = records.map((record) =>
      ids.includes(record.id) ? { ...record, attempts: record.attempts + 1, lastError: message } : record,
    );
    await write(next);
    await emit();
  },

  async clear(): Promise<void> {
    await write([]);
    await emit();
  },
};
