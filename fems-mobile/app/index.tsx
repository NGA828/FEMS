/**
 * Entry gate.
 *
 * While the stored session is being restored the app shows a loader rather than
 * flashing the sign-in form; once resolved the user lands either on the
 * dashboard or on the login screen.
 */
import React from 'react';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '../src/auth/AuthProvider';
import { useTheme } from '../src/theme/theme';
import { LogoMark } from '../src/components/brand/Logo';
import { Caption } from '../src/ui';

export default function EntryGate() {
  const { status } = useAuth();
  const theme = useTheme();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background, gap: 12 }}>
        <LogoMark size={64} />
        <Caption tone="muted">Restoring your session…</Caption>
      </View>
    );
  }

  // Signed-out users are viewers first: they land on the public, image-led
  // landing page rather than being thrown at a sign-in form.
  return <Redirect href={status === 'authenticated' ? '/dashboard' : '/welcome'} />;
}
