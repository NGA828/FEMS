/**
 * Theme provider.
 *
 * Exposes the active theme (light/dark/system) plus `useThemeTone(tone)` for the
 * screens that must render in a fixed palette ("Mission Control" GIS + AI
 * console + field capture) regardless of the user's preference.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { themes, type Theme, type ThemeMode, type ThemePreference } from './tokens';

const STORAGE_KEY = 'fems.theme.preference';

interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  mode: ThemeMode;
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: themes.light,
  preference: 'system',
  mode: 'light',
  setPreference: () => {},
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && (stored === 'light' || stored === 'dark' || stored === 'system')) {
          setPreferenceState(stored);
        }
      })
      .catch(() => {
        // A missing preference store is not fatal: fall back to the system theme.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const mode: ThemeMode = preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: themes[mode],
      preference,
      mode,
      setPreference,
      toggle: () => setPreference(mode === 'dark' ? 'light' : 'dark'),
    }),
    [mode, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

export function useThemeController(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Force a palette for a subtree — used by the map, AI console and field capture. */
export function useThemeTone(tone: ThemeMode | 'inherit'): Theme {
  const { theme } = useThemeController();
  if (tone === 'inherit') return theme;
  return themes[tone];
}

export type { Theme, ThemeMode, ThemePreference };
