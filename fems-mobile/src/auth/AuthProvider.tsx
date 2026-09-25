/**
 * Session provider.
 *
 * Holds the signed-in identity, keeps the access token fresh and exposes the
 * permission helpers the UI uses to decide what to show. This is **presentation
 * only**: every action still hits an endpoint whose guards (JWT + role +
 * permission) run on the server, which is the only authority on what a user may
 * do. If a permission is missing here the screen hides the affordance; if it is
 * missing on the server the request is rejected regardless of what the app drew.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError, type TokenBundle } from '../api/client';
import { api } from '../api/client-instance';
import { authApi } from '../api/endpoints';
import type { AuthUser, DirectoryUser } from '../api/types';
import { tokenStore } from './token-store';

interface AuthContextValue {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  permissions: string[];
  /** True when the app has no tokens and the API requires them. */
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signOut: (options?: { allDevices?: boolean }) => Promise<void>;
  /** Applies a fresh user payload (after a profile edit or permission change). */
  setUser: (user: AuthUser | null) => void;
  refreshUser: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...permissions: string[]) => boolean;
  /** Highest privilege check available to the client: `*` or the read-all grants. */
  canReadAll: (module: string) => boolean;
  roles: string[];
  primaryRole: string | null;
  companyId: string | null;
  isCompanyAccount: boolean;
  devWarnings: string[];
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toAuthUser(user: DirectoryUser & { permissions?: string[] }): AuthUser {
  return {
    ...user,
    permissions: user.permissions ?? [],
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'anonymous'>('loading');
  const bootstrapped = useRef(false);

  const clearSession = useCallback(() => {
    setUserState(null);
    setStatus('anonymous');
  }, []);

  /** Refresh callback used by the HTTP client for transparent token rotation. */
  const rotate = useCallback(async (refreshToken: string): Promise<TokenBundle | null> => {
    try {
      const tokens = await authApi.refresh(refreshToken);
      const bundle: TokenBundle = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn };
      await tokenStore.setTokens(bundle);
      return bundle;
    } catch {
      await tokenStore.setTokens(null);
      return null;
    }
  }, []);

  useEffect(() => {
    api.setRefresher(rotate);
    api.setSessionExpiredHandler(() => clearSession());
    return () => {
      api.setRefresher(null);
      api.setSessionExpiredHandler(null);
    };
  }, [rotate, clearSession]);

  const loadProfile = useCallback(async () => {
    const profile = await authApi.me();
    const next = toAuthUser(profile);
    setUserState(next);
    setStatus('authenticated');
    return next;
  }, []);

  // Restore the session on launch.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      const tokens = await tokenStore.getTokens();
      if (!tokens) {
        setStatus('anonymous');
        return;
      }
      try {
        await loadProfile();
      } catch (error) {
        if (error instanceof ApiError && error.isNetworkError) {
          // Offline launch: keep the stored session and let the UI show cached
          // data; permission checks fall back to the last known profile.
          setStatus('anonymous');
        } else {
          await tokenStore.setTokens(null);
          setStatus('anonymous');
        }
      }
    })();
  }, [loadProfile]);

  // Re-validate when the app returns to the foreground after a long pause.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (next) => {
      if (next !== 'active' || status !== 'authenticated') return;
      if (await tokenStore.isExpiring()) {
        const tokens = await tokenStore.getTokens();
        if (tokens) await rotate(tokens.refreshToken);
      }
    });
    return () => subscription.remove();
  }, [status, rotate]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email.trim().toLowerCase(), password);
    await tokenStore.setTokens({
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      expiresIn: result.tokens.expiresIn,
    });
    const profile = await loadProfile();
    return profile;
  }, [loadProfile]);

  const signOut = useCallback(
    async (options?: { allDevices?: boolean }) => {
      try {
        const tokens = await tokenStore.getTokens();
        await authApi.logout(options?.allDevices ? undefined : tokens?.refreshToken);
      } catch {
        // A failed revoke must not trap the user in the app: clear locally anyway.
      }
      await tokenStore.setTokens(null);
      clearSession();
    },
    [clearSession],
  );

  const value = useMemo<AuthContextValue>(() => {
    const permissions = user?.permissions ?? [];
    const roles = (user?.roles ?? []).map((role) => role.name);
    const hasPermission = (permission: string) => permissions.includes('*') || permissions.includes(permission);
    const canReadAll = (module: string) =>
      permissions.includes('*') || permissions.includes(`${module}:read`) || permissions.includes(`${module}:manage`);

    return {
      user,
      status,
      permissions,
      roles,
      primaryRole: roles[0] ?? null,
      companyId: user?.company?.id ?? null,
      isCompanyAccount: Boolean(user?.company?.id) && !permissions.includes('*'),
      hasPermission,
      hasAnyPermission: (...list: string[]) => list.some(hasPermission),
      canReadAll,
      signIn,
      signOut,
      setUser: (next: AuthUser | null) => {
        setUserState(next);
        setStatus(next ? 'authenticated' : 'anonymous');
      },
      refreshUser: async () => {
        await loadProfile();
      },
      devWarnings: tokenStore.usesSecureStorage
        ? []
        : ['Web preview: tokens are kept in browser storage. Release builds use the device keystore.'],
    };
  }, [user, status, signIn, signOut, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/** Convenience hook for permission-driven rendering. */
export function usePermission(permission: string | string[]): boolean {
  const { hasPermission } = useAuth();
  if (Array.isArray(permission)) return permission.every(hasPermission);
  return hasPermission(permission);
}

export function useAnyPermission(permissions: string[]): boolean {
  const { hasAnyPermission } = useAuth();
  return hasAnyPermission(...permissions);
}
