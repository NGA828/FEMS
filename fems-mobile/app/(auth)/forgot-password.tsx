/**
 * Password recovery — two steps against the real API.
 *
 * 1. `POST /auth/password/forgot` asks the backend to send a reset link. When
 *    SMTP is not configured the response says the mail was not delivered and
 *    (outside production) returns the token, which the screen surfaces so the
 *    flow can still be completed.
 * 2. `POST /auth/password/reset` sets the new password using that token.
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../src/api/client';
import { authApi } from '../../src/api/endpoints';
import { useTheme } from '../../src/theme/theme';
import { Body, Button, Caption, Notice, Overline, TextField, Title, useToast } from '../../src/ui';

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<{ delivered: boolean; message: string; token?: string } | null>(null);

  const requestReset = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await authApi.forgotPassword(email.trim().toLowerCase());
      const delivered = response.emailDelivery === 'SENT';
      setDelivery({ delivered, message: response.message, token: response.developmentCode });
      if (response.developmentCode) setToken(response.developmentCode);
      setStep('reset');
      toast.info(delivered ? 'Reset email sent' : 'Reset email not delivered', response.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? fieldErrors(caught).email ?? caught.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.resetPassword(token.trim(), password);
      toast.success('Password updated', 'Sign in with your new password.');
      router.replace('/login');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The reset failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 20 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={{ marginBottom: 16, alignSelf: 'flex-start' }}>
          <Caption tone="primary" style={{ fontWeight: '700' }}>
            ‹ Back
          </Caption>
        </Pressable>

        <Title style={{ marginBottom: 4 }}>Reset your password</Title>
        <Caption tone="muted" style={{ marginBottom: 24 }}>
          {step === 'request'
            ? 'Enter the email address of your FEMS account and we will send a reset link.'
            : 'Paste the reset token and choose a new password.'}
        </Caption>

        {error ? (
          <View style={{ marginBottom: 16 }}>
            <Notice tone="danger" title="Could not continue">
              {error}
            </Notice>
          </View>
        ) : null}

        {step === 'request' ? (
          <>
            <TextField
              label="Email"
              required
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@fems.cm"
            />
            <Button
              label="Send reset link"
              onPress={requestReset}
              loading={busy}
              disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || busy}
              fullWidth
              size="lg"
            />
          </>
        ) : (
          <>
            {delivery ? (
              <View style={{ marginBottom: 16 }}>
                <Notice tone={delivery.delivered ? 'success' : 'warning'} title={delivery.delivered ? 'Check your inbox' : 'Mail delivery is not configured'}>
                  {delivery.message}
                </Notice>
              </View>
            ) : null}
            {delivery?.token ? (
              <View
                style={{
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radii.lg,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  padding: 16,
                  marginBottom: 16,
                  gap: 4,
                }}
              >
                <Overline>Reset token</Overline>
                <Body style={{ fontWeight: '600' }} selectable>
                  {delivery.token}
                </Body>
                <Caption tone="muted">Returned by the API because SMTP is not configured on this deployment.</Caption>
              </View>
            ) : null}

            <TextField label="Reset token" required icon="key-outline" value={token} onChangeText={setToken} autoCapitalize="none" />
            <TextField label="New password" required secureTextEntry value={password} onChangeText={setPassword} help="At least 8 characters." />
            <TextField label="Confirm password" required secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} />
            <Button
              label="Set new password"
              icon="shield-checkmark-outline"
              onPress={resetPassword}
              loading={busy}
              disabled={!token || !password || busy}
              fullWidth
              size="lg"
            />
            <View style={{ marginTop: 12 }}>
              <Button label="Use a different email" variant="ghost" onPress={() => setStep('request')} fullWidth />
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
