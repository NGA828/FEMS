/**
 * Public, signed-out experience.
 *
 * A visitor is someone who *views*, not someone who holds an account — so this
 * group renders the landing page, the public forest catalogue and public forest
 * detail with no session requirement and no redirect. Signed-in users are steered
 * to the dashboard by the entry gate instead.
 */
import React from 'react';
import { Stack } from 'expo-router';

export default function PublicLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
