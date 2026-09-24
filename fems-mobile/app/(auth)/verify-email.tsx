/**
 * Email verification.
 *
 * Confirms the code the backend issued and, on success, stores the token pair it
 * returns so the user continues straight into the app instead of signing in
 * again. A resend button re-issues a code through the API and reports the real
 * delivery status.
 */
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../src/api/client';
import { authApi } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/AuthProvider';
import { tokenStore } from '../../src/auth/token-store';
import { useTheme } from '../../src/theme/theme';
import { Button, Caption, Notice, Overline, TextField, Title, useToast } from '../../src/ui';

export default function VerifyEmailScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { refreshUser, setUser } = useAuth();
  const params = useLocalSearchParams<{ email?: string; token?: string }>();

  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState(params.token ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState<{ delivered: boolean; message: string; code?: string } | null>(null);

  useEffect(() => {
    if (params.token) setCode(params.token);
  }, [params.token]);

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.verifyEmail(code.trim());
      if (result.tokens?.accessToken) {
        await tokenStore.setTokens({
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          expiresIn: result.tokens.expiresIn,
        });
        await refreshUser();
      }
      toast.success('Account activated', 'Your email address is verified.');
      router.replace('/dashboard');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await authApi.resendVerification(email.trim().toLowerCase());
      const delivered = response.emailDelivery === 'SENT';
      setResent({ delivered, message: response.message, code: response.developmentCode });
      if (response.developmentCode) setCode(response.developmentCode);
      toast.info(delivered ? 'New code sent' : 'Mail delivery is not configured', response.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not resend the code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 20 }} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={() => {
            setUser(null);
            router.replace('/login');
          }}
          accessibilityRole="button"
          accessibilityLabel="Back to sign in"
          style={{ marginBottom: 16, alignSelf: 'flex-start' }}
        >
          <Caption tone="primary" style={{ fontWeight: '700' }}>
            ‹ Back to sign in
          </Caption>
        </Pressable>

        <View style={{ alignItems: 'center', marginBottom: 22, gap: 8 }}>
          <Ionicons name="mail-open-outline" size={40} color={theme.colors.primary} />
          <Title>Verify your email</Title>
          <Caption tone="muted" style={{ textAlign: 'center' }}>
            Enter the verification code issued to your address to activate the account.
          </Caption>
        </View>

        {error ? (
          <View style={{ marginBottom: 16 }}>
            <Notice tone="danger" title="Verification failed">
              {error}
            </Notice>
          </View>
        ) : null}

        {resent ? (
          <View style={{ marginBottom: 16 }}>
            <Notice tone={resent.delivered ? 'success' : 'warning'} title={resent.delivered ? 'Code sent' : 'Mail delivery is not configured'}>
              {resent.message}
            </Notice>
          </View>
        ) : null}

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@fems.cm"
        />
        <TextField
          label="Verification code"
          required
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          placeholder="ABC123"
          help={resent?.code ? `Code: ${resent.code}` : undefined}
        />

        <Button label="Activate account" onPress={verify} loading={busy} disabled={!code.trim() || busy} fullWidth size="lg" icon="shield-checkmark-outline" />
        <View style={{ marginTop: 10 }}>
          <Button
            label="Send a new code"
            variant="secondary"
            onPress={resend}
            loading={busy}
            disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || busy}
            fullWidth
          />
        </View>

        <View style={{ marginTop: 22 }}>
          <Overline style={{ marginBottom: 6 }}>Why this step exists</Overline>
          <Caption tone="muted">
            Forest data is regulatory evidence. Every account is tied to a verified address so that submissions, decisions and audit entries can be attributed
            to a real person.
          </Caption>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
