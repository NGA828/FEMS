/**
 * FEMS brand mark.
 *
 * The emblem — a tree rising from concentric growth rings inside a seal, crossed
 * by a topographic contour line — stands for what the system does: it keeps the
 * *record* (growth rings) of the *forest* (canopy) on the *map* (contour). It is
 * used consistently on the splash, the auth screens, the visitor landing page and
 * the dashboards, replacing the generic leaf glyph.
 */
import React from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTone } from '../../ui/context';
import { Caption, Overline } from '../../ui/text';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO_COLOR = require('../../../assets/brand/logo-color.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO_MONO = require('../../../assets/brand/logo-mono.png');

export function LogoMark({
  size = 48,
  mono = false,
  style,
}: {
  size?: number;
  /** Force the single-colour emblem (for dark surfaces). */
  mono?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTone();
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Image
        source={mono || theme.isDark ? LOGO_MONO : LOGO_COLOR}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityLabel="FEMS emblem"
      />
    </View>
  );
}

/** Emblem + wordmark, used on the landing hero and sign-in screens. */
export function LogoLockup({
  mono = false,
  subtitle,
  align = 'center',
  markSize = 56,
}: {
  mono?: boolean;
  subtitle?: string;
  align?: 'center' | 'left';
  markSize?: number;
}) {
  const centered = align === 'center';
  return (
    <View style={{ alignItems: centered ? 'center' : 'flex-start', gap: 8 }}>
      <LogoMark size={markSize} mono={mono} />
      <View style={{ alignItems: centered ? 'center' : 'flex-start', gap: 2 }}>
        <Overline tone={mono ? 'inverted' : 'primary'} style={{ fontSize: 16, letterSpacing: 3, fontWeight: '800' }}>
          FEMS
        </Overline>
        <Caption tone={mono ? 'inverted' : 'muted'} style={{ textAlign: centered ? 'center' : 'left', maxWidth: 260 }}>
          {subtitle ?? 'Forest Exploitation Management System'}
        </Caption>
      </View>
    </View>
  );
}
