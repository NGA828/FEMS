/**
 * Typographic primitives.
 *
 * Every piece of text in the app goes through one of these components so the two
 * palettes and the type scale stay consistent: a screen never sets a raw
 * `fontSize` or colour, it picks a role (`Title`, `Body`, `Caption`, …).
 */
import React from 'react';
import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';
import { useTone } from './context';

type Tone = 'default' | 'muted' | 'faint' | 'primary' | 'accent' | 'danger' | 'warning' | 'success' | 'info' | 'inverted';

export interface AppTextProps extends TextProps {
  tone?: Tone;
  align?: TextStyle['textAlign'];
  /** Number of lines before truncation (RN default wrapping otherwise). */
  lines?: number;
  children?: React.ReactNode;
}

function toneColor(tone: Tone, theme: ReturnType<typeof useTone>): string {
  const c = theme.colors;
  switch (tone) {
    case 'muted':
      return c.textMuted;
    case 'faint':
      return c.textFaint;
    case 'primary':
      return c.primary;
    case 'accent':
      return c.accent;
    case 'danger':
      return c.danger;
    case 'warning':
      return c.warning;
    case 'success':
      return c.success;
    case 'info':
      return c.info;
    case 'inverted':
      return c.textInverted;
    default:
      return c.text;
  }
}

function createTextComponent(baseStyle: keyof ReturnType<typeof useTone>['typography']) {
  const Component = ({ tone = 'default', align, lines, style, children, ...rest }: AppTextProps) => {
    const theme = useTone();
    return (
      <Text
        numberOfLines={lines}
        style={[theme.typography[baseStyle], { color: toneColor(tone, theme), textAlign: align }, style]}
        {...rest}
      >
        {children}
      </Text>
    );
  };
  Component.displayName = `AppText(${baseStyle})`;
  return Component;
}

export const Display = createTextComponent('display');
export const Title = createTextComponent('h1');
export const Heading = createTextComponent('h2');
export const Subheading = createTextComponent('h3');
export const Body = createTextComponent('body');
export const BodyStrong = createTextComponent('bodyStrong');
export const Caption = createTextComponent('small');
export const Tiny = createTextComponent('tiny');
export const Mono = createTextComponent('mono');

/** Small caps label used above values and section headers. */
export function Overline({ children, tone = 'muted', style, ...rest }: AppTextProps) {
  const theme = useTone();
  return (
    <Text
      style={[
        theme.typography.tiny,
        { color: toneColor(tone, theme), textTransform: 'uppercase', letterSpacing: 1 },
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  );
}

export const styles = StyleSheet.create({});
