/**
 * Bottom tab bar.
 *
 * The visible tabs come from the signed-in role (see `src/navigation/tabs.ts`).
 * Routes the role does not use are still registered with `href: null` so deep
 * links resolve to a real screen that performs its own permission check rather
 * than to a dead route.
 */
import React from 'react';
import { Tabs } from 'expo-router';
import { Platform, type ColorValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../src/auth/AuthProvider';
import { tabsFor, type TabName } from '../../../src/navigation/tabs';
import { useTheme } from '../../../src/theme/theme';

export default function TabsLayout() {
  const theme = useTheme();
  const { user } = useAuth();
  const visible = new Set(tabsFor(user).map((tab) => tab.name));

  const options = (name: TabName, title: string, icon: keyof typeof Ionicons.glyphMap) => ({
    title,
    href: visible.has(name) ? undefined : null,
    tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={icon} size={size} color={color as string} />,
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textFaint,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          height: theme.tabBarHeight + (Platform.OS === 'ios' ? 12 : 0),
          paddingTop: 6,
          paddingBottom: Platform.OS === 'ios' ? 18 : 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="dashboard" options={options('dashboard', 'Home', 'grid-outline')} />
      <Tabs.Screen name="map" options={options('map', 'Map', 'map-outline')} />
      <Tabs.Screen name="permits" options={options('permits', 'Permits', 'document-text-outline')} />
      <Tabs.Screen name="field" options={options('field', 'Field', 'walk-outline')} />
      <Tabs.Screen name="alerts" options={options('alerts', 'Alerts', 'warning-outline')} />
      <Tabs.Screen name="payments" options={options('payments', 'Payments', 'card-outline')} />
      <Tabs.Screen name="forests" options={options('forests', 'Forests', 'leaf-outline')} />
      <Tabs.Screen name="assistant" options={options('assistant', 'Assistant', 'sparkles-outline')} />
      <Tabs.Screen name="sync" options={options('sync', 'Sync', 'cloud-upload-outline')} />
      <Tabs.Screen name="profile" options={options('profile', 'Profile', 'person-circle-outline')} />
    </Tabs>
  );
}
