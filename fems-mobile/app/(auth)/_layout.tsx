/**
 * Sign-in flow.
 *
 * A valid session never sees these screens: the guard sends the user straight to
 * the dashboard, so deep links behave predictably.
 */
import React from 'react';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/auth/AuthProvider';

export default function AuthLayout() {
  const { status } = useAuth();

  if (status === 'authenticated') return <Redirect href="/dashboard" />;

  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
