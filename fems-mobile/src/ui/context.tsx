/**
 * Design context.
 *
 * `ToneProvider` lets a subtree render in a fixed palette: the GIS map, the AI
 * alert console and the field-capture wizard wrap themselves in the dark
 * "Mission Control" tone while the rest of the app follows the user's theme
 * preference. Components read the tone through `useTone()` instead of touching
 * the global theme, so both cases work without duplicating styles.
 */
import React, { createContext, useContext, useMemo } from 'react';
import { themes, type Theme, type ThemeMode } from '../theme/tokens';

export const ToneContext = createContext<Theme>(themes.light);

export function ToneProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ToneContext.Provider value={theme}>{children}</ToneContext.Provider>;
}

/** Forces a palette for the wrapped subtree. */
export function ToneScope({ tone, children }: { tone: ThemeMode; children: React.ReactNode }) {
  const theme = useMemo(() => themes[tone], [tone]);
  return <ToneProvider theme={theme}>{children}</ToneProvider>;
}

export function useTone(): Theme {
  return useContext(ToneContext);
}
