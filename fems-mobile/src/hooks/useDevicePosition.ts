/**
 * Device GPS.
 *
 * Every coordinate the app records comes from the device: `expo-location` on
 * iOS/Android and the browser Geolocation API on web. There is no fallback
 * coordinate and no default city — when the position cannot be obtained the
 * screens say so and offer a retry, because a field record with invented
 * coordinates is worse than no record at all.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

export interface DeviceFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  altitudeM: number | null;
  capturedAt: string;
  /** True when the platform flagged the fix as simulated/mocked. */
  mocked: boolean;
  /** Source recorded with the API payload. */
  source: 'DEVICE_GPS' | 'MANUAL_CORRECTION';
}

export type LocationErrorCode = 'PERMISSION_DENIED' | 'SERVICES_DISABLED' | 'TIMEOUT' | 'UNAVAILABLE';

export interface LocationError {
  code: LocationErrorCode;
  message: string;
}

export interface UseDevicePositionResult {
  fix: DeviceFix | null;
  /** Latest accuracy in metres while watching, or the accuracy of the last fix. */
  accuracyM: number | null;
  status: 'idle' | 'requesting' | 'acquiring' | 'ready' | 'error';
  error: LocationError | null;
  permission: 'granted' | 'denied' | 'undetermined';
  /** True while a fix is being acquired. */
  loading: boolean;
  refresh: () => Promise<DeviceFix | null>;
  startWatching: () => Promise<void>;
  stopWatching: () => void;
  clearError: () => void;
}

const ACCURACY_TIMEOUT_MS = 25_000;

function mapError(error: unknown): LocationError {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('denied') || message.includes('permission')) {
    return { code: 'PERMISSION_DENIED', message: 'Location permission is denied. Enable it in the device settings to capture field data.' };
  }
  if (message.includes('disabled') || message.includes('services')) {
    return { code: 'SERVICES_DISABLED', message: 'Location services are turned off on this device.' };
  }
  if (message.includes('timeout')) {
    return { code: 'TIMEOUT', message: 'No GPS fix within 25 seconds. Move to an open area and try again.' };
  }
  return { code: 'UNAVAILABLE', message: 'The device could not provide a position right now. Try again.' };
}

