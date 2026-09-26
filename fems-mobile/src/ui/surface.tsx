/**
 * Layout primitives: screens, cards, sections and rows.
 *
 * `Screen` handles the safe area, the themed background and — on the dark
 * "Mission Control" surfaces — the status bar style, so a screen only declares
 * its content.
 */
import React from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../theme/tokens';
import { useTone } from './context';
import { Body, Caption, Heading, Overline } from './text';

export interface ScreenProps extends ViewProps {
  /** Adds the bottom tab bar height to the padding so content is never hidden. */
  tabBar?: boolean;
  /** Content scrolling: `false` renders a plain view (maps, camera-like screens). */
  scroll?: boolean;
  refresh?: { refreshing: boolean; onRefresh: () => void };
  contentStyle?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function Screen({
  tabBar = false,
  scroll = true,
  refresh,
  contentStyle,
  children,
  style,
  ...rest
}: ScreenProps) {
  const theme = useTone();
  const insets = useSafeAreaInsets();
  // The tab navigator already insets tab screens above the bar, so we only add a
  // consistent breathing gap + the safe-area inset. Adding the full bar height
  // here used to leave a large unexplained blank band at the bottom of screens.
  const bottomPadding = insets.bottom + spacing.xl;

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        { padding: spacing.lg, paddingBottom: bottomPadding },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        refresh ? (
          <RefreshControl
            refreshing={refresh.refreshing}
            onRefresh={refresh.onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        ) : undefined
      }
      {...(rest as ScrollViewProps)}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, { paddingTop: spacing.sm }, contentStyle]} {...rest}>
      {children}
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      {body}
    </View>
  );
}

export function Card({
  children,
  style,
  padded = true,
  onPress,
  ...rest
}: ViewProps & { padded?: boolean; onPress?: () => void }) {
  const theme = useTone();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: padded ? spacing.lg : 0,
        },
        theme.shadows.card,
        style,
      ]}
      onTouchEnd={onPress}
      {...rest}
    >
      {children}
    </View>
  );
}

export function Section({
  title,
  action,
  children,
  style,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTone();
  return (
    <View style={[{ marginBottom: spacing.xl }, style]}>
      {title ? (
        <View style={[styles.sectionHeader, { marginBottom: spacing.md }]}>
          <Overline style={{ letterSpacing: 1.2, color: theme.colors.textMuted }}>{title}</Overline>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Row({
  children,
  gap = spacing.sm,
  align = 'center',
  justify = 'flex-start',
  wrap = false,
  style,
  ...rest
}: ViewProps & {
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: boolean;
}) {
  return (
    <View
      style={[{ flexDirection: 'row', alignItems: align, justifyContent: justify, gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}
      {...rest}
    >
      {children}
    </View>
  );
}

export function Column({
  children,
  gap = spacing.sm,
  style,
  ...rest
}: ViewProps & { gap?: number }) {
  return (
    <View style={[{ flexDirection: 'column', gap }, style]} {...rest}>
      {children}
    </View>
  );
}

export function Spacer({ size = spacing.md }: { size?: number }) {
  return <View style={{ height: size }} />;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTone();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border }, style]} />;
}

/** Label/value pair used in detail grids. */
export function Definition({
  label,
  value,
  tone,
  style,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'muted' | 'primary' | 'danger' | 'warning' | 'success';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    // Stable two-up grid: each cell takes ~half the row so label/value pairs align
    // in tidy columns instead of ragged widths.
    <View style={[{ marginBottom: spacing.md, flexGrow: 1, flexBasis: '46%' }, style]}>
      <Caption tone="muted" style={{ marginBottom: 2 }}>
        {label}
      </Caption>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Body tone={tone ?? 'default'}>{value}</Body>
      ) : (
        (value as React.ReactElement)
      )}
    </View>
  );
}

/** Inline message block: the only way screens report success, warning or error text. */
export function Notice({
  tone = 'info',
  title,
  children,
  icon,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  title?: string;
  children?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  const theme = useTone();
  const palette = {
    info: { fg: theme.colors.info, bg: theme.colors.infoSoft },
    success: { fg: theme.colors.success, bg: theme.colors.successSoft },
    warning: { fg: theme.colors.warning, bg: theme.colors.warningSoft },
    danger: { fg: theme.colors.danger, bg: theme.colors.dangerSoft },
    neutral: { fg: theme.colors.neutral, bg: theme.colors.neutralSoft },
  }[tone];

  return (
    <View
      style={{
        backgroundColor: palette.bg,
        borderRadius: theme.radii.md,
        padding: spacing.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.fg,
        flexDirection: 'row',
        gap: spacing.sm,
      }}
    >
      {icon ? <View style={{ paddingTop: 1 }}>{icon}</View> : null}
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Body style={{ color: palette.fg, fontWeight: '700' }}>{title}</Body> : null}
        {typeof children === 'string' ? <Caption style={{ color: palette.fg }}>{children}</Caption> : children}
      </View>
    </View>
  );
}

/** Page header with optional back action and right-hand controls. */
export function PageHeader({
  title,
  subtitle,
  onBack,
  right,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  compact?: boolean;
}) {
  const theme = useTone();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: spacing.md,
        marginBottom: compact ? spacing.md : spacing.lg,
        paddingTop: onBack ? spacing.sm : 0,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={10}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs, alignSelf: 'flex-start', marginTop: -2 }}
          >
            <Ionicons name="arrow-back" size={15} color={theme.colors.primary} />
            <Caption style={{ color: theme.colors.primary, fontWeight: '700' }}>Back</Caption>
          </Pressable>
        ) : null}
        <Heading>{title}</Heading>
        {subtitle ? <Caption tone="muted">{subtitle}</Caption> : null}
      </View>
      {right ? <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>{right}</View> : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
