/**
 * Helpers for the `*Json` columns.
 *
 * MySQL 5.6 has no native JSON type, so FEMS stores structured payloads in
 * LONGTEXT columns and (de)serialises them here. Every accessor is defensive:
 * a malformed payload must never crash a request.
 */

export function stringifyJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function parseJsonArray<T>(value: string | null | undefined): T[] {
  return parseJson<T[]>(value, []);
}

export function parseJsonObject<T extends object>(value: string | null | undefined): T | null {
  return parseJson<T | null>(value, null);
}
