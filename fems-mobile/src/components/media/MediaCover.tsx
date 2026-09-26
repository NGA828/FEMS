/**
 * Renders a database-resident media asset as a cover image.
 *
 * Falls back to a branded gradient panel (emblem + label) when a record has no
 * seeded cover yet, so catalogue cards always look intentional instead of broken.
 */
import React from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { mediaImageUrl } from '../../api/endpoints';
import type { MediaDescriptor } from '../../api/types';
import { useTone } from '../../ui/context';
import { Caption } from '../../ui/text';
import { LogoMark } from '../brand/Logo';

export function MediaCover({
  descriptor,
  fallbackLabel,
  height = 150,
  borderRadius = 14,
  style,
}: {
  descriptor: MediaDescriptor | null | undefined;
  fallbackLabel?: string;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTone();
  const url = mediaImageUrl(descriptor ?? null);

  const frame: StyleProp<ViewStyle> = [
    { height, borderRadius, overflow: 'hidden', backgroundColor: theme.colors.surfaceAlt },
    style,
  ];

  if (!url) {
    return (
      <View
        style={[
          frame,
          {
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            backgroundColor: theme.isDark ? theme.colors.surfaceAlt : theme.colors.primarySoft,
          },
        ]}
      >
        <LogoMark size={Math.round(height / 3)} mono={theme.isDark} />
        {fallbackLabel ? (
          <Caption tone="muted" style={{ textAlign: 'center', paddingHorizontal: 12 }}>
            {fallbackLabel}
          </Caption>
        ) : (
          <Ionicons name="image-outline" size={18} color={theme.colors.textFaint} />
        )}
      </View>
    );
  }

  return (
    <View style={frame}>
      <Image
        source={{ uri: url }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="cover"
        accessibilityLabel={descriptor?.altText ?? fallbackLabel ?? 'Forest media'}
      />
    </View>
  );
}
