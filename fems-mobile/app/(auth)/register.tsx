/**
 * Self-service registration.
 *
 * Only the two roles the API accepts are offered (`FOREST_EXPLORER` and
 * `COMPANY_REPRESENTATIVE`); a company registration also creates the company
 * profile, which is created in PENDING status until a forest officer verifies it.
 * When SMTP is not configured the API reports the real delivery status and — in
 * non-production — returns the verification code, which is shown here so the flow
 * can be completed instead of dead-ending.
 */
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../src/api/client';
import { authApi, type RegisterPayload } from '../../src/api/endpoints';
import { useTheme } from '../../src/theme/theme';
import {
  Body,
  Button,
  Caption,
  Chip,
  Notice,
  Overline,
  Row,
  SelectSheet,
  TextField,
  Title,
  useToast,
} from '../../src/ui';

type RequestedRole = 'FOREST_EXPLORER' | 'COMPANY_REPRESENTATIVE';

const COMPANY_TYPES = [
  { value: 'LOGGING_COMPANY', label: 'Logging company', description: 'Timber harvesting under an exploitation permit' },
  { value: 'SAWMILL', label: 'Sawmill', description: 'Primary processing of logs' },
  { value: 'TIMBER_TRADER', label: 'Timber trader', description: 'Trade and transport of timber' },
  { value: 'COOPERATIVE', label: 'Cooperative', description: 'Community forest management' },
  { value: 'WOOD_PROCESSING', label: 'Wood processing', description: 'Secondary transformation' },
  { value: 'ARTISANAL', label: 'Artisanal', description: 'Artisanal permits and salvage logging' },
  { value: 'OTHER', label: 'Other', description: 'Another forestry activity' },
] as const;

const REGIONS = [
  'Centre',
  'Littoral',
  'South',
  'South-West',
  'North-West',
  'West',
  'East',
  'Adamawa',
  'North',
  'Far North',
] as const;

