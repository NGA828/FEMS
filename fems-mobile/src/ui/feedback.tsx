/**
 * Feedback surfaces: skeletons, empty and error states, toasts, confirmation
 * sheets and the offline banner.
 *
 * States are explicit everywhere: a screen that is loading shows a skeleton laid
 * out like its content, a screen with no rows says which filter produced the
 * empty list, and a failed request shows the server's message plus a retry — no
 * screen ever shows invented data or a spinner that never resolves.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../api/client';
import { spacing } from '../theme/tokens';
import { useTone } from './context';
import { Body, Caption, Heading, Tiny } from './text';
import { Button, IconButton } from './controls';
import { Divider, Row } from './surface';

// -------------------------------------------------------------------- skeleton

export function Skeleton({
  width = '100%',
  height = 14,
  radius,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTone();
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius ?? theme.radii.sm, backgroundColor: theme.colors.surfaceAlt, opacity },
        style,
      ]}
    />
  );
}

/** Skeleton shaped like a list row — used while a collection loads. */
export function SkeletonList({ rows = 4, style }: { rows?: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTone();
  return (
    <View style={[{ gap: spacing.md }, style]}>
      {Array.from({ length: rows }).map((_, index) => (
        <View
          key={index}
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.lg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            padding: spacing.lg,
            gap: spacing.sm,
          }}
        >
          <Row justify="space-between">
            <Skeleton width="55%" height={16} />
            <Skeleton width={70} height={20} radius={theme.radii.pill} />
          </Row>
          <Skeleton width="80%" />
          <Skeleton width="40%" height={12} />
        </View>
      ))}
    </View>
  );
}

export function SkeletonDetail({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTone();
  return (
    <View style={[{ gap: spacing.md }, style]}>
      <Skeleton width="70%" height={22} />
      <Skeleton width="45%" height={14} />
      <View
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.lg,
          padding: spacing.lg,
          gap: spacing.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        }}
      >
        {Array.from({ length: 5 }).map((_, index) => (
          <View key={index} style={{ flexDirection: 'row', gap: spacing.lg }}>
            <Skeleton width={90} height={12} />
            <Skeleton width={140} height={12} />
          </View>
        ))}
      </View>
    </View>
  );
}

// ------------------------------------------------------------- empty / errors

export function EmptyState({
  title,
  description,
  icon = 'leaf-outline',
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const theme = useTone();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxxl, paddingHorizontal: spacing.lg, gap: spacing.md }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: theme.radii.pill,
          backgroundColor: theme.colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={28} color={theme.colors.primary} />
      </View>
      <Heading style={{ textAlign: 'center' }}>{title}</Heading>
      {description ? (
        <Caption tone="muted" style={{ textAlign: 'center', maxWidth: 320 }}>
          {description}
        </Caption>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
      {secondaryLabel && onSecondary ? <Button label={secondaryLabel} onPress={onSecondary} variant="ghost" size="sm" /> : null}
    </View>
  );
}

export function ErrorState({
  error,
  onRetry,
  title,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const theme = useTone();
  const apiError = error instanceof ApiError ? error : null;
  const heading = title ?? (apiError?.isForbidden ? 'Not available for your role' : apiError?.isOffline ? 'You are offline' : 'Something went wrong');
  const description =
    apiError?.message ??
    (error instanceof Error ? error.message : 'The request could not be completed. Please try again.');

  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxxl, paddingHorizontal: spacing.lg, gap: spacing.md }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: theme.radii.pill,
          backgroundColor: apiError?.isOffline ? theme.colors.warningSoft : theme.colors.dangerSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons
          name={apiError?.isOffline ? 'cloud-offline-outline' : apiError?.isForbidden ? 'lock-closed-outline' : 'alert-circle-outline'}
          size={28}
          color={apiError?.isOffline ? theme.colors.warning : theme.colors.danger}
        />
      </View>
      <Heading style={{ textAlign: 'center' }}>{heading}</Heading>
      <Caption tone="muted" style={{ textAlign: 'center', maxWidth: 340 }}>
        {description}
      </Caption>
      {apiError?.code ? (
        <Caption tone="faint" style={{ textAlign: 'center' }}>
          {apiError.code} · HTTP {apiError.status || '—'}
        </Caption>
      ) : null}
      {onRetry ? <Button label="Try again" icon="refresh" onPress={onRetry} variant="secondary" /> : null}
    </View>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  const theme = useTone();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm }}>
      <ActivityIndicator color={theme.colors.primary} />
      <Caption tone="muted">{label}</Caption>
    </View>
  );
}

