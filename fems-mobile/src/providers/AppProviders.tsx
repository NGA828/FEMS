/**
 * Application providers.
 *
 * Ordering matters: the theme is outermost so every provider below can style
 * itself, the toast and confirm providers sit above the query client so mutation
 * errors can be reported, and the auth provider wraps everything that needs a
 * session.
 */
import React, { useEffect, useMemo } from 'react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ApiError } from '../api/client';
import { AuthProvider } from '../auth/AuthProvider';
import { ThemeProvider, useTheme } from '../theme/theme';
import { ToneProvider } from '../ui/context';
import { ConfirmProvider, ToastProvider } from '../ui/feedback';

function queryClientFactory(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: (failureCount, error) => {
          if (error instanceof ApiError) {
            // Never retry a decision the server already made.
            if (error.isForbidden || error.isNotFound || error.isValidation || error.isRateLimited) return false;
            if (error.isUnauthorized) return false;
          }
          return failureCount < 2;
        },
        refetchOnReconnect: true,
      },
      mutations: { retry: 0 },
    },
  });
}

/** Re-validates queries when the app returns to the foreground (native focus). */
function useAppFocus(): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      focusManager.setFocused(status === 'active');
    });
    return () => subscription.remove();
  }, []);
}

function ThemedProviders({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <ToneProvider theme={theme}>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </ToneProvider>
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(queryClientFactory, []);
  useAppFocus();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <ThemedProviders>
              <AuthProvider>{children}</AuthProvider>
            </ThemedProviders>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
