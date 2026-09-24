import { randomBytes, randomUUID } from 'node:crypto';

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

export function formatDateStamp(date = new Date()): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

export function formatDateTimeStamp(date = new Date()): string {
  return `${formatDateStamp(date)}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function sequenceSuffix(length = 6): string {
  return randomBytes(6)
    .toString('base64url')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .slice(0, length)
    .padEnd(length, 'X');
}

/**
 * Human-readable, collision-resistant references. A worker/retry that submits
 * the same payload twice returns the existing record instead of duplicating it
 * (see the `clientRef` idempotency key on field records).
 */
export const References = {
  permit: (type: string, date = new Date()) =>
    `FEMS-${type.slice(0, 3).toUpperCase()}-${formatDateStamp(date)}-${sequenceSuffix()}`,
  activity: (date = new Date()) => `ACT-${formatDateStamp(date)}-${sequenceSuffix()}`,
  inspection: (date = new Date()) => `INS-${formatDateStamp(date)}-${sequenceSuffix()}`,
  violation: (date = new Date()) => `VIO-${formatDateStamp(date)}-${sequenceSuffix()}`,
  alert: (date = new Date()) => `ALR-${formatDateStamp(date)}-${sequenceSuffix()}`,
  payment: (purpose: string, date = new Date()) =>
    `PAY-${purpose.slice(0, 3)}-${formatDateTimeStamp(date)}-${sequenceSuffix(3)}`,
  receipt: (date = new Date()) => `RCP-${formatDateStamp(date)}-${sequenceSuffix(6)}`,
  report: (type: string, date = new Date()) =>
    `REP-${type.slice(0, 4)}-${formatDateTimeStamp(date)}-${sequenceSuffix(3)}`,
  fileKey: (folder: string, extension: string) =>
    `${folder}/${formatDateStamp()}/${randomUUID()}.${extension.replace(/^\./, '')}`,
};

/** Retry-safe generator: keeps trying until `isAvailable` confirms uniqueness. */
export async function uniqueReference(
  generator: () => string,
  isAvailable: (candidate: string) => Promise<boolean>,
  attempts = 5,
): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = generator();
    // eslint-disable-next-line no-await-in-loop
    if (await isAvailable(candidate)) return candidate;
  }
  throw new Error('Could not generate a unique reference — please retry.');
}

export const newId = (): string => randomUUID();
