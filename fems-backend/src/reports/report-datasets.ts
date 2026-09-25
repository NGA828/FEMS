import { ReportFormat, ReportType } from '@prisma/client';

/**
 * Report catalogue and pure shaping helpers.
 *
 * The analytics themselves live in `reports.service.ts` (they read the
 * database); everything that is deterministic — column definitions, CSV
 * rendering, numeric totals, the compliance scoring model and the row cap — is
 * here so it can be unit-tested without a database.
 */

export interface ReportColumn {
  key: string;
  label: string;
  /** Hint for CSV/PDF rendering: right-align and total numeric columns. */
  numeric?: boolean;
}

export interface ReportDefinition {
  type: ReportType;
  label: string;
  description: string;
  /** True when the report is meaningful with no filter at all. */
  supportsGlobal: boolean;
  formats: ReportFormat[];
  columns: ReportColumn[];
}

export const REPORT_CATALOGUE: Record<ReportType, ReportDefinition> = {
  PERMITS: {
    type: ReportType.PERMITS,
    label: 'Permit register',
    description: 'Every permit with its status, approved volume, fees and outstanding balance.',
    supportsGlobal: true,
    formats: [ReportFormat.JSON, ReportFormat.CSV, ReportFormat.PDF],
    columns: [
      { key: 'permitNumber', label: 'Permit' },
      { key: 'type', label: 'Type' },
      { key: 'title', label: 'Title' },
      { key: 'companyName', label: 'Company' },
      { key: 'forestName', label: 'Forest' },
      { key: 'status', label: 'Status' },
      { key: 'volumeApprovedM3', label: 'Approved (m³)', numeric: true },
      { key: 'feeAmount', label: 'Fee (XAF)', numeric: true },
      { key: 'outstandingBalance', label: 'Outstanding (XAF)', numeric: true },
      { key: 'startDate', label: 'Start' },
      { key: 'endDate', label: 'End' },
    ],
  },
  EXPLOITATION_ACTIVITIES: {
    type: ReportType.EXPLOITATION_ACTIVITIES,
    label: 'Exploitation activity register',
    description: 'Field activities with planned and harvested volumes, trees felled and completion status.',
    supportsGlobal: true,
    formats: [ReportFormat.JSON, ReportFormat.CSV, ReportFormat.PDF],
    columns: [
      { key: 'reference', label: 'Activity' },
      { key: 'activityType', label: 'Type' },
      { key: 'permitNumber', label: 'Permit' },
      { key: 'companyName', label: 'Company' },
      { key: 'forestName', label: 'Forest' },
      { key: 'status', label: 'Status' },
      { key: 'plannedVolumeM3', label: 'Planned (m³)', numeric: true },
      { key: 'harvestedVolumeM3', label: 'Harvested (m³)', numeric: true },
      { key: 'harvestedTreeCount', label: 'Trees', numeric: true },
      { key: 'plannedStartDate', label: 'Planned start' },
    ],
  },
  PAYMENTS: {
    type: ReportType.PAYMENTS,
    label: 'Payment and revenue statement',
    description: 'Payments collected by purpose and method, with receipts, for treasury reconciliation.',
    supportsGlobal: true,
    formats: [ReportFormat.JSON, ReportFormat.CSV, ReportFormat.PDF],
    columns: [
      { key: 'reference', label: 'Payment' },
      { key: 'purpose', label: 'Purpose' },
      { key: 'status', label: 'Status' },
      { key: 'method', label: 'Method' },
      { key: 'amount', label: 'Amount (XAF)', numeric: true },
      { key: 'currency', label: 'Currency' },
      { key: 'companyName', label: 'Company' },
      { key: 'permitNumber', label: 'Permit' },
      { key: 'receiptNumber', label: 'Receipt' },
      { key: 'paidAt', label: 'Paid at' },
    ],
  },
  INSPECTIONS: {
    type: ReportType.INSPECTIONS,
    label: 'Inspection register',
    description: 'Inspections carried out, their outcomes, compliance scores and the violations they raised.',
    supportsGlobal: true,
    formats: [ReportFormat.JSON, ReportFormat.CSV, ReportFormat.PDF],
    columns: [
      { key: 'reference', label: 'Inspection' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'outcome', label: 'Outcome' },
      { key: 'complianceScore', label: 'Compliance %', numeric: true },
      { key: 'forestName', label: 'Forest' },
      { key: 'companyName', label: 'Company' },
      { key: 'inspectorName', label: 'Inspector' },
      { key: 'distanceFromTargetM', label: 'Distance (m)', numeric: true },
      { key: 'submittedAt', label: 'Submitted' },
    ],
  },
  ENVIRONMENTAL_VIOLATIONS: {
    type: ReportType.ENVIRONMENTAL_VIOLATIONS,
    label: 'Environmental case register',
    description: 'Cases with severity, assessed damage, penalties collected and remediation deadlines.',
    supportsGlobal: true,
    formats: [ReportFormat.JSON, ReportFormat.CSV, ReportFormat.PDF],
    columns: [
      { key: 'reference', label: 'Case' },
      { key: 'title', label: 'Title' },
      { key: 'severity', label: 'Severity' },
      { key: 'status', label: 'Status' },
      { key: 'companyName', label: 'Company' },
      { key: 'forestName', label: 'Forest' },
      { key: 'estimatedDamageXAF', label: 'Damage (XAF)', numeric: true },
      { key: 'penaltyAmountXAF', label: 'Penalty (XAF)', numeric: true },
      { key: 'penaltyPaidXAF', label: 'Collected (XAF)', numeric: true },
      { key: 'remediationDeadline', label: 'Remediation due' },
      { key: 'detectedAt', label: 'Detected' },
    ],
  },
  FOREST_ACTIVITIES: {
    type: ReportType.FOREST_ACTIVITIES,
    label: 'Forest activity summary',
    description: 'Per-forest totals: zones, area under management, activity volume, cases and inspections.',
    supportsGlobal: true,
    formats: [ReportFormat.JSON, ReportFormat.CSV, ReportFormat.PDF],
    columns: [
      { key: 'forestCode', label: 'Code' },
      { key: 'forestName', label: 'Forest' },
      { key: 'region', label: 'Region' },
      { key: 'zoneCount', label: 'Zones', numeric: true },
      { key: 'areaHa', label: 'Area (ha)', numeric: true },
      { key: 'activityCount', label: 'Activities', numeric: true },
      { key: 'harvestedVolumeM3', label: 'Harvested (m³)', numeric: true },
      { key: 'inspectionCount', label: 'Inspections', numeric: true },
      { key: 'violationCount', label: 'Cases', numeric: true },
    ],
  },
  COMPLIANCE_SUMMARY: {
    type: ReportType.COMPLIANCE_SUMMARY,
    label: 'Company compliance scorecard',
    description:
      'Cross-module scorecard per company: active permits, harvested volume, inspections, open and confirmed cases, penalties and overdue remediation.',
    supportsGlobal: true,
    formats: [ReportFormat.JSON, ReportFormat.CSV, ReportFormat.PDF],
    columns: [
      { key: 'companyName', label: 'Company' },
      { key: 'companyStatus', label: 'Status' },
      { key: 'activePermits', label: 'Active permits', numeric: true },
      { key: 'harvestedVolumeM3', label: 'Harvested (m³)', numeric: true },
      { key: 'inspectionsCompleted', label: 'Inspections', numeric: true },
      { key: 'averageComplianceScore', label: 'Avg compliance %', numeric: true },
      { key: 'openViolations', label: 'Open cases', numeric: true },
      { key: 'confirmedViolations', label: 'Confirmed', numeric: true },
      { key: 'penaltiesOutstandingXAF', label: 'Penalties due (XAF)', numeric: true },
      { key: 'remediationOverdue', label: 'Overdue remediation', numeric: true },
      { key: 'score', label: 'Score', numeric: true },
      { key: 'rating', label: 'Rating' },
    ],
  },
  AI_ALERTS: {
    type: ReportType.AI_ALERTS,
    label: 'Forest intelligence alert register',
    description: 'Alerts raised by the analysis engine with their review status and how they were closed.',
    supportsGlobal: true,
    formats: [ReportFormat.JSON, ReportFormat.CSV, ReportFormat.PDF],
    columns: [
      { key: 'reference', label: 'Alert' },
      { key: 'type', label: 'Type' },
      { key: 'riskLevel', label: 'Risk' },
      { key: 'status', label: 'Status' },
      { key: 'confidence', label: 'Confidence', numeric: true },
      { key: 'detector', label: 'Detector' },
      { key: 'forestName', label: 'Forest' },
      { key: 'companyName', label: 'Company' },
      { key: 'reviewedByName', label: 'Reviewed by' },
      { key: 'detectedAt', label: 'Detected' },
      { key: 'resolutionAction', label: 'Resolution' },
    ],
  },
};