export function useDevicePosition(options?: { watch?: boolean; accuracy?: Location.Accuracy }): UseDevicePositionResult {
  const [fix, setFix] = useState<DeviceFix | null>(null);
  const [status, setStatus] = useState<UseDevicePositionResult['status']>('idle');
  const [error, setError] = useState<LocationError | null>(null);
  const [permission, setPermission] = useState<UseDevicePositionResult['permission']>('undetermined');
  const watchSubscription = useRef<Location.LocationSubscription | null>(null);
  const webWatchId = useRef<number | null>(null);

  const applyPosition = useCallback((position: Location.LocationObject) => {
    const next: DeviceFix = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyM: position.coords.accuracy ?? null,
      altitudeM: position.coords.altitude ?? null,
      capturedAt: new Date(position.timestamp).toISOString(),
      mocked: Boolean(position.mocked),
      source: position.mocked ? 'MANUAL_CORRECTION' : 'DEVICE_GPS',
    };
    setFix(next);
    setStatus('ready');
    setError(null);
    return next;
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      setPermission('denied');
      setStatus('error');
      setError({ code: 'SERVICES_DISABLED', message: 'Location services are turned off on this device.' });
      return false;
    }
    const { status: permissionStatus } = await Location.requestForegroundPermissionsAsync();
    setPermission(permissionStatus === 'granted' ? 'granted' : 'denied');
    if (permissionStatus !== 'granted') {
      setStatus('error');
      setError({
        code: 'PERMISSION_DENIED',
        message: 'FEMS needs foreground location permission to attach a verified position to field data.',
      });
      return false;
    }
    return true;
  }, []);

  const fetchCurrent = useCallback(async (): Promise<Location.LocationObject> => {
    const accuracy = options?.accuracy ?? Location.Accuracy.High;
    if (Platform.OS === 'web') {
      // expo-location on web maps to the browser API but does not always honour
      // accuracy/timeout options, so the browser call is used directly.
      return new Promise<Location.LocationObject>((resolve, reject) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          reject(new Error('Geolocation unavailable'));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) =>
            resolve({
              coords: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy ?? null,
                altitude: position.coords.altitude ?? null,
                altitudeAccuracy: position.coords.altitudeAccuracy ?? null,
                heading: position.coords.heading ?? null,
                speed: position.coords.speed ?? null,
              },
              timestamp: position.timestamp,
              mocked: false,
            } as Location.LocationObject),
          (browserError) => reject(new Error(browserError.code === 1 ? 'Permission denied' : browserError.message || 'Unavailable')),
          { enableHighAccuracy: true, timeout: ACCURACY_TIMEOUT_MS, maximumAge: 0 },
        );
      });
    }
    return Location.getCurrentPositionAsync({ accuracy, mayShowUserSettingsDialog: true });
  }, [options?.accuracy]);

  const refresh = useCallback(async (): Promise<DeviceFix | null> => {
    setStatus((current) => (current === 'ready' ? current : 'requesting'));
    try {
      if (permission === 'undetermined') {
        const granted = await requestPermission();
        if (!granted) return null;
      }
      setStatus('acquiring');
      const position = await fetchCurrent();
      return applyPosition(position);
    } catch (caught) {
      setStatus('error');
      setError(mapError(caught));
      return null;
    }
  }, [permission, requestPermission, fetchCurrent, applyPosition]);

  const stopWatching = useCallback(() => {
    watchSubscription.current?.remove();
    watchSubscription.current = null;
    if (webWatchId.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(webWatchId.current);
      webWatchId.current = null;
    }
  }, []);

  const startWatching = useCallback(async () => {
    try {
      if (permission !== 'granted') {
        const granted = await requestPermission();
        if (!granted) return;
      }
      setStatus('acquiring');
      if (Platform.OS === 'web') {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          setStatus('error');
          setError({ code: 'UNAVAILABLE', message: 'This browser does not expose the Geolocation API.' });
          return;
        }
        webWatchId.current = navigator.geolocation.watchPosition(
          (position) =>
            applyPosition({
              coords: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy ?? null,
                altitude: position.coords.altitude ?? null,
                altitudeAccuracy: position.coords.altitudeAccuracy ?? null,
                heading: position.coords.heading ?? null,
                speed: position.coords.speed ?? null,
              },
              timestamp: position.timestamp,
              mocked: false,
            } as Location.LocationObject),
          (browserError) => {
            setStatus('error');
            setError(mapError(new Error(browserError.code === 1 ? 'Permission denied' : browserError.message)));
          },
          { enableHighAccuracy: true, maximumAge: 2000, timeout: ACCURACY_TIMEOUT_MS },
        );
        return;
      }
      watchSubscription.current = await Location.watchPositionAsync(
        { accuracy: options?.accuracy ?? Location.Accuracy.High, distanceInterval: 10, timeInterval: 10_000 },
        applyPosition,
      );
    } catch (caught) {
      setStatus('error');
      setError(mapError(caught));
    }
  }, [permission, requestPermission, options?.accuracy, applyPosition]);

  // Optional live tracking (used by the map screen and field capture).
  useEffect(() => {
    if (!options?.watch) return;
    void startWatching();
    return () => stopWatching();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.watch]);

  useEffect(() => stopWatching, [stopWatching]);

  return {
    fix,
    accuracyM: fix?.accuracyM ?? null,
    status,
    error,
    permission,
    loading: status === 'requesting' || status === 'acquiring',
    refresh,
    startWatching,
    stopWatching,
    clearError: () => setError(null),
  };
}

/** Accuracy band shown next to a captured position. */
export function accuracyBand(accuracyM: number | null | undefined): { label: string; tone: 'good' | 'fair' | 'poor' } {
  if (accuracyM === null || accuracyM === undefined) return { label: 'Accuracy unknown', tone: 'poor' };
  if (accuracyM <= 15) return { label: `±${Math.round(accuracyM)} m`, tone: 'good' };
  if (accuracyM <= 50) return { label: `±${Math.round(accuracyM)} m`, tone: 'fair' };
  return { label: `±${Math.round(accuracyM)} m`, tone: 'poor' };
}
