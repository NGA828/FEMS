/**
 * Generate a report.
 *
 * The form is built from `GET /reports/catalogue`, so the types, formats and
 * columns shown here are the ones the backend can actually produce — nothing is
 * hardcoded on the device. "Preview" calls `POST /reports/preview` and renders the
 * real first rows of the dataset; "Generate" stores the file server-side.
 */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '../../../src/api/client';
import type { Report, ReportFormat, ReportType } from '../../../src/api/types';
import {
  useCompanies,
  useForests,
  useGenerateReport,
  usePermits,
  useReportCatalogue,
  useReportPreview,
  useReportStatistics,
} from '../../../src/api/queries';
import { downloadAuthenticatedFile } from '../../../src/lib/file-download';
import { formatDateInput, formatNumber, toIsoDateInput } from '../../../src/lib/format';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  DataTable,
  Definition,
  Notice,
  Overline,
  PageHeader,
  Row,
  Screen,
  Section,
  SelectSheet,
  SkeletonList,
  TextField,
  Tiny,
  useToast,
} from '../../../src/ui';

const QUICK_RANGES = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last quarter', days: 90 },
  { label: 'Last 12 months', days: 365 },
];

export default function GenerateReportScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();

  const catalogue = useReportCatalogue();
  const statistics = useReportStatistics();
  const generate = useGenerateReport();
  const preview = useReportPreview();

  const [type, setType] = useState<ReportType | null>(null);
  const [format, setFormat] = useState<ReportFormat>('PDF');
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [forestId, setForestId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [permitId, setPermitId] = useState<string | null>(null);
  const [maxRows, setMaxRows] = useState<number | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const [downloading, setDownloading] = useState(false);

  const forests = useForests({ limit: 100 });
  const companies = useCompanies({ limit: 100 });
  const permits = usePermits({ limit: 100 });

  const entries = catalogue.data?.reportTypes ?? [];
  const selected = useMemo(() => entries.find((entry) => entry.type === type) ?? null, [entries, type]);
  const formats = selected?.formats ?? catalogue.data?.formats ?? [];
  const today = toIsoDateInput(new Date());

  const buildPayload = () => ({
    type: type as string,
    from: from ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.000Z`).toISOString() : undefined,
    forestId: forestId ?? undefined,
    companyId: companyId ?? undefined,
    permitId: permitId ?? undefined,
    maxRows: maxRows ?? undefined,
  });

  const validate = (): string | null => {
    if (!type) return 'Choose a report type first.';
    if (from && Number.isNaN(Date.parse(from))) return 'The start date must look like 2026-09-01.';
    if (to && Number.isNaN(Date.parse(to))) return 'The end date must look like 2026-09-30.';
    if (from && to && from > to) return 'The start date is after the end date.';
    return null;
  };

  const runPreview = async () => {
    const problem = validate();
    if (problem) {
      toast.error('Cannot preview', problem);
      return;
    }
    try {
      await preview.mutateAsync(buildPayload());
    } catch (error) {
      toast.error('Preview failed', error instanceof ApiError ? error.message : undefined);
    }
  };

  const runGenerate = async () => {
    const problem = validate();
    if (problem) {
      toast.error('Cannot generate', problem);
      return;
    }
    try {
      const created = await generate.mutateAsync({ ...buildPayload(), format, title: title.trim() || undefined });
      setResult(created);
      if (created.status === 'FAILED') {
        toast.error('Generation failed', created.errorMessage ?? 'The API reported a failure while building the dataset.');
      } else {
        toast.success('Report ready', `${created.reference} — ${formatNumber(created.rowCount ?? 0)} rows.`);
      }
    } catch (error) {
      toast.error('Could not generate', error instanceof ApiError ? error.message : undefined);
    }
  };

  const download = async (report: Report) => {
    setDownloading(true);
    const outcome = await downloadAuthenticatedFile(
      `/reports/${report.id}/download`,
      `${report.reference}.${report.format.toLowerCase()}`,
    );
    setDownloading(false);
    if (outcome.saved) toast.success('Download started', `${report.reference}.${report.format.toLowerCase()}`);
    else toast.error('Download failed', outcome.reason);
  };

  if (result) {
    const totals = Object.entries(result.totals ?? {});
    return (
      <Screen>
        <PageHeader title="Report generated" subtitle={result.reference} onBack={() => router.replace('/report')} />
        <Card>
          <Row justify="space-between" style={{ marginBottom: 8 }}>
            <Badge label={result.status} tone={result.status === 'READY' ? 'success' : 'danger'} />
            <Badge label={result.format} tone="neutral" />
          </Row>
          <Body style={{ fontWeight: '700', marginBottom: 8 }}>{result.title}</Body>
          <Definition label="Type" value={result.type.replace(/_/g, ' ')} />
          <Definition label="Rows" value={formatNumber(result.rowCount ?? 0)} />
          {result.totalRows && result.totalRows !== result.rowCount ? (
            <Definition label="Rows in scope" value={`${formatNumber(result.totalRows)}${result.truncated ? ' (truncated by the row limit)' : ''}`} />
          ) : null}
          <Definition label="Size" value={result.sizeBytes ? `${(Number(result.sizeBytes) / 1024).toFixed(1)} KB` : '—'} />
          <Definition
            label="Period"
            value={result.dateFrom && result.dateTo ? `${formatDateInput(result.dateFrom)} → ${formatDateInput(result.dateTo)}` : 'whole register'}
          />
          {result.forest ? <Definition label="Forest" value={`${result.forest.name} (${result.forest.code})`} /> : null}
          {result.company ? <Definition label="Company" value={result.company.name} /> : null}
          {result.generatedBy ? <Definition label="Generated by" value={`${result.generatedBy.firstName} ${result.generatedBy.lastName}`} /> : null}

          {result.summary?.length ? (
            <View style={{ marginTop: 12 }}>
              <Overline style={{ marginBottom: 6 }}>Summary block</Overline>
              {result.summary.map((entry) => (
                <Definition key={entry.label} label={entry.label} value={entry.value} />
              ))}
            </View>
          ) : null}

          {totals.length ? (
            <View style={{ marginTop: 12 }}>
              <Overline style={{ marginBottom: 6 }}>Totals</Overline>
              {totals.map(([key, value]) => (
                <Definition key={key} label={key.replace(/([A-Z])/g, ' $1').toLowerCase()} value={formatNumber(Number(value))} />
              ))}
            </View>
          ) : null}

          {result.notes?.length ? (
            <Notice tone="neutral" title="Notes recorded with the report">
              {result.notes.map((note) => (
                <Caption key={note} tone="muted">
                  • {note}
                </Caption>
              ))}
            </Notice>
          ) : null}
        </Card>

        <Row gap={8} wrap style={{ marginTop: 12 }}>
          {result.status === 'READY' ? (
            <Button label="Download file" icon="download-outline" loading={downloading} onPress={() => void download(result)} />
          ) : null}
          <Button label="Open report" variant="secondary" icon="reader-outline" onPress={() => router.replace({ pathname: '/report/[id]', params: { id: result.id } })} />
          <Button label="Report library" variant="secondary" icon="albums-outline" onPress={() => router.replace('/report')} />
        </Row>
        {result.status === 'READY' ? (
          <Caption tone="faint" style={{ marginTop: 8 }}>
            The file is held by the API and streamed only to a caller with the export permission — it is never placed at a public URL.
          </Caption>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader title="New report" subtitle="Built from the live register" onBack={() => router.back()} />

      <Section title="Report type">
        <Caption tone="muted" style={{ marginBottom: 8 }}>
          The catalogue comes from the API and describes what each report contains.
        </Caption>
        {catalogue.isLoading ? <SkeletonList rows={3} /> : null}
        {catalogue.isError ? (
          <Button label="Retry the catalogue" variant="secondary" onPress={() => catalogue.refetch()} />
        ) : null}
        {entries.map((entry) => {
          const active = type === entry.type;
          const previous = statistics.data?.byType.find((row) => row.type === entry.type)?.generated ?? 0;
          return (
            <Card
              key={entry.type}
              style={{ marginBottom: 8, borderColor: active ? theme.colors.primary : theme.colors.border, borderWidth: active ? 1.5 : undefined }}
            >
              <Row justify="space-between" style={{ marginBottom: 4 }}>
                <Body style={{ fontWeight: '700', flex: 1 }}>{entry.label}</Body>
                {active ? <Badge label="selected" tone="primary" compact /> : null}
              </Row>
              <Caption tone="muted">{entry.description}</Caption>
              <Row gap={6} wrap style={{ marginTop: 8 }}>
                {entry.formats.map((value) => (
                  <Badge key={value} label={value} tone="neutral" compact />
                ))}
                <Tiny tone="faint">{previous > 0 ? `${previous} generated so far` : 'never generated'}</Tiny>
              </Row>
              <Row gap={8} style={{ marginTop: 10 }}>
                <Button
                  size="sm"
                  label={active ? 'Selected' : 'Choose'}
                  variant={active ? 'secondary' : 'primary'}
                  disabled={active}
                  onPress={() => {
                    setType(entry.type);
                    if (!entry.formats.includes(format)) setFormat(entry.formats[0]);
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  label={active ? 'Columns shown' : 'Columns'}
                  onPress={() => setType(entry.type)}
                />
              </Row>
            </Card>
          );
        })}
      </Section>

      {selected ? (
        <Section title={`Columns in ${selected.label}`}>
          <Caption tone="muted" style={{ marginBottom: 8 }}>
            Each column is produced by the report definition on the server.
          </Caption>
          <Card>
            {selected.columns.map((column) => (
              <Row key={column.key} justify="space-between" style={{ marginBottom: 4 }}>
                <Tiny>{column.label}</Tiny>
                <Tiny tone="faint">{column.key}</Tiny>
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Output format">
        <Row gap={6} wrap>
          {formats.map((value) => (
            <Chip key={value} label={value} selected={format === value} onPress={() => setFormat(value)} />
          ))}
        </Row>
        <Caption tone="faint" style={{ marginTop: 6 }}>
          PDF is laid out for circulation, CSV opens in a spreadsheet, JSON is the raw dataset.
        </Caption>
        <View style={{ marginTop: 10 }}>
          <TextField label="Title (optional)" value={title} onChangeText={setTitle} placeholder="Derived from the type and period when left empty" />
        </View>
      </Section>

      <Section title="Scope">
        <Caption tone="muted" style={{ marginBottom: 8 }}>
          Leave everything empty to report on the whole register your role can see.
        </Caption>
        <SelectSheet
          label="Forest"
          value={forestId}
          placeholder="Whole national register"
          options={[
            { value: '__none__', label: 'Whole national register' },
            ...(forests.data?.items ?? []).map((forest) => ({ value: forest.id, label: `${forest.name} (${forest.code})` })),
          ]}
          onChange={(value) => setForestId(value === '__none__' ? null : value)}
        />
        <SelectSheet
          label="Company"
          value={companyId}
          placeholder="Every company"
          options={[
            { value: '__none__', label: 'Every company' },
            ...(companies.data?.items ?? []).map((company) => ({ value: company.id, label: company.name })),
          ]}
          onChange={(value) => setCompanyId(value === '__none__' ? null : value)}
        />
        <SelectSheet
          label="Permit"
          value={permitId}
          placeholder="Every permit in scope"
          options={[
            { value: '__none__', label: 'Every permit in scope' },
            ...(permits.data?.items ?? []).map((permit) => ({
              value: permit.id,
              label: `${permit.permitNumber} · ${permit.company?.name ?? 'company'}`,
            })),
          ]}
          onChange={(value) => setPermitId(value === '__none__' ? null : value)}
        />
      </Section>

      <Section title="Period">
        <Row gap={6} wrap style={{ marginBottom: 10 }}>
          {QUICK_RANGES.map((range) => (
            <Chip
              key={range.label}
              label={range.label}
              selected={from === toIsoDateInput(new Date(Date.now() - range.days * 86_400_000))}
              onPress={() => {
                setFrom(toIsoDateInput(new Date(Date.now() - range.days * 86_400_000)));
                setTo(today);
              }}
            />
          ))}
          <Chip label="Whole register" selected={!from && !to} onPress={() => { setFrom(''); setTo(''); }} />
        </Row>
        <Row gap={8}>
          <TextField label="From" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" style={{ flex: 1 }} />
          <TextField label="To" value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" style={{ flex: 1 }} />
        </Row>
      </Section>

      <Section title="Row limit">
        <Row gap={6} wrap>
          <Chip label="Catalogue maximum" selected={maxRows === null} onPress={() => setMaxRows(null)} />
          {[100, 500, 1000, 5000].map((value) => (
            <Chip key={value} label={formatNumber(value)} selected={maxRows === value} onPress={() => setMaxRows(value)} />
          ))}
        </Row>
        <Tiny tone="faint" style={{ marginTop: 6 }}>
          The limit is capped by the server at {formatNumber(catalogue.data?.maxRows ?? 0)} rows and recorded with the report.
        </Tiny>
      </Section>

      {preview.data ? (
        <Section title="Preview">
          <Caption tone="muted" style={{ marginBottom: 8 }}>
            {`First rows of the dataset — ${formatNumber(preview.data.rowCount)} of ${formatNumber(preview.data.totalRows)} row(s).`}
          </Caption>
          <Card>
            {preview.data.summary.length ? (
              <View style={{ marginBottom: 10 }}>
                {preview.data.summary.map((entry) => (
                  <Definition key={entry.label} label={entry.label} value={entry.value} />
                ))}
              </View>
            ) : null}
            <DataTable columns={preview.data.columns.map((column) => ({ key: column.key, label: column.label }))} rows={preview.data.rows} maxRows={8} />
            {preview.data.truncated ? (
              <Tiny tone="faint" style={{ marginTop: 8 }}>
                The dataset is larger than the row limit; the stored report will contain {formatNumber(maxRows ?? catalogue.data?.maxRows ?? 0)} rows.
              </Tiny>
            ) : null}
          </Card>
        </Section>
      ) : null}

      <Row gap={8} wrap>
        <Button
          label={preview.isPending ? 'Reading the register…' : 'Preview rows'}
          variant="secondary"
          icon="eye-outline"
          loading={preview.isPending}
          onPress={() => void runPreview()}
        />
        <Button
          label={generate.isPending ? 'Building the file…' : 'Generate report'}
          icon="document-text-outline"
          loading={generate.isPending}
          onPress={() => void runGenerate()}
        />
      </Row>
      <Caption tone="faint" style={{ marginTop: 8 }}>
        Generation runs on the server against the live database, with your role's scope applied first. A report that cannot be built is stored as FAILED with the
        reason, never as an empty file.
      </Caption>
      <View style={{ height: 8 }} />
    </Screen>
  );
}
