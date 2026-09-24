/**
 * Connectivity.
 *
 * The API client reports every failed and successful request, which is a more
 * honest signal than a device-level "has Wi-Fi" flag: a phone can be on a captive
 * portal and still have no route to the FEMS API. A periodic health probe keeps
 * the state fresh while the user is idle, and the queue is flushed automatically
 * as soon as the API answers again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api } from '../api/client-instance';
import { healthApi } from '../api/endpoints';

export interface NetworkStatus {
  offline: boolean;
  /** Null until the first probe has finished. */
  reachable: boolean | null;
  checking: boolean;
  recheck: () => Promise<boolean>;
}

export function useNetworkStatus({ pollMs = 45_000 }: { pollMs?: number } = {}): NetworkStatus {
  const [offline, setOffline] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = api.subscribeToConnectivity((isOffline) => {
      if (!mounted.current) return;
      setOffline(isOffline);
      setReachable(!isOffline);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, []);

  const recheck = useCallback(async (): Promise<boolean> => {
    setChecking(true);
    try {
      await healthApi.check();
      if (mounted.current) {
        setReachable(true);
        setOffline(false);
      }
      return true;
    } catch {
      if (mounted.current) {
        setReachable(false);
        setOffline(true);
      }
      return false;
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    void recheck();
    const interval = setInterval(() => void recheck(), pollMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void recheck();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [pollMs, recheck]);

  return { offline, reachable, checking, recheck };
}
