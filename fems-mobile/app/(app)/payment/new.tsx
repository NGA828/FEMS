/**
 * Initiate a payment.
 *
 * The amount is not free-form for permit fees: the screen reads the permit's own
 * outstanding balance from `GET /permits/:id/actions` (fees charged minus what the
 * backend has already confirmed) and proposes it. The payment is created on the
 * server, which talks to the provider; the app only stores what the provider
 * returns, never an amount or status it invented.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../../src/api/client';
import {
  useInitiatePayment,
  usePaymentProvider,
  usePermit,
  usePermitActions,
  usePermits,
  useViolations,
} from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Button,
  Caption,
  Card,
  Definition,
  Notice,
  Overline,
  Row,
  Section,
  SegmentedControl,
  SelectSheet,
  TextField,
  Tiny,
  Title,
  useToast,
} from '../../../src/ui';
import type { PaymentMethod } from '../../../src/api/types';
import { formatCurrency, formatDate, paymentMethodLabel, paymentPurposeLabel } from '../../../src/lib/format';

const PURPOSES = ['PERMIT_FEE', 'ROYALTY', 'ANNUAL_TAX', 'PENALTY', 'REPLANTING_BOND', 'OTHER'] as const;

export default function NewPaymentScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ permitId?: string; violationId?: string; purpose?: string }>();
  const { user, hasPermission } = useAuth();
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  const provider = usePaymentProvider();
  const permits = usePermits({ status: 'ACTIVE', limit: 50 });
  const violations = useViolations({ status: 'CONFIRMED', limit: 25 });
  const initiate = useInitiatePayment();

  const [target, setTarget] = useState<'permit' | 'violation'>('permit');
  const [permitId, setPermitId] = useState<string | null>(params.permitId ?? null);
  const [violationId, setViolationId] = useState<string | null>(params.violationId ?? null);
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]>((params.purpose as (typeof PURPOSES)[number]) ?? 'PERMIT_FEE');
  const [method, setMethod] = useState<PaymentMethod>(user?.company ? 'MOBILE_MONEY_MTN' : 'BANK_TRANSFER');
  const [amount, setAmount] = useState('');
  const [payerPhone, setPayerPhone] = useState(user?.phone ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});

  const permit = usePermit(permitId);
  const permitActions = usePermitActions(permitId);

  const outstanding = permitActions.data?.outstandingBalance ?? null;
  const selectedViolation = violations.data?.items.find((entry) => entry.id === violationId) ?? null;

  React.useEffect(() => {
    if (target === 'permit' && outstanding !== null && !amount) setAmount(String(Math.max(0, Math.round(outstanding))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outstanding, target]);

  React.useEffect(() => {
    if (target === 'violation' && selectedViolation?.penalty?.outstandingXAF) {
      setAmount(String(Math.round(selectedViolation.penalty.outstandingXAF)));
      setPurpose('PENALTY');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [violationId]);

  /**
   * Methods the API accepts. Campay covers MTN/Orange mobile money; the
   * simulator and the manual channels cover the rest, and the backend rejects a
   * method the provider does not support for the account.
   */
  const methodOptions = useMemo(
    () =>
      (['MOBILE_MONEY_MTN', 'MOBILE_MONEY_ORANGE', 'BANK_TRANSFER', 'CASH'] as const).map((entry) => ({
        value: entry,
        label: paymentMethodLabel(entry, language),
      })),
    [language],
  );

  const problems = useMemo(() => {
    const map: Record<string, string> = { ...serverFields };
    if (target === 'permit' && !permitId) map.permitId = 'Choose the permit this payment settles.';
    if (target === 'violation' && !violationId) map.violationId = 'Choose the case this fine settles.';
    if (!amount || Number(amount) <= 0) map.amount = 'Enter the amount in XAF.';
    if (method.startsWith('MOBILE_MONEY') && payerPhone.trim().length < 8) map.payerPhone = 'A mobile money number is required for this method.';
    return map;
  }, [serverFields, target, permitId, violationId, amount, method, payerPhone]);

  const canSubmit = Object.keys(problems).length === 0 && !busy;

  const submit = async () => {
    setFailure(null);
    setServerFields({});
    setBusy(true);
    try {
      const payment = await initiate.mutateAsync({
        purpose,
        amount: Number(amount),
        method,
        permitId: target === 'permit' ? (permitId ?? undefined) : undefined,
        violationId: target === 'violation' ? (violationId ?? undefined) : undefined,
        payerPhone: method.startsWith('MOBILE_MONEY') ? payerPhone.trim() : undefined,
        notes: notes.trim() || undefined,
      });
      toast.success('Payment initiated', `${formatCurrency(payment.amount, payment.currency ?? 'XAF', language)} — status ${payment.status}.`);
      router.replace({ pathname: '/payment/[id]', params: { id: payment.id } });
    } catch (error) {
      if (error instanceof ApiError) {
        setServerFields(fieldErrors(error));
        setFailure(error.message);
      } else {
        setFailure(error instanceof Error ? error.message : 'The payment could not be initiated.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!hasPermission('payments:create')) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <Notice tone="warning" title="Not available for your role">
          Initiating a payment requires the `payments:create` permission, which your account does not hold.
        </Notice>
        <View style={{ marginTop: 12 }}>
          <Button label="Back to payments" variant="secondary" onPress={() => router.replace('/payments')} fullWidth />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
      keyboardShouldPersistTaps="handled"
    >
      <Row justify="space-between" align="flex-start" style={{ marginBottom: 14 }}>
        <View style={{ flex: 1 }}>
          <Title>New payment</Title>
          <Caption tone="muted">The provider confirms the transaction; FEMS stores what it returns.</Caption>
        </View>
        <Button label="Cancel" variant="ghost" size="sm" onPress={() => router.back()} />
      </Row>

      {provider.data?.provider === 'SIMULATOR' ? (
        <View style={{ marginBottom: 14 }}>
          <Notice tone="warning" title="Sandbox provider active">
            PAYMENT_PROVIDER is `simulator`. The payment goes through real states in the database and is verified by the backend, but no money moves. Add the
            Campay credentials to switch to the live provider.
          </Notice>
        </View>
      ) : null}

      {failure ? (
        <View style={{ marginBottom: 14 }}>
          <Notice tone="danger" title="Payment refused">
            {failure}
          </Notice>
        </View>
      ) : null}

      <Section title="What is being paid">
        <Card>
          <SegmentedControl
            value={target}
            options={[
              { value: 'permit', label: 'Permit fee' },
              { value: 'violation', label: 'Penalty' },
            ]}
            onChange={(value) => {
              setTarget(value as 'permit' | 'violation');
              setAmount('');
            }}
          />

          {target === 'permit' ? (
            <SelectSheet
              label="Permit"
              required
              value={permitId}
              options={(permits.data?.items ?? []).map((entry) => ({
                value: entry.id,
                label: `${entry.permitNumber} — ${entry.title}`,
                description: `${entry.company?.name ?? ''} · ${formatCurrency(entry.feeAmount, entry.currency ?? 'XAF', language)} fee · until ${formatDate(entry.endDate, language)}`,
              }))}
              onChange={setPermitId}
              placeholder={permits.isLoading ? 'Loading permits…' : 'Choose a permit'}
              error={problems.permitId}
            />
          ) : (
            <SelectSheet
              label="Environmental case"
              required
              value={violationId}
              options={(violations.data?.items ?? []).map((entry) => ({
                value: entry.id,
                label: `${entry.reference} — ${entry.title}`,
                description: `penalty ${formatCurrency(entry.penalty?.penaltyAmountXAF ?? entry.penaltyAmountXAF ?? 0, 'XAF', language)} · outstanding ${formatCurrency(
                  entry.penalty?.outstandingXAF ?? 0,
                  'XAF',
                  language,
                )}`,
              }))}
              onChange={setViolationId}
              placeholder={violations.isLoading ? 'Loading cases…' : 'Choose a confirmed case'}
              error={problems.violationId}
            />
          )}

          {target === 'permit' && permit.data ? (
            <View style={{ marginTop: 8 }}>
              <Definition label="Permit" value={`${permit.data.permitNumber} — ${permit.data.status}`} />
              <Definition label="Forest" value={permit.data.forest?.name ?? '—'} />
              <Definition label="Fee charged" value={formatCurrency(permit.data.feeAmount, permit.data.currency ?? 'XAF', language)} />
              <Definition
                label="Already confirmed"
                value={
                  permitActions.data
                    ? formatCurrency(Math.max(0, Number(permit.data.feeAmount ?? 0) - (permitActions.data.outstandingBalance ?? 0)), 'XAF', language)
                    : '—'
                }
              />
              <Definition label="Outstanding" value={outstanding !== null ? formatCurrency(outstanding, 'XAF', language) : '—'} />
            </View>
          ) : null}
        </Card>
      </Section>

      <Section title="How it is paid">
        <Card>
          <SelectSheet label="Purpose" required value={purpose} options={PURPOSES.map((entry) => ({ value: entry, label: paymentPurposeLabel(entry, language) }))} onChange={(value) => setPurpose(value as (typeof PURPOSES)[number])} />
          <SelectSheet
            label="Method"
            required
            value={method}
            options={methodOptions}
            onChange={(value) => setMethod(value as PaymentMethod)}
            placeholder={provider.isLoading ? 'Loading methods…' : 'Choose a method'}
          />
          <TextField
            label="Amount (XAF)"
            required
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
            suffix="XAF"
            error={problems.amount}
            help={outstanding ? `The permit's outstanding balance is ${formatCurrency(outstanding, 'XAF', language)}.` : 'The backend validates the amount against the record it settles.'}
          />
          {method.startsWith('MOBILE_MONEY') ? (
            <TextField
              label="Mobile money number"
              required
              keyboardType="phone-pad"
              value={payerPhone}
              onChangeText={setPayerPhone}
              placeholder="+237 6XX XXX XXX"
              error={problems.payerPhone}
              help="The provider debits this number. Use the number registered with the operator."
            />
          ) : null}
          <TextField label="Notes" multiline value={notes} onChangeText={setNotes} placeholder="Reference of the bank transfer, instruction from the treasury…" />
        </Card>
      </Section>

      <Section title="Summary">
        <Card>
          <Definition label="Pays" value={target === 'permit' ? (permit.data?.permitNumber ?? '—') : (selectedViolation?.reference ?? '—')} />
          <Definition label="Purpose" value={paymentPurposeLabel(purpose, language)} />
          <Definition label="Method" value={paymentMethodLabel(method, language)} />
          <Definition label="Amount" value={amount ? formatCurrency(amount, 'XAF', language) : '—'} />
          <Definition label="Provider" value={provider.data ? (provider.data.provider === 'SIMULATOR' ? 'Local simulator (sandbox)' : provider.data.provider) : '—'} />
        </Card>
      </Section>

      <Card style={{ marginBottom: 14 }}>
        <Row gap={10}>
          <Ionicons name="lock-closed-outline" size={18} color={theme.colors.info} />
          <Caption tone="muted" style={{ flex: 1 }}>
            The app never receives provider credentials and never decides that a payment succeeded. After payment the backend re-queries the provider and only
            then stores the receipt number and the paid status.
          </Caption>
        </Row>
        <Overline style={{ marginTop: 10 }}>Flow</Overline>
        <Row gap={6} style={{ marginTop: 6 }} wrap>
          <Badge label="initiate" tone="primary" />
          <Badge label="provider" tone="neutral" />
          <Badge label="verify" tone="neutral" />
          <Badge label="receipt" tone="neutral" />
        </Row>
        <Tiny tone="faint" style={{ marginTop: 8 }}>
          {contextLine(user?.company?.name)}
        </Tiny>
      </Card>

      <Button label="Initiate payment" icon="card-outline" size="lg" fullWidth loading={busy} disabled={!canSubmit} onPress={() => void submit()} />
    </ScrollView>
  );
}

function contextLine(companyName?: string | null): string {
  return companyName ? `Charged to ${companyName} — the backend enforces that a company can only pay its own records.` : 'Your scope is enforced by the API, not by this screen.';
}
