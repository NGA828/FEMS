/**
 * Interactive controls.
 *
 * Every control is a real, wired component: `Button` reports its own loading
 * state instead of pretending a request succeeded, `TextField` surfaces the
 * validation message the API returned for that field, and `SelectSheet` renders
 * the options the API catalogue actually returned (never a hardcoded list).
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing } from '../theme/tokens';
import { useTone } from './context';
import { Body, Caption, Overline, Tiny } from './text';
import { Divider, Row } from './surface';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  accessibilityHint,
}: ButtonProps) {
  const theme = useTone();
  const palette = {
    primary: { bg: theme.colors.primary, fg: theme.colors.onPrimary, border: theme.colors.primary },
    accent: { bg: theme.colors.accent, fg: theme.colors.onAccent, border: theme.colors.accent },
    secondary: { bg: theme.colors.surface, fg: theme.colors.primary, border: theme.colors.borderStrong },
    ghost: { bg: 'transparent', fg: theme.colors.primary, border: 'transparent' },
    danger: { bg: theme.colors.dangerSoft, fg: theme.colors.danger, border: theme.colors.danger },
  }[variant];

  const heights: Record<ButtonSize, number> = { sm: 34, md: 44, lg: 52 };
  const fontSizes: Record<ButtonSize, number> = { sm: 13, md: 15, lg: 16 };
  const isBlocked = disabled || loading;

  return (
    <Pressable
      onPress={isBlocked ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: isBlocked, busy: loading }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        {
          height: heights[size],
          paddingHorizontal: size === 'sm' ? spacing.md : spacing.lg,
          borderRadius: size === 'sm' ? theme.radii.sm : theme.radii.md,
          backgroundColor: palette.bg,
          borderWidth: variant === 'ghost' ? 0 : StyleSheet.hairlineWidth * 2,
          borderColor: palette.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          opacity: isBlocked ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : icon ? (
        <Ionicons name={icon} size={size === 'sm' ? 15 : 18} color={palette.fg} />
      ) : null}
      <Body style={{ color: palette.fg, fontWeight: '600', fontSize: fontSizes[size] }}>{label}</Body>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  tone = 'default',
  size = 20,
  badge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  tone?: 'default' | 'primary' | 'danger' | 'muted';
  size?: number;
  badge?: number;
}) {
  const theme = useTone();
  const color = {
    default: theme.colors.text,
    primary: theme.colors.primary,
    danger: theme.colors.danger,
    muted: theme.colors.textMuted,
  }[tone];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      style={({ pressed }) => [
        {
          width: size + 20,
          height: size + 20,
          borderRadius: theme.radii.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
        },
      ]}
    >
      <Ionicons name={icon} size={size} color={color} />
      {badge && badge > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 8,
            backgroundColor: theme.colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Tiny style={{ color: theme.colors.textInverted, fontWeight: '700' }}>{badge > 99 ? '99+' : badge}</Tiny>
        </View>
      ) : null}
    </Pressable>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  tone,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: 'default' | 'accent' | 'danger';
}) {
  const theme = useTone();
  const accent = tone === 'accent' ? theme.colors.accent : tone === 'danger' ? theme.colors.danger : theme.colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 6,
        paddingHorizontal: spacing.md,
        borderRadius: theme.radii.pill,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: selected ? accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {icon ? <Ionicons name={icon} size={13} color={selected ? accent : theme.colors.textMuted} /> : null}
      <Caption style={{ color: selected ? accent : theme.colors.textMuted, fontWeight: selected ? '700' : '500' }}>
        {label}
      </Caption>
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTone();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.surfaceAlt,
        borderRadius: theme.radii.md,
        padding: 3,
        gap: 3,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: theme.radii.sm,
              backgroundColor: active ? theme.colors.surface : 'transparent',
              alignItems: 'center',
            }}
          >
            <Caption style={{ color: active ? theme.colors.primary : theme.colors.textMuted, fontWeight: '600' }}>
              {option.label}
            </Caption>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search',
  onSubmit,
  autoFocus = false,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  const theme = useTone();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        borderRadius: theme.radii.md,
        paddingHorizontal: spacing.md,
        height: 44,
      }}
    >
      <Ionicons name="search" size={17} color={theme.colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textFaint}
        autoFocus={autoFocus}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        style={{ flex: 1, color: theme.colors.text, fontSize: 15, paddingVertical: 0 }}
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
          <Ionicons name="close-circle" size={17} color={theme.colors.textFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  help?: string;
  required?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  suffix?: string;
  style?: StyleProp<ViewStyle>;
}

export function TextField({ label, error, help, required, icon, suffix, style, ...rest }: TextFieldProps) {
  const theme = useTone();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? theme.colors.danger : focused ? theme.colors.primary : theme.colors.border;

  return (
    <View style={[{ marginBottom: spacing.md }, style]}>
      <Row gap={4} style={{ marginBottom: 6 }}>
        <Overline style={{ letterSpacing: 0.8, color: theme.colors.textMuted }}>{label}</Overline>
        {required ? <Tiny style={{ color: theme.colors.danger }}>*</Tiny> : null}
      </Row>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          borderWidth: focused || error ? 1.5 : StyleSheet.hairlineWidth,
          borderColor,
          borderRadius: theme.radii.md,
          backgroundColor: theme.colors.surface,
          paddingHorizontal: spacing.md,
          minHeight: 46,
        }}
      >
        {icon ? <Ionicons name={icon} size={17} color={theme.colors.textMuted} /> : null}
        <TextInput
          placeholderTextColor={theme.colors.textFaint}
          accessibilityLabel={label}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            color: theme.colors.text,
            fontSize: 15,
            paddingVertical: rest.multiline ? spacing.sm : 0,
            minHeight: rest.multiline ? 88 : undefined,
            textAlignVertical: rest.multiline ? 'top' : 'center',
          }}
          {...rest}
        />
        {suffix ? <Caption tone="muted">{suffix}</Caption> : null}
      </View>
      {error ? (
        <Caption style={{ color: theme.colors.danger, marginTop: 4 }}>{error}</Caption>
      ) : help ? (
        <Caption tone="faint" style={{ marginTop: 4 }}>
          {help}
        </Caption>
      ) : null}
    </View>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export function SelectSheet<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  error,
  required,
  disabled = false,
}: {
  label: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
}) {
  const theme = useTone();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Row gap={4} style={{ marginBottom: 6 }}>
        <Overline style={{ letterSpacing: 0.8, color: theme.colors.textMuted }}>{label}</Overline>
        {required ? <Tiny style={{ color: theme.colors.danger }}>*</Tiny> : null}
      </Row>
      <Pressable
        onPress={disabled ? undefined : () => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        accessibilityState={{ disabled }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.sm,
          minHeight: 46,
          paddingHorizontal: spacing.md,
          borderRadius: theme.radii.md,
          borderWidth: error ? 1.5 : StyleSheet.hairlineWidth,
          borderColor: error ? theme.colors.danger : theme.colors.border,
          backgroundColor: disabled ? theme.colors.surfaceAlt : theme.colors.surface,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Body tone={selected ? 'default' : 'faint'} lines={1}>
          {selected?.label ?? placeholder}
        </Body>
        <Ionicons name="chevron-down" size={16} color={theme.colors.textMuted} />
      </Pressable>
      {error ? <Caption style={{ color: theme.colors.danger, marginTop: 4 }}>{error}</Caption> : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(4,18,12,0.55)' }} onPress={() => setOpen(false)} />
        <View
          style={{
            maxHeight: '62%',
            backgroundColor: theme.colors.surfaceElevated,
            borderTopLeftRadius: theme.radii.xl,
            borderTopRightRadius: theme.radii.xl,
            paddingBottom: spacing.xl,
          }}
        >
          <Row justify="space-between" style={{ padding: spacing.lg }}>
            <Body style={{ fontWeight: '700' }}>{label}</Body>
            <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={theme.colors.textMuted} />
            </Pressable>
          </Row>
          <Divider />
          <ScrollView keyboardShouldPersistTaps="handled">
            {options.map((option) => {
              const active = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={{
                    paddingVertical: spacing.md,
                    paddingHorizontal: spacing.lg,
                    backgroundColor: active ? theme.colors.primarySoft : 'transparent',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: spacing.md,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: active ? '700' : '500', color: active ? theme.colors.primary : theme.colors.text }}>
                      {option.label}
                    </Body>
                    {option.description ? (
                      <Caption tone="muted" style={{ marginTop: 2 }}>
                        {option.description}
                      </Caption>
                    ) : null}
                  </View>
                  {active ? <Ionicons name="checkmark" size={18} color={theme.colors.primary} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

export function ChecklistToggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTone();
  return (
    <Row justify="space-between" align="center" style={{ paddingVertical: spacing.sm, gap: spacing.md }}>
      <View style={{ flex: 1 }}>
        <Body>{label}</Body>
        {description ? <Caption tone="muted">{description}</Caption> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
        thumbColor={theme.colors.surface}
        accessibilityLabel={label}
      />
    </Row>
  );
}

/** Numeric stepper used by the harvest form (volume in m³). */
export function NumberStepper({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  suffix,
  error,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  error?: string | null;
}) {
  const theme = useTone();
  const clamp = (next: number) => Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, Number(next.toFixed(2))));
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Overline style={{ letterSpacing: 0.8, color: theme.colors.textMuted, marginBottom: 6 }}>{label}</Overline>
      <Row gap={spacing.sm}>
        <Pressable
          onPress={() => onChange(clamp(value - step))}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          style={{
            width: 46,
            height: 46,
            borderRadius: theme.radii.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="remove" size={18} color={theme.colors.text} />
        </Pressable>
        <View
          style={{
            flex: 1,
            height: 46,
            borderRadius: theme.radii.md,
            borderWidth: error ? 1.5 : StyleSheet.hairlineWidth,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            backgroundColor: theme.colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Body style={{ fontWeight: '700' }}>
            {value}
            {suffix ? ` ${suffix}` : ''}
          </Body>
        </View>
        <Pressable
          onPress={() => onChange(clamp(value + step))}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          style={{
            width: 46,
            height: 46,
            borderRadius: theme.radii.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="add" size={18} color={theme.colors.text} />
        </Pressable>
      </Row>
      {error ? <Caption style={{ color: theme.colors.danger, marginTop: 4 }}>{error}</Caption> : null}
    </View>
  );
}
