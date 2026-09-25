/**
 * Payments register.
 *
 * Company accounts see the money they owe and have paid; the forest service and
 * the treasury see every payment in their scope. Status is never taken from the
 * app: a payment shows as successful only after the backend has verified it with
 * the provider (or, in the sandbox, through the labelled simulator).
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePaymentProvider, usePayments, usePaymentStatistics } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { roleContext } from '../../../src/navigation/tabs';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  MonthBars,
  Notice,
  Row,
  SearchBar,
  Section,
  SkeletonList,
  StatTile,
  StatusPill,
  Tiny,
  Title,
} from '../../../src/ui';
import { formatCurrency, formatCurrencyCompact, formatDateTime, formatRelative, paymentMethodLabel, paymentPurposeLabel, paymentStatusLabel } from '../../../src/lib/format';

const STATUS_FILTERS = ['PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'REFUNDED'] as const;
const PURPOSE_FILTERS = ['PERMIT_FEE', 'ROYALTY', 'ANNUAL_TAX', 'PENALTY', 'REPLANTING_BOND'] as const;

export default function PaymentsTab() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, hasPermission } = useAuth();
  const context = roleContext(user, hasPermission);
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  const [status, setStatus] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = useMemo(
    () => ({ status: status ?? undefined, purpose: purpose ?? undefined, page, limit: 15 }),
    [status, purpose, page],
  );

  const payments = usePayments(query);
  const statistics = usePaymentStatistics();
  const provider = usePaymentProvider();
  const items = payments.data?.items ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((payment) =>
      `${payment.reference} ${payment.permit?.permitNumber ?? ''} ${payment.violation?.reference ?? ''} ${payment.receiptNumber ?? ''}`
        .toLowerCase()
        .includes(term),
    );
  }, [items, search]);

  const sandbox = provider.data?.provider === 'SIMULATOR';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
        refreshControl={
          <RefreshControl
            refreshing={payments.isRefetching}
            onRefresh={() => {
              void payments.refetch();
              void statistics.refetch();
              void provider.refetch();
            }}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        ListHeaderComponent={
          <View>
            <Row justify="space-between" align="flex-start" style={{ marginBottom: 14 }}>
              <View style={{ flex: 1 }}>
                <Title>Payments</Title>
                <Caption tone="muted">
                  {user?.company ? `${user.company.name} — fees, royalties and penalties` : 'Collections, verifications and refunds'}
                </Caption>
              </View>
              {hasPermission('payments:create') ? (
                <Button label="Pay" icon="card-outline" size="sm" onPress={() => router.push('/payment/new')} />
              ) : null}
            </Row>

            {provider.data ? (
              <View style={{ marginBottom: 14 }}>
                <Notice
                  tone={provider.data.configured && !sandbox ? 'success' : 'warning'}
                  icon={<Ionicons name={sandbox ? 'flask-outline' : 'shield-checkmark-outline'} size={16} color={sandbox ? theme.colors.warning : theme.colors.success} />}
                  title={sandbox ? 'Sandbox payment provider' : `${provider.data.provider} configured`}
                >
                  {sandbox
                    ? 'PAYMENT_PROVIDER is set to the local simulator: payments move through real database states and are verified by the backend, but no money leaves an account. Add the Campay credentials to .env to switch to the live provider.'
                    : `Payments are collected through ${provider.data.provider}${provider.data.sandbox ? ' in sandbox mode' : ''}. The app never marks a payment successful — the backend verifies it with the provider.`}
                </Notice>
              </View>
            ) : null}

            {statistics.data ? (
              <>
                <Row gap={10} wrap style={{ marginBottom: 12 }}>
                  <StatTile label="Payments" value={statistics.data.total} icon="receipt-outline" />
                  <StatTile label="Total value" value={formatCurrencyCompact(statistics.data.totalAmount, language)} icon="cash-outline" />
                  <StatTile
                    label="Successful"
                    value={formatCurrencyCompact(
                      statistics.data.byStatus.find((entry) => entry.status === 'SUCCESSFUL')?.amount ?? 0,
                      language,
                    )}
                    icon="checkmark-circle-outline"
                    tone="success"
                  />
                  <StatTile
                    label="Outstanding"
                    value={formatCurrencyCompact(statistics.data.byStatus.find((entry) => entry.status === 'PENDING')?.amount ?? 0, language)}
                    icon="hourglass-outline"
                    tone="warning"
                  />
                </Row>
                {statistics.data.monthly.length > 0 ? (
                  <Card style={{ marginBottom: 14 }}>
                    <Caption tone="muted" style={{ marginBottom: 8 }}>
                      Collected per month (XAF)
                    </Caption>
                    <MonthBars data={statistics.data.monthly.map((entry) => ({ month: entry.month, value: entry.collected }))} />
                  </Card>
                ) : null}
              </>
            ) : null}

            <SearchBar value={search} onChangeText={setSearch} placeholder="Search reference, permit, penalty or receipt" onSubmit={() => setPage(1)} />
            <Row gap={8} wrap style={{ marginTop: 12 }}>
              <Chip label="Any status" selected={!status} onPress={() => setStatus(null)} />
              {STATUS_FILTERS.map((entry) => (
                <Chip key={entry} label={paymentStatusLabel(entry, language)} selected={status === entry} onPress={() => setStatus(entry)} />
              ))}
            </Row>
            <Row gap={8} wrap style={{ marginTop: 8, marginBottom: 12 }}>
              <Chip label="Any purpose" selected={!purpose} onPress={() => setPurpose(null)} />
              {PURPOSE_FILTERS.map((entry) => (
                <Chip key={entry} label={paymentPurposeLabel(entry, language)} selected={purpose === entry} onPress={() => setPurpose(entry)} />
              ))}
            </Row>
          </View>
        }
        ListEmptyComponent={
          payments.isLoading ? (
            <SkeletonList rows={4} />
          ) : payments.isError ? (
            <ErrorState error={payments.error} onRetry={() => payments.refetch()} />
          ) : (
            <EmptyState
              icon="card-outline"
              title="No payment recorded"
              description={
                hasPermission('payments:create')
                  ? 'Settle a permit fee, a royalty or a penalty; the provider reference and receipt are stored with the record.'
                  : 'Payments appear here as soon as an operator initiates one.'
              }
              actionLabel={hasPermission('payments:create') ? 'Record a payment' : undefined}
              onAction={hasPermission('payments:create') ? () => router.push('/payment/new') : undefined}
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/payment/[id]', params: { id: item.id } })}
            accessibilityRole="button"
            accessibilityLabel={`Payment ${item.reference}, ${paymentStatusLabel(item.status, language)}`}
            style={({ pressed }) => ({ marginBottom: 12, opacity: pressed ? 0.85 : 1 })}
          >
            <Card>
              <Row justify="space-between" style={{ marginBottom: 6 }}>
                <Row gap={6} style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '700' }}>{formatCurrency(item.amount, item.currency ?? 'XAF', language)}</Body>
                  {item.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
                </Row>
                <StatusPill status={item.status} label={paymentStatusLabel(item.status, language)} />
              </Row>
              <Caption tone="muted" style={{ marginBottom: 8 }}>
                {paymentPurposeLabel(item.purpose, language)} · {paymentMethodLabel(item.method, language)} · {item.reference}
              </Caption>
              <Row gap={10} wrap>
                {item.permit ? (
                  <Badge label={item.permit.permitNumber} tone="primary" icon="document-text-outline" />
                ) : null}
                {item.violation ? <Badge label={item.violation.reference} tone="danger" icon="warning-outline" /> : null}
                <Badge label={item.provider === 'SIMULATOR' ? 'simulator' : (item.provider ?? 'provider')} tone={item.provider === 'SIMULATOR' ? 'warning' : 'neutral'} />
                {item.receiptNumber ? <Badge label={`receipt ${item.receiptNumber}`} tone="success" compact /> : null}
              </Row>
              <Row justify="space-between" style={{ marginTop: 8 }}>
                <Tiny tone="faint">{item.company?.name ?? '—'}</Tiny>
                <Tiny tone="faint">{formatDateTime(item.paidAt ?? item.initiatedAt, language)}</Tiny>
              </Row>
              {item.failureReason ? (
                <Caption tone="danger" style={{ marginTop: 6 }}>
                  {item.failureReason}
                </Caption>
              ) : null}
              {item.syncStatus && item.syncStatus !== 'SYNCED' ? (
                <Row gap={6} style={{ marginTop: 6 }}>
                  <Badge label={`sync: ${item.syncStatus}`} tone="warning" compact icon="cloud-offline-outline" />
                  <Tiny tone="faint">recorded {formatRelative(item.createdAt, language)}</Tiny>
                </Row>
              ) : null}
            </Card>
          </Pressable>
        )}
        ListFooterComponent={
          items.length > 0 && payments.data?.meta?.hasNextPage ? (
            <Section>
              <Button label="Load more" variant="secondary" icon="chevron-down" onPress={() => setPage((current) => current + 1)} />
            </Section>
          ) : context.canVerifyPayments ? (
            <Section>
              <Card>
                <Row gap={10}>
                  <Ionicons name="information-circle-outline" size={18} color={theme.colors.info} />
                  <Caption tone="muted" style={{ flex: 1 }}>
                    A payment is only successful once the backend has confirmed it with the provider. Use the payment detail screen to re-verify a pending
                    transaction; the provider's own status is what is stored.
                  </Caption>
                </Row>
              </Card>
            </Section>
          ) : null
        }
      />
    </View>
  );
}
