/**
 * Permit application.
 *
 * The form only offers choices the backend will accept: forests, zones, permit
 * types and the royalty rate come from the API, and the fee is computed the way
 * the service computes it (volume × rate) so the applicant sees the amount before
 * submitting. `POST /permits` remains the authority on validity and on whether the
 * account may file on behalf of a company.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../../src/api/client';
import { useCreatePermit, useForests, useForestZones, useMyCompany, usePermitStatistics } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Definition,
  Notice,
  Overline,
  Row,
  Section,
  SelectSheet,
  TextField,
  Title,
  useToast,
} from '../../../src/ui';
import { formatCurrency, formatDate, formatVolume, forestTypeLabel, permitTypeLabel } from '../../../src/lib/format';

const PERMIT_TYPES = [
  { value: 'EXPLOITATION', label: 'Exploitation', description: 'Harvest timber inside an approved cutting area' },
  { value: 'TRANSPORT', label: 'Transport', description: 'Move logs with a transport permit' },
  { value: 'PROCESSING', label: 'Processing', description: 'Transform timber at a sawmill' },
  { value: 'EXPORT', label: 'Export', description: 'Export processed wood products' },
  { value: 'ARTISANAL', label: 'Artisanal', description: 'Small-scale artisanal permit' },
  { value: 'RECONNAISSANCE', label: 'Reconnaissance', description: 'Survey a forest before applying' },
  { value: 'COMMUNITY_FOREST', label: 'Community forest', description: 'Community forest management' },
] as const;

const PRIORITIES = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
] as const;

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export default function NewPermitScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user, hasPermission } = useAuth();

  const forests = useForests({ limit: 50, status: 'ACTIVE' });
  const myCompany = useMyCompany(Boolean(user?.company?.id));
  const statistics = usePermitStatistics();
  const createPermit = useCreatePermit();

  const [type, setType] = useState<(typeof PERMIT_TYPES)[number]['value'] | null>('EXPLOITATION');
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]['value']>('NORMAL');
  const [forestId, setForestId] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(user?.company?.id ?? null);
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [volume, setVolume] = useState('');
  const [royaltyRate, setRoyaltyRate] = useState('2500');
  const [startDate, setStartDate] = useState(isoInDays(1));
  const [endDate, setEndDate] = useState(isoInDays(365));
  const [conditions, setConditions] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});

  const zones = useForestZones(forestId);
  const isCompanyAccount = Boolean(user?.company?.id);

  useEffect(() => {
    if (forestId && forests.data) {
      const forest = forests.data.items.find((entry) => entry.id === forestId);
      if (forest && !title) setTitle(`${permitTypeLabel(type ?? 'EXPLOITATION')} — ${forest.name}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forestId]);

  const fee = useMemo(() => {
    const parsedVolume = Number(volume);
    const parsedRate = Number(royaltyRate);
    if (!Number.isFinite(parsedVolume) || !Number.isFinite(parsedRate)) return 0;
    return Math.round(parsedVolume * parsedRate);
  }, [volume, royaltyRate]);

  const errors = useMemo(() => {
    const map: Record<string, string> = { ...serverFields };
    if (!type) map.type = 'Choose a permit type.';
    if (!forestId) map.forestId = 'Choose the forest the permit covers.';
    if (!title.trim() || title.trim().length < 5) map.title = 'Give the application a descriptive title.';
    if (!volume || Number(volume) <= 0) map.volumeRequestedM3 = 'Enter the requested volume in m³.';
    if (!startDate) map.startDate = 'Choose a start date.';
    if (!endDate) map.endDate = 'Choose an end date.';
    if (startDate && endDate && new Date(endDate) <= new Date(startDate)) map.endDate = 'The end date must be after the start date.';
    return map;
  }, [serverFields, type, forestId, title, volume, startDate, endDate]);

  const canSubmit =
    !createPermit.isPending &&
    Boolean(type && forestId && title.trim() && volume && Number(volume) > 0 && startDate && endDate) &&
    !errors.endDate;

  const submit = async () => {
    setFailure(null);
    setServerFields({});
    try {
      const permit = await createPermit.mutateAsync({
        type,
        title: title.trim(),
        purpose: purpose.trim() || undefined,
        priority,
        forestId,
        zoneId: zoneId ?? undefined,
        ...(companyId && !isCompanyAccount ? { companyId } : {}),
        volumeRequestedM3: Number(volume),
        royaltyRatePerM3: Number(royaltyRate) || undefined,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        conditions: conditions.trim() || undefined,
      });
      toast.success('Application created', `${permit.permitNumber} — ${permitStatusText(permit.status)}`);
      router.replace({ pathname: '/permit/[id]', params: { id: permit.id } });
    } catch (error) {
      if (error instanceof ApiError) {
        setServerFields(fieldErrors(error));
        setFailure(error.message);
      } else {
        setFailure(error instanceof Error ? error.message : 'The application could not be created.');
      }
    }
  };

  const forestOptions = (forests.data?.items ?? []).map((forest) => ({
    value: forest.id,
    label: `${forest.name} (${forest.code})`,
    description: `${forest.region} · ${forestTypeLabel(forest.type)} · ${Math.round(Number(forest.totalAreaHa)).toLocaleString()} ha`,
  }));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={forests.isRefetching} onRefresh={() => forests.refetch()} tintColor={theme.colors.primary} />}
    >
      <Row justify="space-between" align="flex-start" style={{ marginBottom: 14 }}>
        <View style={{ flex: 1 }}>
          <Title>New permit application</Title>
          <Caption tone="muted">
            Filed as {user?.company?.name ?? `${user?.firstName} ${user?.lastName}`} · the ministry reviews it after submission
          </Caption>
        </View>
        <Button label="Cancel" variant="ghost" size="sm" onPress={() => router.back()} />
      </Row>

      {failure ? (
        <View style={{ marginBottom: 14 }}>
          <Notice tone="danger" title="The application was refused">
            {failure}
          </Notice>
        </View>
      ) : null}

      {!isCompanyAccount && hasPermission('permits:create') ? (
        <Notice tone="info" title="Filed on behalf of a company">
          As a regulator you may file an application for a company; the API records you as the applicant and the company as the holder. Company-specific
          scoping is decided by the backend.
        </Notice>
      ) : null}

      <Section title="What are you applying for?">
        <Card>
          <SelectSheet
            label="Permit type"
            required
            value={type}
            options={PERMIT_TYPES.map((entry) => ({ value: entry.value, label: entry.label, description: entry.description }))}
            onChange={setType}
            error={errors.type}
          />
          <SelectSheet
            label="Priority"
            value={priority}
            options={PRIORITIES.map((entry) => ({ value: entry.value, label: entry.label }))}
            onChange={setPriority}
          />
          <TextField
            label="Title"
            required
            value={title}
            onChangeText={setTitle}
            placeholder="Exploitation — UFA 10-012 — assiette annuelle 2026"
            error={errors.title}
          />
          <TextField
            label="Purpose"
            multiline
            value={purpose}
            onChangeText={setPurpose}
            placeholder="Describe the planned operations, the species targeted and the market served"
          />
        </Card>
      </Section>

      <Section title="Where">
        <Card>
          <SelectSheet
            label="Forest"
            required
            value={forestId}
            options={forestOptions}
            onChange={(value) => {
              setForestId(value);
              setZoneId(null);
            }}
            placeholder={forests.isLoading ? 'Loading forests…' : 'Choose a forest'}
            error={errors.forestId}
          />
          <SelectSheet
            label="Cutting area (zone)"
            value={zoneId}
            options={(zones.data ?? []).map((zone) => ({ value: zone.id, label: `${zone.name} (${zone.code})`, description: zone.type }))}
            onChange={setZoneId}
            placeholder={forestId ? (zones.isLoading ? 'Loading zones…' : (zones.data ?? []).length ? 'Choose a zone' : 'This forest has no zone') : 'Choose a forest first'}
            disabled={!forestId}
          />
          {myCompany.data && !isCompanyAccount ? (
            <Row gap={6} style={{ marginTop: 4 }}>
              <Caption tone="muted">Company holder:</Caption>
              <Badge label={myCompany.data.name} tone="accent" />
            </Row>
          ) : null}
        </Card>
      </Section>

      <Section title="Volume, rate and period">
        <Card>
          <TextField
            label="Volume requested (m³)"
            required
            keyboardType="numeric"
            value={volume}
            onChangeText={setVolume}
            placeholder="1200"
            error={errors.volumeRequestedM3}
            suffix="m³"
          />
          <TextField
            label="Royalty rate (XAF / m³)"
            keyboardType="numeric"
            value={royaltyRate}
            onChangeText={setRoyaltyRate}
            help="The ministry rate for the species and regime; the API recomputes the fee it will invoice."
            suffix="XAF/m³"
          />
          <TextField label="Start date" required value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" error={errors.startDate} />
          <TextField label="End date" required value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" error={errors.endDate} />
          <TextField label="Conditions requested" multiline value={conditions} onChangeText={setConditions} placeholder="Access tracks, buffer zones, replanting obligations…" />
        </Card>
      </Section>

      <Section title="Fee estimate">
        <Card>
          <Definition label="Volume" value={formatVolume(volume || 0)} />
          <Definition label="Rate" value={`${formatCurrency(royaltyRate || 0)} / m³`} />
          <Definition label="Estimated fee" value={formatCurrency(fee)} tone="primary" />
          <Caption tone="faint">
            Indicative only: the fee is recalculated by the API on submission and can be adjusted when the permit is approved. Outstanding balances from
            earlier permits appear on the permit record.
          </Caption>
        </Card>
      </Section>

      {statistics.data?.expiringSoon?.length ? (
        <Section title="Also expiring in your scope">
          <Card padded={false}>
            {statistics.data.expiringSoon.slice(0, 3).map((permit, index) => (
              <View
                key={permit.id}
                style={{
                  padding: 14,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: theme.colors.border,
                }}
              >
                <Row justify="space-between">
                  <Body style={{ fontWeight: '600' }}>{permit.permitNumber}</Body>
                  <Caption tone="muted">ends {formatDate(permit.endDate)}</Caption>
                </Row>
                <Caption tone="muted" lines={1}>
                  {permit.title}
                </Caption>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Card>
        <Row gap={10}>
          <Ionicons name="information-circle-outline" size={18} color={theme.colors.info} />
          <Caption tone="muted" style={{ flex: 1 }}>
            After submission the application follows the ministry workflow: review, approval, fee payment, activation. Exploitation is only allowed once the
            permit is active and inside the approved volume.
          </Caption>
        </Row>
      </Card>

      <View style={{ height: 16 }} />
      <Button
        label="Submit application"
        icon="send-outline"
        size="lg"
        fullWidth
        loading={createPermit.isPending}
        disabled={!canSubmit}
        onPress={submit}
      />
      <Caption tone="faint" style={{ textAlign: 'center', marginTop: 8 }}>
        The backend validates the transition; a submission that breaks the rules is refused with a reason.
      </Caption>
    </ScrollView>
  );
}

function permitStatusText(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
