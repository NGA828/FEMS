/**
 * FEMS design tokens.
 *
 * Two palettes ship with the app:
 *
 *  • `light`  — "Verdant Enterprise": white/off-white surfaces, deep forest
 *               green primary, amber and earth accents. Used for authentication,
 *               dashboards, permits, payments, reports and company screens.
 *  • `dark`   — "Mission Control": near-black green field, mint primary, amber
 *               alerts. Used for the GIS map, the AI alert console and field
 *               capture, where operators need low-light, high-contrast surfaces.
 *
 * Colours are semantic: screens never hardcode a hex value, they read a role
 * (`colors.primary`, `colors.danger`, …) so the two palettes stay consistent.
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = ThemeMode | 'system';

export interface ThemeColors {
  /** Screen background. */
  background: string;
  /** Card, sheet and input background. */
  surface: string;
  /** Recessed background (section headers, table stripes, chips). */
  surfaceAlt: string;
  /** Highest elevation surface (modals, popovers). */
  surfaceElevated: string;
  /** Hairline border. */
  border: string;
  /** Emphasised border (focus rings, selected rows). */
  borderStrong: string;
  /** Brand colour and its variants. */
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;
  /** Secondary brand accent (amber). */
  accent: string;
  accentSoft: string;
  onAccent: string;
  /** Earth/wood accent used for timber-related affordances. */
  earth: string;
  earthSoft: string;
  /** Foreground text roles. */
  text: string;
  textMuted: string;
  textFaint: string;
  textInverted: string;
  /** Feedback roles. */
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  neutral: string;
  neutralSoft: string;
  /** Map-specific. */
  mapBackground: string;
  mapGrid: string;
  mapWater: string;
}

export interface ThemeTypography {
  display: TextStyle;
  h1: TextStyle;
  h2: TextStyle;
  h3: TextStyle;
  body: TextStyle;
  bodyStrong: TextStyle;
  small: TextStyle;
  tiny: TextStyle;
  mono: TextStyle;
}

export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
  typography: ThemeTypography;
  spacing: typeof spacing;
  radii: typeof radii;
  shadows: typeof shadows;
  isDark: boolean;
  /** Height reserved for the bottom tab bar so screens can pad scroll content. */
  tabBarHeight: number;
}

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 44,
} as const;

export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const shadows = {
  none: {},
  card: Platform.select<ViewStyle>({
    ios: { shadowColor: '#0B241C', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 2 },
    default: {},
  }) as ViewStyle,
  raised: Platform.select<ViewStyle>({
    ios: { shadowColor: '#0B241C', shadowOpacity: 0.16, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
    android: { elevation: 6 },
    default: {},
  }) as ViewStyle,
} as const;

const fontFamily = Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' });
const monoFamily = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

function typographyFor(colors: ThemeColors): ThemeTypography {
  const base = { fontFamily, color: colors.text } satisfies TextStyle;
  return {
    display: { ...base, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.4 },
    h1: { ...base, fontSize: 23, lineHeight: 29, fontWeight: '700', letterSpacing: -0.2 },
    h2: { ...base, fontSize: 19, lineHeight: 25, fontWeight: '700' },
    h3: { ...base, fontSize: 16, lineHeight: 22, fontWeight: '600' },
    body: { ...base, fontSize: 15, lineHeight: 21, fontWeight: '400' },
    bodyStrong: { ...base, fontSize: 15, lineHeight: 21, fontWeight: '600' },
    small: { ...base, fontSize: 13, lineHeight: 18, fontWeight: '400' },
    tiny: { ...base, fontSize: 11, lineHeight: 15, fontWeight: '500', letterSpacing: 0.2 },
    mono: { ...base, fontFamily: monoFamily, fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
  };
}

export const lightColors: ThemeColors = {
  background: '#F4F7F3',
  surface: '#FFFFFF',
  surfaceAlt: '#EDF3EC',
  surfaceElevated: '#FFFFFF',
  border: '#E1E8DE',
  borderStrong: '#C6D3C1',
  primary: '#16653F',
  primaryPressed: '#0F4A2D',
  primarySoft: '#E3F1E7',
  onPrimary: '#FFFFFF',
  accent: '#C97B18',
  accentSoft: '#FBEEDA',
  onAccent: '#3A2405',
  earth: '#7A5C43',
  earthSoft: '#F0E8DF',
  text: '#10241B',
  textMuted: '#556B5F',
  textFaint: '#86988C',
  textInverted: '#FFFFFF',
  success: '#1B7F4B',
  successSoft: '#E1F4E8',
  warning: '#A96A12',
  warningSoft: '#FBF0DC',
  danger: '#AE2A20',
  dangerSoft: '#FBE7E4',
  info: '#1D6FA5',
  infoSoft: '#E3EFF8',
  neutral: '#5C6B62',
  neutralSoft: '#EBEFEC',
  mapBackground: '#E8EFE6',
  mapGrid: 'rgba(16,36,27,0.08)',
  mapWater: '#BFD8E8',
};

export const darkColors: ThemeColors = {
  background: '#05120E',
  surface: '#0B1F19',
  surfaceAlt: '#123027',
  surfaceElevated: '#14382E',
  border: '#1C3B31',
  borderStrong: '#2C5748',
  primary: '#4ADE80',
  primaryPressed: '#37C46B',
  primarySoft: 'rgba(74,222,128,0.14)',
  onPrimary: '#052015',
  accent: '#F0B24A',
  accentSoft: 'rgba(240,178,74,0.16)',
  onAccent: '#2A1B02',
  earth: '#C8A47E',
  earthSoft: 'rgba(200,164,126,0.16)',
  text: '#E8F5EE',
  textMuted: '#9CBCAF',
  textFaint: '#6E8C80',
  textInverted: '#04120C',
  success: '#4ADE80',
  successSoft: 'rgba(74,222,128,0.14)',
  warning: '#F5B74C',
  warningSoft: 'rgba(245,183,76,0.16)',
  danger: '#FF7A6B',
  dangerSoft: 'rgba(255,122,107,0.16)',
  info: '#6EC6FF',
  infoSoft: 'rgba(110,198,255,0.16)',
  neutral: '#9CBCAF',
  neutralSoft: 'rgba(156,188,175,0.14)',
  mapBackground: '#04100C',
  mapGrid: 'rgba(232,245,238,0.07)',
  mapWater: '#123A4A',
};

export function makeTheme(mode: ThemeMode): Theme {
  const colors = mode === 'dark' ? darkColors : lightColors;
  return {
    mode,
    colors,
    typography: typographyFor(colors),
    spacing,
    radii,
    shadows,
    isDark: mode === 'dark',
    tabBarHeight: 62,
  };
}

export const themes: Record<ThemeMode, Theme> = {
  light: makeTheme('light'),
  dark: makeTheme('dark'),
};

/** Colour for a risk/severity level, shared by every module that shows one. */
export function riskColor(theme: Theme, level: string | null | undefined): { fg: string; bg: string } {
  const c = theme.colors;
  switch ((level ?? '').toUpperCase()) {
    case 'CRITICAL':
      return { fg: c.danger, bg: c.dangerSoft };
    case 'HIGH':
      return { fg: c.warning, bg: c.warningSoft };
    case 'MODERATE':
    case 'MEDIUM':
      return { fg: c.accent, bg: c.accentSoft };
    case 'LOW':
      return { fg: c.success, bg: c.successSoft };
    default:
      return { fg: c.textMuted, bg: c.neutralSoft };
  }
}
