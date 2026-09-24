const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  sec: 1000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Parses durations such as `15m`, `30d`, `12h`, `500ms` (the same syntax used
 * by the JWT_EXPIRES_IN / JWT_REFRESH_EXPIRES_IN environment variables) into
 * milliseconds, so refresh-token rows always carry a matching `expiresAt`.
 */
export function parseDurationToMs(value: string, fallbackMs = 3_600_000): number {
  if (!value) return fallbackMs;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h|hr|d|w)?$/i.exec(value.trim());
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'm').toLowerCase();
  const multiplier = UNITS[unit] ?? 60_000;
  return Math.round(amount * multiplier);
}

/** Seconds — used for the `expiresIn` hints returned to the mobile app. */
export function parseDurationToSeconds(value: string, fallbackSeconds = 3600): number {
  return Math.round(parseDurationToMs(value, fallbackSeconds * 1000) / 1000);
}