export default function RegisterScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();

  const [role, setRole] = useState<RequestedRole>('FOREST_EXPLORER');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyRegistrationNumber, setCompanyRegistrationNumber] = useState('');
  const [companyType, setCompanyType] = useState<(typeof COMPANY_TYPES)[number]['value'] | null>(null);
  const [companyCity, setCompanyCity] = useState('');
  const [companyRegion, setCompanyRegion] = useState<(typeof REGIONS)[number] | null>(null);
  const [companyAddress, setCompanyAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<{ delivered: boolean; code?: string; message: string } | null>(null);
  const [accepted, setAccepted] = useState(false);

  const isCompany = role === 'COMPANY_REPRESENTATIVE';

  const errors = useMemo(() => {
    const map: Record<string, string> = { ...serverFields };
    if (firstName.trim().length < 2) map.firstName = 'Enter your first name.';
    if (lastName.trim().length < 2) map.lastName = 'Enter your last name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) map.email = 'Enter a valid email address.';
    if (password.length < 8) map.password = 'Use at least 8 characters.';
    if (confirmPassword !== password) map.confirmPassword = 'The two passwords do not match.';
    if (isCompany) {
      if (companyName.trim().length < 3) map.companyName = 'Enter the registered company name.';
      if (companyRegistrationNumber.trim().length < 4) map.companyRegistrationNumber = 'Enter the registration number (RCCM).';
      if (!companyType) map.companyType = 'Choose the company type.';
      if (!companyRegion) map.companyRegion = 'Choose the region.';
    }
    return map;
  }, [serverFields, firstName, lastName, email, password, confirmPassword, isCompany, companyName, companyRegistrationNumber, companyType, companyRegion]);

  const canSubmit =
    !submitting &&
    Boolean(firstName && lastName && email && password && confirmPassword) &&
    (!isCompany || Boolean(companyName && companyRegistrationNumber && companyType && companyRegion)) &&
    accepted;

  const submit = async () => {
    setSubmitting(true);
    setFailure(null);
    setServerFields({});
    const payload: RegisterPayload = {
      email: email.trim().toLowerCase(),
      password,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim() || undefined,
      requestedRole: role,
      ...(isCompany
        ? {
            companyName: companyName.trim(),
            companyRegistrationNumber: companyRegistrationNumber.trim(),
            companyType: companyType ?? undefined,
            companyCity: companyCity.trim() || undefined,
            companyRegion: companyRegion ?? undefined,
            companyAddress: companyAddress.trim() || undefined,
            companyPhone: phone.trim() || undefined,
          }
        : {}),
    };

    try {
      const response = await authApi.register(payload);
      setResult({
        delivered: response.verification.emailDelivery === 'SENT',
        code: response.verification.developmentCode,
        message: response.verification.emailDeliveryMessage,
      });
      toast.success('Account created', response.verification.emailDeliveryMessage);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setServerFields(fieldErrors(caught));
        setFailure(caught.message);
      } else {
        setFailure(caught instanceof Error ? caught.message : 'Registration failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 32, gap: 16 }}>
        <Ionicons name="checkmark-circle" size={52} color={theme.colors.success} />
        <Title>Account created</Title>
        <Notice tone={result.delivered ? 'success' : 'warning'} title={result.delivered ? 'Verification email sent' : 'Verification email not delivered'}>
          {result.message}
        </Notice>
        {result.code ? (
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: 18,
              gap: 6,
            }}
          >
            <Overline>Verification code</Overline>
            <Body style={{ fontSize: 26, fontWeight: '800', letterSpacing: 6 }}>{result.code}</Body>
            <Caption tone="muted">
              SMTP is not configured on this deployment, so the API returned the code instead of hiding it. In production the code is only sent by email.
            </Caption>
          </View>
        ) : null}
        <Button
          label="Enter verification code"
          icon="key-outline"
          onPress={() => router.replace({ pathname: '/verify-email', params: { email: email.trim().toLowerCase() } })}
          fullWidth
        />
        <Button label="Back to sign in" variant="ghost" onPress={() => router.replace('/login')} fullWidth />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={{ marginBottom: 12, alignSelf: 'flex-start' }}>
          <Caption tone="primary" style={{ fontWeight: '700' }}>
            ‹ Back
          </Caption>
        </Pressable>

        <Title style={{ marginBottom: 4 }}>Create an account</Title>
        <Caption tone="muted" style={{ marginBottom: 20 }}>
          Government and inspector accounts are created by the administration; self-registration covers forest explorers and company representatives.
        </Caption>

        {failure ? (
          <View style={{ marginBottom: 16 }}>
            <Notice tone="danger" title="Registration failed">
              {failure}
            </Notice>
          </View>
        ) : null}

        <Overline style={{ marginBottom: 8 }}>Account type</Overline>
        <Row gap={8} style={{ marginBottom: 20 }} wrap>
          <Chip
            label="Forest explorer"
            icon="compass-outline"
            selected={role === 'FOREST_EXPLORER'}
            onPress={() => setRole('FOREST_EXPLORER')}
          />
          <Chip label="Company representative" icon="business-outline" selected={isCompany} onPress={() => setRole('COMPANY_REPRESENTATIVE')} />
        </Row>

        <Overline style={{ marginBottom: 12 }}>Your details</Overline>
        <TextField label="First name" required value={firstName} onChangeText={setFirstName} placeholder="Awa" error={errors.firstName} />
        <TextField label="Last name" required value={lastName} onChangeText={setLastName} placeholder="Mballa" error={errors.lastName} />
        <TextField
          label="Email"
          required
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.cm"
          error={errors.email}
        />
        <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+237 6XX XX XX XX" />
        <TextField label="Password" required value={password} onChangeText={setPassword} secureTextEntry error={errors.password} help="At least 8 characters." />
        <TextField label="Confirm password" required value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry error={errors.confirmPassword} />

        {isCompany ? (
          <>
            <Overline style={{ marginTop: 8, marginBottom: 12 }}>Company profile</Overline>
            <TextField
              label="Registered name"
              required
              value={companyName}
              onChangeText={setCompanyName}
              placeholder="Société Forestière du Sud"
              error={errors.companyName}
            />
            <TextField
              label="Registration number (RCCM)"
              required
              value={companyRegistrationNumber}
              onChangeText={setCompanyRegistrationNumber}
              placeholder="RC/DLA/2019/B/1234"
              error={errors.companyRegistrationNumber}
            />
            <SelectSheet
              label="Company type"
              required
              value={companyType}
              options={COMPANY_TYPES.map((entry) => ({ value: entry.value, label: entry.label, description: entry.description }))}
              onChange={setCompanyType}
              error={errors.companyType}
            />
            <SelectSheet
              label="Region"
              required
              value={companyRegion}
              options={REGIONS.map((region) => ({ value: region, label: region }))}
              onChange={setCompanyRegion}
              error={errors.companyRegion}
            />
            <TextField label="City" value={companyCity} onChangeText={setCompanyCity} placeholder="Douala" />
            <TextField label="Address" value={companyAddress} onChangeText={setCompanyAddress} placeholder="Zone industrielle, BP 1234" multiline />
            <Caption tone="muted" style={{ marginBottom: 12 }}>
              A company account is created as <Body style={{ fontWeight: '700' }}>PENDING</Body> until a government forest officer verifies the profile and documents.
            </Caption>
          </>
        ) : null}

        <Pressable
          onPress={() => setAccepted((current) => !current)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
          accessibilityLabel="Accept the platform terms"
          style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 18 }}
        >
          <Ionicons
            name={accepted ? 'checkbox' : 'square-outline'}
            size={20}
            color={accepted ? theme.colors.primary : theme.colors.textMuted}
          />
          <Caption tone="muted" style={{ flex: 1 }}>
            I confirm the information above is accurate and that forest data recorded through FEMS may be used by the ministry for regulatory purposes.
          </Caption>
        </Pressable>

        <Button label="Create account" onPress={submit} loading={submitting} disabled={!canSubmit} fullWidth size="lg" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
