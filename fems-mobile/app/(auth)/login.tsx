/**
 * Sign-in.
 *
 * The form posts to `/auth/login`; the backend applies lockout after repeated
 * failures and reports the reason (bad credentials, unverified address, locked or
 * suspended account) with a machine-readable code, which is what the user sees.
 * Demo accounts are listed so a reviewer can sign in as any of the eight roles —
 * they are the seeded accounts, not a bypass.
 */
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { apiConfig } from '../../src/api/config';
import { useTheme } from '../../src/theme/theme';
import { Button, Caption, Notice, Overline, Row, TextField, Body, Divider } from '../../src/ui';
import { useToast } from '../../src/ui';
import { LogoLockup } from '../../src/components/brand/Logo';

/** Seeded accounts, one per role — printed with the password used by the seed. */
const DEMO_ACCOUNTS: { email: string; role: string; label: string }[] = [
  { email: 'demo.admin@fems.cm', role: 'Administrator', label: 'System administrator' },
  { email: 'demo.officer@fems.cm', role: 'Government', label: 'Permit decisions, monitoring' },
  { email: 'demo.environment@fems.cm', role: 'Environmental', label: 'Protected areas, cases' },
  { email: 'demo.inspector@fems.cm', role: 'Inspector', label: 'Field inspections' },
  { email: 'demo.operator@fems.cm', role: 'Operator', label: 'Harvest capture in the field' },
  { email: 'demo.company@fems.cm', role: 'Company', label: 'Applications, payments' },
  { email: 'demo.cooperative@fems.cm', role: 'Cooperative', label: 'Community forest' },
  { email: 'demo.explorer@fems.cm', role: 'Explorer', label: 'Public data, AI assistant' },
  { email: 'demo.visitor@fems.cm', role: 'Visitor', label: 'Restricted account' },
];

const DEMO_PASSWORD = 'FemsDemo#2026';

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDemo, setShowDemo] = useState(false);

  const validation = useMemo(() => {
    const problems: { email?: string; password?: string } = {};
    if (email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) problems.email = 'Enter a valid email address.';
    if (password.length > 0 && password.length < 6) problems.password = 'Passwords are at least 6 characters.';
    return problems;
  }, [email, password]);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !validation.email && !validation.password && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const user = await signIn(email, password);
      toast.success(`Welcome back, ${user.firstName}`, `${user.roles.map((role) => role.label).join(', ')}`);
      router.replace('/dashboard');
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fields = fieldErrors(caught);
        if (caught.code === 'AUTH_EMAIL_NOT_VERIFIED') {
          setError('Your email address has not been verified yet. Enter the code that was sent to you.');
          router.push({ pathname: '/verify-email', params: { email: email.trim().toLowerCase() } });
        } else if (caught.code === 'AUTH_ACCOUNT_LOCKED') {
          setError('The account is temporarily locked after too many failed attempts. Try again in a few minutes.');
        } else {
          setError(fields.email ?? fields.password ?? caught.message);
        }
      } else {
        setError(caught instanceof Error ? caught.message : 'Sign-in failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 28 }}>
          <LogoLockup markSize={76} subtitle="Monitoring, regulating and analysing forest exploitation across Cameroon." />
        </View>

        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.xl,
            padding: 20,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            ...theme.shadows.card,
          }}
        >
          <Overline style={{ marginBottom: 14 }}>Sign in</Overline>

          {error ? (
            <View style={{ marginBottom: 14 }}>
              <Notice tone="danger" title="Sign-in failed">
                {error}
              </Notice>
            </View>
          ) : null}

          <TextField
            label="Email"
            required
            icon="mail-outline"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@fems.cm"
            error={validation.email}
          />

          <TextField
            label="Password"
            required
            icon="lock-closed-outline"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            placeholder="••••••••"
            error={validation.password}
            onSubmitEditing={() => canSubmit && submit()}
            returnKeyType="go"
          />

          <Row justify="space-between" style={{ marginBottom: 16 }}>
            <Pressable onPress={() => setShowPassword((current) => !current)} accessibilityRole="button" accessibilityLabel="Toggle password visibility">
              <Caption tone="primary">{showPassword ? 'Hide password' : 'Show password'}</Caption>
            </Pressable>
            <Link href="/forgot-password" asChild>
              <Pressable accessibilityRole="link" accessibilityLabel="Forgot password">
                <Caption tone="primary">Forgot password?</Caption>
              </Pressable>
            </Link>
          </Row>

          <Button label="Sign in" onPress={submit} loading={submitting} disabled={!canSubmit} fullWidth size="lg" icon="log-in-outline" />

          <Row justify="center" gap={6} style={{ marginTop: 16 }}>
            <Caption tone="muted">No account yet?</Caption>
            <Link href="/register" asChild>
              <Pressable accessibilityRole="link" accessibilityLabel="Create an account">
                <Caption tone="primary" style={{ fontWeight: '700' }}>
                  Register
                </Caption>
              </Pressable>
            </Link>
          </Row>
        </View>

        <View style={{ marginTop: 20 }}>
          <Pressable onPress={() => setShowDemo((current) => !current)} accessibilityRole="button" accessibilityLabel="Show demonstration accounts">
            <Row justify="space-between" style={{ paddingVertical: 12 }}>
              <Row gap={6}>
                <Ionicons name="people-outline" size={16} color={theme.colors.textMuted} />
                <Caption tone="muted">Demonstration accounts (seeded data)</Caption>
              </Row>
              <Ionicons name={showDemo ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.textMuted} />
            </Row>
          </Pressable>
          {showDemo ? (
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.lg,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                padding: 6,
              }}
            >
              {DEMO_ACCOUNTS.map((account, index) => (
                <Pressable
                  key={account.email}
                  onPress={() => {
                    setEmail(account.email);
                    setPassword(DEMO_PASSWORD);
                    setError(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${account.role} account ${account.email}`}
                  style={({ pressed }) => ({
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: theme.radii.md,
                    backgroundColor: pressed ? theme.colors.primarySoft : 'transparent',
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  })}
                >
                  <Row justify="space-between">
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontWeight: '600' }}>{account.role}</Body>
                      <Caption tone="muted">{account.label}</Caption>
                    </View>
                    <Caption tone="faint">{account.email.split('@')[0]}</Caption>
                  </Row>
                </Pressable>
              ))}
              <View style={{ padding: 12 }}>
                <Divider />
                <Caption tone="faint" style={{ marginTop: 10 }}>
                  Password for every demo account: {DEMO_PASSWORD}
                </Caption>
              </View>
            </View>
          ) : null}
        </View>

        <View style={{ marginTop: 24, alignItems: 'center', gap: 4 }}>
          <Caption tone="faint">API {apiConfig.baseUrl}</Caption>
          <Caption tone="faint">FEMS {apiConfig.appVersion}</Caption>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