/** Inline badge shown while a screen refreshes data it already displays. */
export function RefreshingPill({ visible, label = 'Refreshing…' }: { visible: boolean; label?: string }) {
  const theme = useTone();
  if (!visible) return null;
  return (
    <Row
      gap={6}
      style={{
        alignSelf: 'flex-start',
        backgroundColor: theme.colors.surfaceAlt,
        paddingVertical: 4,
        paddingHorizontal: spacing.md,
        borderRadius: theme.radii.pill,
      }}
    >
      <ActivityIndicator size="small" color={theme.colors.textMuted} />
      <Tiny tone="muted">{label}</Tiny>
    </Row>
  );
}

// ---------------------------------------------------------------------- toasts

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: 'success' | 'error' | 'info' | 'warning';
}

interface ToastContextValue {
  show: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {}, success: () => {}, error: () => {}, info: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const theme = useTone();
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);
      setTimeout(() => dismiss(id), toast.tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (title, description) => show({ title, description, tone: 'success' }),
      error: (title, description) => show({ title, description, tone: 'error' }),
      info: (title, description) => show({ title, description, tone: 'info' }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg }}>
        {toasts.map((toast) => {
          const palette = {
            success: { fg: theme.colors.success, bg: theme.colors.successSoft, icon: 'checkmark-circle' as const },
            error: { fg: theme.colors.danger, bg: theme.colors.dangerSoft, icon: 'alert-circle' as const },
            warning: { fg: theme.colors.warning, bg: theme.colors.warningSoft, icon: 'warning' as const },
            info: { fg: theme.colors.info, bg: theme.colors.infoSoft, icon: 'information-circle' as const },
          }[toast.tone];

          return (
            <Pressable
              key={toast.id}
              onPress={() => dismiss(toast.id)}
              accessibilityRole="alert"
              accessibilityLabel={`${toast.title}. ${toast.description ?? ''}`}
              style={{
                flexDirection: 'row',
                gap: spacing.sm,
                alignItems: 'flex-start',
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: palette.fg,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderRadius: theme.radii.md,
                padding: spacing.md,
                marginTop: spacing.sm,
                ...theme.shadows.raised,
              }}
            >
              <Ionicons name={palette.icon} size={18} color={palette.fg} />
              <View style={{ flex: 1, gap: 2 }}>
                <Body style={{ fontWeight: '700' }}>{toast.title}</Body>
                {toast.description ? <Caption tone="muted">{toast.description}</Caption> : null}
              </View>
              <Ionicons name="close" size={14} color={theme.colors.textFaint} />
            </Pressable>
          );
        })}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

// ------------------------------------------------------- confirmation sheets

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Ask the reviewer for a written reason (stored in the audit trail). */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** Minimum number of characters the server accepts for a reason. */
  reasonMinLength?: number;
  /** Extra fields rendered above the buttons (e.g. an approved volume). */
  extra?: React.ReactNode;
}

export interface ConfirmResult {
  confirmed: boolean;
  reason?: string;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<ConfirmResult>;
}

