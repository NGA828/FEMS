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
import { View } from 'react-native';
import { AppProviders } from '../src/providers/AppProviders';

export default function RootLayout() {
  return (
    <AppProviders>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
      </View>
    </AppProviders>
  );
}
