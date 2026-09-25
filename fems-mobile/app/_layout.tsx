/**
 * Root layout.
 *
 * Installs the providers (theme, query cache, toasts, confirmations, session)
 * and mounts the navigation tree. The two route groups decide where a user can
 * be: `(auth)` for the sign-in flow and `(app)` for everything that requires a
 * session.
 */
import React from 'react';
import { Stack } from 'expo-router';
import { AppProviders } from '../src/providers/AppProviders';

export default function RootLayout() {
  return (
    <AppProviders>
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
    </AppProviders>
  );
}
