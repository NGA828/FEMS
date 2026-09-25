/**
 * Company register.
 *
 * Every company operating in the Cameroonian forest sector that FEMS knows about,
 * with the verification state of its file. A company account sees only its own
 * record — the API applies that scope, not this screen.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { Company, CompanyStatus, CompanyType } from '../../../src/api/types';
import { useCompanies, useCompanyStatistics } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { companyStatusLabel, companyTypeLabel, formatDateTime, formatNumber } from '../../../src/lib/format';
import { useTheme } from '../../../src/theme/theme';
import {
  Avatar,
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Overline,
  PageHeader,
  Row,
  Screen,
  SearchBar,
  SkeletonList,
  StatTile,
  Tiny,
} from '../../../src/ui';

const STATUS_TONES: Record<CompanyStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  VERIFIED: 'success',
  PENDING: 'warning',
  SUSPENDED: 'danger',
  REJECTED: 'danger',
};

export default function CompanyRegisterScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { hasPermission, user } = useAuth();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CompanyStatus | 'ALL'>('ALL');
  const [type, setType] = useState<CompanyType | 'ALL'>('ALL');

  const statistics = useCompanyStatistics();
  const query = useMemo(
    () => ({ limit: 40, status: status === 'ALL' ? undefined : status, type: type === 'ALL' ? undefined : type }),
    [status, type],
  );
  const companies = useCompanies(query);

  const items = companies.data?.items ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((company: Company) =>
      [company.name, company.registrationNumber, company.city, company.region]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [items, search]);

  const myCompanyId = user?.company?.id ?? null;

  return (
    <Screen refresh={companies.isRefetching ? { refreshing: true, onRefresh: () => companies.refetch() } : undefined}>
      <PageHeader
        title="Companies"
        subtitle={statistics.data ? `${formatNumber(statistics.data.total)} registered in the sector` : 'Loading register…'}
        onBack={() => router.back()}
      />

      {statistics.data ? (
        <Row gap={8} wrap style={{ marginBottom: 12 }}>
          <StatTile label="Verified" value={statistics.data.byStatus.find((row) => row.status === 'VERIFIED')?.count ?? 0} icon="shield-checkmark-outline" tone="success" />
          <StatTile label="Pending" value={statistics.data.byStatus.find((row) => row.status === 'PENDING')?.count ?? 0} icon="hourglass-outline" tone="warning" />
          <StatTile label="Suspended" value={statistics.data.byStatus.find((row) => row.status === 'SUSPENDED')?.count ?? 0} icon="pause-circle-outline" tone="danger" />
          <StatTile label="Regions covered" value={statistics.data.byRegion.length} icon="map-outline" />
        </Row>
      ) : null}

      <SearchBar value={search} onChangeText={setSearch} placeholder="Name, registration number, city…" />

      <View style={{ marginVertical: 10, gap: 8 }}>
        <Row gap={6} wrap>
          <Chip label="All statuses" selected={status === 'ALL'} onPress={() => setStatus('ALL')} />
          {(['VERIFIED', 'PENDING', 'SUSPENDED', 'REJECTED'] as CompanyStatus[]).map((value) => (
            <Chip key={value} label={companyStatusLabel(value)} selected={status === value} onPress={() => setStatus(value)} />
          ))}
        </Row>
        <Row gap={6} wrap>
          <Tiny tone="faint">Type</Tiny>
          <Chip label="Any" selected={type === 'ALL'} onPress={() => setType('ALL')} />
          {(['LOGGING_COMPANY', 'SAWMILL', 'COOPERATIVE', 'TRANSPORTER', 'EXPORTER'] as CompanyType[]).map((value) => (
            <Chip key={value} label={companyTypeLabel(value)} selected={type === value} onPress={() => setType(value)} />
          ))}
        </Row>
      </View>

      {companies.isLoading ? (
        <SkeletonList rows={4} />
      ) : companies.isError ? (
        <ErrorState error={companies.error} onRetry={() => companies.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="business-outline"
          title={search || status !== 'ALL' || type !== 'ALL' ? 'No company matches these filters' : 'No company on the register'}
          description={
            search || status !== 'ALL' || type !== 'ALL'
              ? 'Clear the filters to see the whole register.'
              : 'Companies appear here once their FEMS file exists.'
          }
          actionLabel={search || status !== 'ALL' || type !== 'ALL' ? 'Clear filters' : undefined}
          onAction={() => {
            setSearch('');
            setStatus('ALL');
            setType('ALL');
          }}
        />
      ) : (
        filtered.map((company: Company) => (
          <Pressable
            key={company.id}
            onPress={() => router.push({ pathname: '/company/[id]', params: { id: company.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${company.name}, ${companyStatusLabel(company.status)}`}
            style={({ pressed }) => ({ marginBottom: 10, opacity: pressed ? 0.85 : 1 })}
          >
            <Card>
              <Row gap={12}>
                <Avatar first={company.name.slice(0, 1)} last={company.name.split(' ')[1]?.slice(0, 1) ?? null} size={40} tone={STATUS_TONES[company.status]} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '700' }} lines={2}>
                    {company.name}
                  </Body>
                  <Tiny tone="faint">
                    {company.registrationNumber}
                    {company.city ? ` · ${company.city}` : ''}
                    {company.region ? `, ${company.region}` : ''}
                  </Tiny>
                  <Row gap={6} wrap style={{ marginTop: 6 }}>
                    <Badge label={companyStatusLabel(company.status)} tone={STATUS_TONES[company.status]} compact />
                    <Badge label={companyTypeLabel(company.type)} tone="neutral" compact />
                    {company._count?.permits ? <Tiny tone="faint">{company._count.permits} permit(s)</Tiny> : null}
                    {company._count?.violations ? (
                      <Badge label={`${company._count.violations} case(s)`} tone="danger" compact />
                    ) : null}
                  </Row>
                  {company.status === 'REJECTED' && company.rejectionReason ? (
                    <Tiny style={{ color: theme.colors.danger, marginTop: 6 }} lines={2}>
                      {company.rejectionReason}
                    </Tiny>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward-outline" size={18} color={theme.colors.textFaint} />
              </Row>
              {company.verifiedAt ? (
                <Tiny tone="faint" style={{ marginTop: 8 }}>
                  Verified {formatDateTime(company.verifiedAt, 'en')}
                </Tiny>
              ) : null}
            </Card>
          </Pressable>
        ))
      )}

      {statistics.data?.companiesWithViolations.length ? (
        <>
          <Overline style={{ marginTop: 8, marginBottom: 6 }}>Most recorded cases</Overline>
          <Card>
            {statistics.data.companiesWithViolations.slice(0, 5).map((entry) => (
              <Pressable
                key={entry.id}
                onPress={() => router.push({ pathname: '/company/[id]', params: { id: entry.id } })}
                accessibilityRole="button"
                accessibilityLabel={`${entry.name}, ${entry.violations} cases`}
              >
                <Row justify="space-between" style={{ marginBottom: 6 }}>
                  <Tiny style={{ flex: 1 }} lines={1}>
                    {entry.name}
                  </Tiny>
                  <Badge label={`${entry.violations}`} tone="danger" compact />
                </Row>
              </Pressable>
            ))}
            <Caption tone="faint" style={{ marginTop: 4 }}>
              Counts of environmental cases recorded against each company — a regulatory fact, not an AI judgement.
            </Caption>
          </Card>
        </>
      ) : null}

      {!hasPermission('companies:read') ? (
        <Caption tone="faint" style={{ marginTop: 12 }}>
          Your role sees the company records linked to your own account only.
        </Caption>
      ) : null}
      {myCompanyId ? (
        <Button
          label="My company record"
          variant="secondary"
          icon="business-outline"
          style={{ marginTop: 12 }}
          onPress={() => router.push({ pathname: '/company/[id]', params: { id: myCompanyId } })}
        />
      ) : null}
    </Screen>
  );
}
