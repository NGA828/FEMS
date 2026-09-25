/**
 * API configuration.
 *
 * The mobile app never contains credentials: only the public base URL of the
 * FEMS API, which is resolved in this order:
 *
 *  1. `EXPO_PUBLIC_API_URL` (set per build/environment — e.g. the deployed API).
 *  2. Web: the origin the page was served from, so the browser can reach the API
 *     through the same origin (no CORS, no hardcoded localhost in the bundle).
 *     A locally served page talks to the API on port 3000 directly.
 *  3. Native: the host that served the JS bundle (Metro's LAN address) on the API
 *     port, so a phone on the same network reaches the developer machine.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const API_PORT = 3000;
export const API_VERSION = 'v1';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function withVersion(path: string): string {
  return path.endsWith(`/${API_VERSION}`) ? path : `${stripTrailingSlash(path)}/${API_VERSION}`;
}

/** Host serving the JS bundle in development (e.g. `192.168.1.20:8081`). */
export function getDevServerHost(): string | null {
  const hostUri =
    (Constants.expoConfig as { hostUri?: string } | null)?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | null)?.debuggerHost ??
    null;
  if (!hostUri) return null;
  const host = hostUri.split('/')[0].split(':')[0];
  return host || null;
}

export function resolveApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured && configured.trim().length > 0) {
    return withVersion(configured.trim());
  }

  if (Platform.OS === 'web') {
    const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
    const isLocalHost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
    if (!origin || isLocalHost) {
      return `http://127.0.0.1:${API_PORT}/api/${API_VERSION}`;
    }
    return `${origin}/api/${API_VERSION}`;
  }

  const devHost = getDevServerHost();
  const host = devHost && devHost !== 'localhost' && devHost !== '127.0.0.1' ? devHost : '127.0.0.1';
  return `http://${host}:${API_PORT}/api/${API_VERSION}`;
}

export const apiConfig = {
  baseUrl: resolveApiBaseUrl(),
  /** Per-request ceiling; field devices on 3G need patience for report generation. */
  timeoutMs: 20_000,
  /** Automatic retries for idempotent requests only. */
  maxRetries: 2,
  currency: 'XAF',
  appName: 'FEMS',
  appVersion: (Constants.expoConfig?.version as string | undefined) ?? '1.0.0',
};

export function isDevice(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}
