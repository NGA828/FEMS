/**
 * Report detail.
 *
 * Shows the stored report, its parameters, its summary block and totals, and
 * offers the actions the caller's permissions allow: download the file, share it
 * with the services it concerns, or delete it. A report still generating refreshes
 * itself — the API returns GENERATING until the file exists.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '../../../src/api/client';
import type { Report } from '../../../src/api/types';
import { useDeleteReport, useReport, useSendReport } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { downloadAuthenticatedFile } from '../../../src/lib/file-download';
import { formatDateTime, formatNumber, parseJson, reportStatusLabel, reportTypeLabel } from '../../../src/lib/format';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Definition,
  ErrorState,
  Notice,
  Overline,
  PageHeader,
  Row,
  Screen,
  Section,
  SelectSheet,
  SkeletonDetail,
  Tiny,
  useConfirm,
  useToast,
} from '../../../src/ui';

const AUDIENCES = [
  { value: 'OFFICERS', label: 'The inspection services' },
  { value: 'COMPANIES', label: 'The companies the report concerns' },
] as const;

export default function ReportDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { hasPermission } = useAuth();

  const report = useReport(id ?? null);
  const remove = useDeleteReport();
  const send = useSendReport();

  const [downloading, setDownloading] = useState(false);
  const [audience, setAudience] = useState<'OFFICERS' | 'COMPANIES'>('OFFICERS');

  if (report.isLoading) {
    return (
      <Screen>
        <PageHeader title="Report" onBack={() => router.back()} />
        <SkeletonDetail />
      </Screen>
    );
  }

  if (report.isError || !report.data) {
    return (
      <Screen>
        <PageHeader title="Report" onBack={() => router.back()} />
        <ErrorState error={report.error} onRetry={() => report.refetch()} title="This report could not be loaded" />
      </Screen>
    );
  }

  const data: Report = report.data;
  const parameters = parseJson<Record<string, unknown>>(data.parametersJson ?? null, {});
  const canExport = hasPermission('reports:export');

  const download = async () => {
    setDownloading(true);
    const outcome = await downloadAuthenticatedFile(`/reports/${data.id}/download`, `${data.reference}.${data.format.toLowerCase()}`);
    setDownloading(false);
    if (outcome.saved) toast.success('Download started', outcome.uri ? `Saved to ${outcome.uri.split('/').pop()}` : `${data.reference}.${data.format.toLowerCase()}`);
    else toast.error('Download failed', outcome.reason);
  };

  const share = async () => {
    const answer = await confirm({
      title: 'Share this report?',
      message: `FEMS notifies ${AUDIENCES.find((entry) => entry.value === audience)?.label.toLowerCase()} that ${data.reference} is available. The file itself is not emailed.`,
      confirmLabel: 'Share',
    });
    if (!answer.confirmed) return;
    try {
      const result = await send.mutateAsync({ id: data.id, payload: { audience } });
      toast.success('Report shared', `${result.recipients} recipient(s) notified.`);
    } catch (error) {
      toast.error('Could not share', error instanceof ApiError ? error.message : undefined);
    }
  };

  const destroy = async () => {
    const answer = await confirm({
      title: 'Delete this report?',
      message: `${data.reference} and its stored file are removed. The deletion is written to the audit trail.`,
      confirmLabel: 'Delete',
      destructive: true,
      requireReason: true,
      reasonLabel: 'Why is this report being deleted?',
      reasonMinLength: 10,
    });
    if (!answer.confirmed) return;
    try {
      await remove.mutateAsync(data.id);
      toast.success('Report deleted', data.reference);
      router.replace('/report');
    } catch (error) {
      toast.error('Could not delete', error instanceof ApiError ? error.message : undefined);
    }
  };

  const totals = Object.entries(data.totals ?? {});

  return (
    <Screen refresh={report.isRefetching ? { refreshing: true, onRefresh: () => report.refetch() } : undefined}>
      <PageHeader title={reportTypeLabel(data.type)} subtitle={data.reference} onBack={() => router.back()} />

      {data.status === 'GENERATING' ? (
        <Notice tone="warning" title="Still generating">
          The API is building the dataset. This screen refreshes itself every few seconds until the file exists.
        </Notice>
      ) : null}
      {data.status === 'FAILED' ? (
        <Notice tone="danger" title="Generation failed">
          {data.errorMessage ?? 'The API did not return a reason for the failure.'}
        </Notice>
      ) : null}

      <Card>
        <Row justify="space-between" style={{ marginBottom: 8 }}>
          <Badge label={reportStatusLabel(data.status)} tone={data.status === 'READY' ? 'success' : data.status === 'FAILED' ? 'danger' : 'warning'} />
          <Badge label={data.format} tone="neutral" />
        </Row>
        <Body style={{ fontWeight: '700', marginBottom: 8 }}>{data.title}</Body>
        {data.isDemo ? (
          <Tiny tone="faint" style={{ marginBottom: 6 }}>
            Seeded demo record — kept so the library is never empty on a fresh install.
          </Tiny>
        ) : null}
        <Definition label="Rows" value={formatNumber(data.rowCount ?? 0)} />
        {data.totalRows && data.totalRows !== data.rowCount ? (
          <Definition label="Rows in scope" value={`${formatNumber(data.totalRows)}${data.truncated ? ' (truncated by the row limit)' : ''}`} />
        ) : null}
        <Definition label="Size" value={data.sizeBytes ? `${(Number(data.sizeBytes) / 1024).toFixed(1)} KB` : '—'} />
        <Definition label="Period" value={data.dateFrom && data.dateTo ? `${formatDateTime(data.dateFrom)} → ${formatDateTime(data.dateTo)}` : 'whole register'} />
        {data.forest ? <Definition label="Forest" value={`${data.forest.name} (${data.forest.code})`} /> : null}
        {data.company ? <Definition label="Company" value={data.company.name} /> : null}
        {data.generatedBy ? (
          <Definition label="Generated by" value={`${data.generatedBy.firstName} ${data.generatedBy.lastName}`} tone="muted" />
        ) : null}
        <Definition label="Generated" value={data.generatedAt ? formatDateTime(data.generatedAt) : 'not generated yet'} tone="muted" />
      </Card>

      {data.summary?.length ? (
        <Section title="Summary">
          <Card>
            {data.summary.map((entry) => (
              <Definition key={entry.label} label={entry.label} value={entry.value} />
            ))}
          </Card>
        </Section>
      ) : null}

      {totals.length ? (
        <Section title="Totals">
          <Card>
            {totals.map(([key, value]) => (
              <Definition key={key} label={key.replace(/([A-Z])/g, ' $1').toLowerCase()} value={formatNumber(Number(value))} />
            ))}
          </Card>
        </Section>
      ) : null}

      {data.notes?.length ? (
        <Section title="Notes">
          <Card>
            {data.notes.map((note) => (
              <Row key={note} gap={8} style={{ marginBottom: 6 }}>
                <Ionicons name="ellipse" size={6} color={theme.colors.textFaint} style={{ marginTop: 6 }} />
                <Caption tone="muted" style={{ flex: 1 }}>
                  {note}
                </Caption>
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}

      {parameters && Object.keys(parameters).length ? (
        <Section title="Parameters">
          <Card>
            {Object.entries(parameters).map(([key, value]) => (
              <Definition
                key={key}
                label={key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                value={value === null || value === undefined || value === '' ? '—' : String(value)}
                tone="muted"
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {canExport && data.status === 'READY' ? (
        <Section title="Share">
          <SelectSheet label="Audience" value={audience} options={[...AUDIENCES]} onChange={setAudience} />
          <Row gap={8} wrap style={{ marginTop: 10 }}>
            <Button label="Download file" icon="download-outline" loading={downloading} onPress={() => void download()} />
            <Button label="Notify audience" variant="secondary" icon="share-outline" loading={send.isPending} onPress={() => void share()} />
          </Row>
        </Section>
      ) : null}

      {hasPermission('reports:delete') ? (
        <View style={{ marginTop: 4 }}>
          <Button label="Delete report" variant="danger" icon="trash-outline" loading={remove.isPending} onPress={() => void destroy()} />
        </View>
      ) : null}

      <Overline style={{ marginTop: 16 }}>Traceability</Overline>
      <Card style={{ marginTop: 6 }}>
        <Tiny tone="faint">
          Report {data.reference} was generated from the live database with the parameters above. Deleting it records who removed it and why.
        </Tiny>
      </Card>
    </Screen>
  );
}
