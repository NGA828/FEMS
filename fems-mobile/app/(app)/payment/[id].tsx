/**
 * Payment detail.
 *
 * Everything here reflects the provider's own state as recorded by the backend:
 * the reference it issued, the receipt number it returned, the events the API
 * logged, and whether the transaction was checked with the provider. The
 * "simulate" control appears only when the backend reports the sandbox provider,
 * and it is labelled as such — it is never presented as a real collection.
 */
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../../src/api/client';
import {
  usePayment,
  usePaymentProvider,
  usePaymentReceipt,
  useRefundPayment,
  useSimulatePayment,
  useVerifyPayment,
} from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Definition,
  Divider,
  ErrorState,
  Notice,
  Overline,
  Row,
  Section,
  SkeletonDetail,
  StatusPill,
  Tiny,
  Title,
  useConfirm,
  useToast,
} from '../../../src/ui';
import { formatCurrency, formatDateTime, formatRelative, paymentMethodLabel, paymentPurposeLabel, paymentStatusLabel } from '../../../src/lib/format';

export default function PaymentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { user, hasPermission, isCompanyAccount } = useAuth();
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  const payment = usePayment(id ?? null);
  const provider = usePaymentProvider();
  const receipt = usePaymentReceipt(id ?? null);
  const verify = useVerifyPayment(id ?? '');
  const simulate = useSimulatePayment(id ?? '');
  const refund = useRefundPayment(id ?? '');

  const data = payment.data;
  const sandbox = provider.data?.provider === 'SIMULATOR';
  const canVerify = hasPermission('payments:verify');
  const canRefund = hasPermission('payments:refund') || hasPermission('payments:update');
  const pending = data?.status === 'PENDING' || data?.status === 'PROCESSING';

  if (payment.isLoading) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <SkeletonDetail />
      </ScrollView>
    );
  }

  if (payment.isError || !data) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <ErrorState error={payment.error} onRetry={() => payment.refetch()} />
        <Button label="Back to payments" variant="secondary" onPress={() => router.replace('/payments')} fullWidth />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
      refreshControl={
        <RefreshControl
          refreshing={payment.isRefetching}
          onRefresh={() => {
            void payment.refetch();
            void receipt.refetch();
          }}
          tintColor={theme.colors.primary}
        />
      }
    >
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 10, alignSelf: 'flex-start' }}>
        <Caption tone="primary" style={{ fontWeight: '700' }}>
          ‹ Back
        </Caption>
      </Pressable>

      <Row justify="space-between" align="flex-start" style={{ marginBottom: 10 }}>
        <View style={{ flex: 1 }}>
          <Overline style={{ marginBottom: 4 }}>{paymentPurposeLabel(data.purpose, language)}</Overline>
          <Title>{formatCurrency(data.amount, data.currency ?? 'XAF', language)}</Title>
          <Caption tone="muted">{data.reference}</Caption>
        </View>
        <StatusPill status={data.status} label={paymentStatusLabel(data.status, language)} />
      </Row>

      <Row gap={8} wrap style={{ marginBottom: 14 }}>
        <Badge label={paymentMethodLabel(data.method, language)} tone="primary" icon="card-outline" />
        <Badge
          label={data.provider === 'SIMULATOR' ? 'sandbox simulator' : (data.provider ?? 'provider')}
          tone={data.provider === 'SIMULATOR' ? 'warning' : 'neutral'}
          icon={data.provider === 'SIMULATOR' ? 'flask-outline' : 'shield-checkmark-outline'}
        />
        {data.verifiedAt ? <Badge label={`verified ${formatRelative(data.verifiedAt, language)}`} tone="success" icon="checkmark-circle-outline" /> : null}
        {data.receiptNumber ? <Badge label={`receipt ${data.receiptNumber}`} tone="success" /> : null}
        {data.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
      </Row>

      {pending && data.provider === 'SIMULATOR' ? (
        <View style={{ marginBottom: 14 }}>
          <Notice tone="warning" title="Waiting on the sandbox provider">
            This transaction was created with the local simulator. Confirm it here to see the real state machine — or mark it failed to exercise the failure path.
            With Campay credentials configured, this control is not shown and the provider is the only source of truth.
          </Notice>
        </View>
      ) : null}

      {data.failureReason ? (
        <View style={{ marginBottom: 14 }}>
          <Notice tone="danger" title="The provider reported a failure">
            {data.failureReason}
          </Notice>
        </View>
      ) : null}

      {canVerify || (sandbox && pending) ? (
        <Section title="Provider actions">
          <Card>
            <Caption tone="muted" style={{ marginBottom: 10 }}>
              Verifying asks the backend to query {data.provider === 'SIMULATOR' ? 'the simulator' : 'Campay'} again and to store whatever comes back.
            </Caption>
            <Row gap={8} wrap>
              {canVerify ? (
                <Button
                  label="Verify with provider"
                  icon="refresh-circle-outline"
                  loading={verify.isPending}
                  onPress={() =>
                    void verify
                      .mutateAsync(undefined as never)
                      .then((updated) => toast.success('Provider answered', `Status: ${paymentStatusLabel(updated.status, language)}.`))
                      .catch((error) => toast.error('Verification failed', error instanceof ApiError ? error.message : undefined))
                  }
                />
              ) : null}
              {sandbox && pending ? (
                <>
                  <Button
                    label="Sandbox: mark successful"
                    icon="flask-outline"
                    variant="secondary"
                    loading={simulate.isPending}
                    onPress={() =>
                      void simulate
                        .mutateAsync({ outcome: 'SUCCESSFUL', notes: 'Confirmed from the mobile app against the sandbox provider.' })
                        .then(() => toast.success('Sandbox outcome recorded'))
                        .catch((error) => toast.error('Simulation refused', error instanceof ApiError ? error.message : undefined))
                    }
                  />
                  <Button
                    label="Sandbox: mark failed"
                    icon="flask-outline"
                    variant="ghost"
                    loading={simulate.isPending}
                    onPress={() =>
                      void simulate
                        .mutateAsync({ outcome: 'FAILED', notes: 'Failure path exercised from the mobile app.' })
                        .then(() => toast.info('Recorded as failed'))
                        .catch((error) => toast.error('Simulation refused', error instanceof ApiError ? error.message : undefined))
                    }
                  />
                </>
              ) : null}
            </Row>
          </Card>
        </Section>
      ) : null}

      {receipt.data && data.status === 'SUCCESSFUL' ? (
        <Section title="Receipt">
          <Card>
            <Row justify="space-between" style={{ marginBottom: 8 }}>
              <Body style={{ fontWeight: '700' }}>{receipt.data.receiptNumber}</Body>
              <Badge label={receipt.data.payment.currency} tone="neutral" />
            </Row>
            <Definition label="Issued" value={formatDateTime(receipt.data.issuedAt, language)} />
            <Definition label="Issued by" value={`${receipt.data.issuedBy} — ${receipt.data.organisation}`} />
            <Definition label="Amount" value={formatCurrency(receipt.data.payment.amount, receipt.data.payment.currency, language)} />
            <Definition label="Paid" value={receipt.data.payment.paidAt ? formatDateTime(receipt.data.payment.paidAt, language) : '—'} />
            <Definition label="Purpose" value={paymentPurposeLabel(receipt.data.payment.purpose, language)} />
            <Definition label="Method" value={paymentMethodLabel(receipt.data.payment.method, language)} />
            <Definition label="Provider reference" value={receipt.data.payment.providerReference ?? '—'} />
            <Definition label="Payer" value={receipt.data.payer?.name ? `${receipt.data.payer.name}${receipt.data.payer.phone ? ` · ${receipt.data.payer.phone}` : ''}` : '—'} />
            <Definition label="Company" value={receipt.data.company?.name ?? '—'} />
            <Definition label="Permit" value={receipt.data.permit ? `${receipt.data.permit.permitNumber ?? ''} (${receipt.data.permit.status ?? ''})` : '—'} />
            {receipt.data.payment.isSandbox ? (
              <View style={{ marginTop: 10 }}>
                <Badge label="sandbox receipt — no funds moved" tone="warning" icon="flask-outline" />
              </View>
            ) : null}
          </Card>
        </Section>
      ) : null}

      <Section title="Record">
        <Card>
          <Definition label="Company" value={data.company?.name ?? '—'} />
          <Definition label="Permit" value={data.permit?.permitNumber ?? '—'} />
          {data.violation ? <Definition label="Case" value={`${data.violation.reference} — ${data.violation.status}`} /> : null}
          <Definition label="Provider reference" value={data.providerReference ?? '—'} />
          <Definition label="Provider phone" value={data.providerPhone ?? '—'} />
          <Definition label="Initiated" value={formatDateTime(data.initiatedAt, language)} />
          <Definition label="Processed" value={data.processedAt ? formatDateTime(data.processedAt, language) : '—'} />
          <Definition label="Paid" value={data.paidAt ? formatDateTime(data.paidAt, language) : '—'} />
          <Definition label="Verified" value={data.verifiedAt ? formatDateTime(data.verifiedAt, language) : '—'} />
          <Definition label="Refunded" value={data.refundedAt ? formatDateTime(data.refundedAt, language) : '—'} />
          <Definition label="Initiated by" value={data.initiatedBy ? `${data.initiatedBy.firstName} ${data.initiatedBy.lastName}` : '—'} />
          <Definition label="Verified by" value={data.verifiedBy ? `${data.verifiedBy.firstName} ${data.verifiedBy.lastName}` : '—'} />
          {data.notes ? <Definition label="Notes" value={data.notes} /> : null}
          {data.clientRef ? <Definition label="Offline reference" value={data.clientRef} /> : null}
        </Card>
      </Section>

      {canRefund && (data.status === 'SUCCESSFUL' || data.status === 'PENDING') ? (
        <Section title="Refund">
          <Card>
            <Caption tone="muted" style={{ marginBottom: 10 }}>
              A refund is sent back through the same provider. The reason you give is stored with the payment and shown on the receipt.
            </Caption>
            <Button
              label="Refund this payment"
              variant="danger"
              icon="arrow-undo-outline"
              loading={refund.isPending}
              onPress={async () => {
                const answer = await confirm({
                  title: 'Refund payment',
                  message: `${formatCurrency(data.amount, data.currency ?? 'XAF', language)} will be sent back to the payer.`,
                  confirmLabel: 'Refund',
                  destructive: true,
                  requireReason: true,
                  reasonLabel: 'Reason for the refund',
                  reasonPlaceholder: 'e.g. permit fee charged twice at the same counter',
                  reasonMinLength: 10,
                });
                if (!answer.confirmed || !answer.reason) return;
                try {
                  await refund.mutateAsync(answer.reason);
                  toast.success('Refund requested', 'The provider reference is stored on the payment.');
                } catch (error) {
                  toast.error('Refund refused', error instanceof ApiError ? error.message : undefined);
                }
              }}
            />
          </Card>
        </Section>
      ) : null}

      {data.permit?.id ? (
        <View style={{ marginBottom: 12 }}>
          <Button
            label="Open the permit"
            variant="secondary"
            icon="document-text-outline"
            onPress={() => router.push({ pathname: '/permit/[id]', params: { id: data.permit?.id ?? '' } })}
            fullWidth
          />
        </View>
      ) : null}

      {data.violation?.id ? (
        <View style={{ marginBottom: 12 }}>
          <Button
            label="Open the case"
            variant="secondary"
            icon="warning-outline"
            onPress={() => router.push({ pathname: '/violation/[id]', params: { id: data.violation?.id ?? '' } })}
            fullWidth
          />
        </View>
      ) : null}

      {isCompanyAccount ? (
        <Tiny tone="faint" style={{ textAlign: 'center', marginBottom: 8 }}>
          You are seeing this payment because it belongs to your company.
        </Tiny>
      ) : null}

      <Divider style={{ marginVertical: 12 }} />
      <Tiny tone="faint" style={{ textAlign: 'center' }}>
        Payment {data.id.slice(0, 8)} · created {formatRelative(data.createdAt, language)}
      </Tiny>
    </ScrollView>
  );
}