export const REPORT_TYPES = Object.keys(REPORT_CATALOGUE) as ReportType[];

export function reportDefinition(type: ReportType): ReportDefinition {
  return REPORT_CATALOGUE[type];
}

/** Hard ceiling per generated report — the summary states when it is applied. */
export const MAX_REPORT_ROWS = 5000;

export interface RowCapResult<T> {
  rows: T[];
  truncated: boolean;
  totalRows: number;
}

export function capRows<T>(rows: T[], max = MAX_REPORT_ROWS): RowCapResult<T> {
  if (rows.length <= max) return { rows, truncated: false, totalRows: rows.length };
  return { rows: rows.slice(0, max), truncated: true, totalRows: rows.length };
}

/** Escapes a single CSV field (RFC 4180). */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (/["\n\r,;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(columns: ReportColumn[], rows: Array<Record<string, unknown>>): string {
  const header = columns.map((column) => csvField(column.label)).join(',');
  const body = rows.map((row) => columns.map((column) => csvField(row[column.key])).join(','));
  return [header, ...body].join('\r\n');
}

/** Totals of every numeric column, used in the summary block of every format. */
export function summarise(columns: ReportColumn[], rows: Array<Record<string, unknown>>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const column of columns) {
    if (!column.numeric) continue;
    const total = rows.reduce((sum, row) => {
      const value = Number(row[column.key]);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
    totals[column.key] = Math.round(total * 100) / 100;
  }
  return totals;
}

/**
 * Compliance scoring model.
 *
 * Deterministic and explainable: each factor is a documented deduction, and the
 * rating bands are fixed. It is used by the scorecard report and by the AI
 * module's rule engine — never to accuse anyone, only to rank who needs a visit.
 */
export interface ComplianceInput {
  confirmedViolations: number;
  openViolations: number;
  remediationOverdue: number;
  expiredPermitsWithActivity?: number;
  inspectionsCompleted: number;
  averageComplianceScore?: number | null;
}

export interface ComplianceScore {
  score: number;
  rating: 'COMPLIANT' | 'MINOR_NON_COMPLIANCE' | 'MAJOR_NON_COMPLIANCE' | 'CRITICAL_NON_COMPLIANCE';
  factors: Array<{ code: string; deduction: number; detail: string }>;
}

export function scoreCompliance(input: ComplianceInput): ComplianceScore {
  const factors: ComplianceScore['factors'] = [];
  const deduct = (code: string, deduction: number, detail: string) => {
    if (deduction <= 0) return;
    factors.push({ code, deduction, detail });
  };

  deduct(
    'CONFIRMED_VIOLATIONS',
    Math.min(45, input.confirmedViolations * 15),
    `${input.confirmedViolations} confirmed violation(s) × 15 points (capped at 45)`,
  );
  deduct(
    'OVERDUE_REMEDIATION',
    Math.min(20, input.remediationOverdue * 10),
    `${input.remediationOverdue} remediation deadline(s) passed × 10 points (capped at 20)`,
  );
  deduct(
    'OPEN_CASES',
    Math.min(15, input.openViolations * 5),
    `${input.openViolations} case(s) still open × 5 points (capped at 15)`,
  );
  deduct(
    'EXPIRED_PERMIT_ACTIVITY',
    Math.min(20, (input.expiredPermitsWithActivity ?? 0) * 10),
    `${input.expiredPermitsWithActivity ?? 0} expired permit(s) with activity × 10 points (capped at 20)`,
  );

  // Field results only soften the score when inspections actually took place and
  // the officer's own compliance percentage was low — never a reward for being
  // uninspected.
  if (input.inspectionsCompleted > 0 && input.averageComplianceScore !== null && input.averageComplianceScore !== undefined) {
    const shortfall = 100 - input.averageComplianceScore;
    deduct('INSPECTION_COMPLIANCE', Math.min(25, Math.round(shortfall / 4)), `average inspection compliance ${input.averageComplianceScore}%`);
  }

  const deduction = factors.reduce((sum, factor) => sum + factor.deduction, 0);
  const score = Math.max(0, Math.min(100, 100 - deduction));
  const rating: ComplianceScore['rating'] =
    score >= 90
      ? 'COMPLIANT'
      : score >= 75
        ? 'MINOR_NON_COMPLIANCE'
        : score >= 55
          ? 'MAJOR_NON_COMPLIANCE'
          : 'CRITICAL_NON_COMPLIANCE';

  return { score, rating, factors };
}

/** Human label used in PDF/CSV headers for the reporting period. */
export function describePeriod(from?: Date | null, to?: Date | null): string {
  if (!from && !to) return 'All records to date';
  const format = (date: Date) => date.toISOString().slice(0, 10);
  if (from && to) return `${format(from)} → ${format(to)}`;
  if (from) return `From ${format(from)}`;
  return `Up to ${format(to as Date)}`;
}