const ConfirmContext = createContext<ConfirmContextValue>({ confirm: async () => ({ confirmed: false }) });

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const theme = useTone();
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (result: ConfirmResult) => void } | null>(null);
  const [reason, setReason] = useState('');

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<ConfirmResult>((resolve) => {
        setReason('');
        setState({ options, resolve });
      }),
    [],
  );

  const close = useCallback(
    (result: ConfirmResult) => {
      state?.resolve(result);
      setState(null);
    },
    [state],
  );

  const value = useMemo(() => ({ confirm }), [confirm]);
  const options = state?.options;
  const minimum = options?.reasonMinLength ?? 10;
  const reasonTooShort = Boolean(options?.requireReason) && reason.trim().length < minimum;

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal visible={Boolean(state)} transparent animationType="fade" onRequestClose={() => close({ confirmed: false })}>
        <View style={{ flex: 1, backgroundColor: 'rgba(4,18,12,0.6)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: theme.colors.surfaceElevated,
              borderTopLeftRadius: theme.radii.xl,
              borderTopRightRadius: theme.radii.xl,
              padding: spacing.xl,
              gap: spacing.md,
            }}
          >
            <Heading>{options?.title ?? ''}</Heading>
            {options?.message ? <Caption tone="muted">{options.message}</Caption> : null}
            {options?.extra}
            {options?.requireReason ? (
              <View>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder={options.reasonPlaceholder ?? 'Explain the decision — recorded in the audit trail'}
                  placeholderTextColor={theme.colors.textFaint}
                  multiline
                  accessibilityLabel={options.reasonLabel ?? 'Reason'}
                  style={{
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.colors.border,
                    borderRadius: theme.radii.md,
                    backgroundColor: theme.colors.surface,
                    color: theme.colors.text,
                    fontSize: 15,
                    minHeight: 76,
                    padding: spacing.md,
                    textAlignVertical: 'top',
                  }}
                />
                <Caption tone={reasonTooShort ? 'muted' : 'faint'} style={{ marginTop: 4 }}>
                  {reason.trim().length}/{minimum} characters minimum
                </Caption>
              </View>
            ) : null}
            <Divider />
            <Row gap={spacing.sm} justify="flex-end">
              <Button label={options?.cancelLabel ?? 'Cancel'} variant="ghost" onPress={() => close({ confirmed: false })} />
              <Button
                label={options?.confirmLabel ?? 'Confirm'}
                variant={options?.destructive ? 'danger' : 'primary'}
                disabled={reasonTooShort}
                onPress={() => close({ confirmed: true, reason: reason.trim() || undefined })}
              />
            </Row>
          </View>
        </View>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  return useContext(ConfirmContext);
}

/** Action sheet listing the transitions the server returned for a record. */
export function ActionSheet({
  visible,
  title,
  subtitle,
  actions,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  actions: { key: string; label: string; description?: string; destructive?: boolean; requiresReason?: boolean }[];
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const theme = useTone();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(4,18,12,0.55)' }} onPress={onClose} accessibilityLabel="Close menu" />
      <View
        style={{
          backgroundColor: theme.colors.surfaceElevated,
          borderTopLeftRadius: theme.radii.xl,
          borderTopRightRadius: theme.radii.xl,
          paddingBottom: spacing.xxl,
          maxHeight: '70%',
        }}
      >
        <Row justify="space-between" style={{ padding: spacing.lg }}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '700' }}>{title}</Body>
            {subtitle ? <Caption tone="muted">{subtitle}</Caption> : null}
          </View>
          <IconButton icon="close" label="Close" onPress={onClose} />
        </Row>
        <Divider />
        <ScrollView>
          {actions.length === 0 ? (
            <Caption tone="muted" style={{ padding: spacing.lg }}>
              No action is available on this record for your role right now.
            </Caption>
          ) : (
            actions.map((action) => (
              <Pressable
                key={action.key}
                onPress={() => {
                  onClose();
                  onSelect(action.key);
                }}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={({ pressed }) => ({
                  padding: spacing.lg,
                  backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
                  flexDirection: 'row',
                  gap: spacing.md,
                  alignItems: 'center',
                })}
              >
                <Ionicons
                  name={action.destructive ? 'alert-circle-outline' : 'arrow-forward-circle-outline'}
                  size={20}
                  color={action.destructive ? theme.colors.danger : theme.colors.primary}
                />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '600', color: action.destructive ? theme.colors.danger : theme.colors.text }}>
                    {action.label}
                  </Body>
                  {action.description ? <Caption tone="muted">{action.description}</Caption> : null}
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
