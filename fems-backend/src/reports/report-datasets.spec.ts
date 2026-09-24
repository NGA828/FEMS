import { ReportFormat, ReportType } from '@prisma/client';
import {
  MAX_REPORT_ROWS,
  REPORT_CATALOGUE,
  REPORT_TYPES,
  capRows,
  csvField,
  describePeriod,
  reportDefinition,
  scoreCompliance,
  summarise,
  toCsv,
} from './report-datasets';

describe('report-datasets', () => {
  describe('catalogue', () => {
    it('describes every report type with columns and formats', () => {
      expect(REPORT_TYPES.length).toBe(Object.keys(REPORT_CATALOGUE).length);
      for (const type of REPORT_TYPES) {
        const definition = reportDefinition(type);
        expect(definition.label.length).toBeGreaterThan(3);
        expect(definition.description.length).toBeGreaterThan(20);
        expect(definition.columns.length).toBeGreaterThan(3);
        expect(definition.formats).toContain(ReportFormat.PDF);
        expect(definition.formats).toContain(ReportFormat.CSV);
        expect(definition.formats).toContain(ReportFormat.JSON);
      }
    });

    it('covers the eight report types of the specification', () => {
      expect([...REPORT_TYPES].sort()).toEqual(
        [
          'AI_ALERTS',
          'COMPLIANCE_SUMMARY',
          'ENVIRONMENTAL_VIOLATIONS',
          'EXPLOITATION_ACTIVITIES',
          'FOREST_ACTIVITIES',
          'INSPECTIONS',
          'PAYMENTS',
          'PERMITS',
        ].sort(),
      );
    });

    it('uses unique column keys inside a report', () => {
      for (const type of REPORT_TYPES) {
        const keys = reportDefinition(type).columns.map((column) => column.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
    });
  });

  describe('csvField', () => {
    it('leaves a simple value untouched', () => {
      expect(csvField('UFA 10-012')).toBe('UFA 10-012');
    });

    it('quotes values containing a comma, a quote or a line break', () => {
      expect(csvField('Sapelli, Iroko')).toBe('"Sapelli, Iroko"');
      expect(csvField('He said "stop"')).toBe('"He said ""stop"""');
      expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    });

    it('renders empty values for null and undefined', () => {
      expect(csvField(null)).toBe('');
      expect(csvField(undefined)).toBe('');
    });

    it('renders dates as ISO strings and keeps numbers plain', () => {
      expect(csvField(new Date('2026-03-09T10:00:00Z'))).toBe('2026-03-09T10:00:00.000Z');
      expect(csvField(1234.5)).toBe('1234.5');
      expect(csvField(0)).toBe('0');
    });
  });

  describe('toCsv', () => {
    it('writes a header row using the column labels', () => {
      const csv = toCsv(
        [
          { key: 'reference', label: 'Permit' },
          { key: 'feeAmount', label: 'Fee (XAF)', numeric: true },
        ],
        [{ reference: 'FEMS-EXP-1', feeAmount: 300000 }],
      );
      expect(csv.split('\r\n')[0]).toBe('Permit,Fee (XAF)');
      expect(csv.split('\r\n')[1]).toBe('FEMS-EXP-1,300000');
    });

    it('produces only the header when there is no row', () => {
      const csv = toCsv([{ key: 'a', label: 'A' }], []);
      expect(csv).toBe('A');
    });

    it('escapes company names containing a comma', () => {
      const csv = toCsv(
        [
          { key: 'companyName', label: 'Company' },
          { key: 'amount', label: 'Amount', numeric: true },
        ],
        [{ companyName: 'Bois du Cameroun, SARL', amount: 10 }],
      );
      expect(csv).toContain('"Bois du Cameroun, SARL",10');
    });
  });

  describe('summarise', () => {
    it('totals only the numeric columns', () => {
      const totals = summarise(
        [
          { key: 'volume', label: 'Volume', numeric: true },
          { key: 'name', label: 'Name' },
        ],
        [
          { volume: 10.5, name: 'a' },
          { volume: 4.25, name: 'b' },
        ],
      );
      expect(totals).toEqual({ volume: 14.75 });
    });

    it('ignores values that are not numbers', () => {
      const totals = summarise([{ key: 'volume', label: 'Volume', numeric: true }], [
        { volume: 5 },
        { volume: '—' },
        { volume: null },
      ]);
      expect(totals.volume).toBe(5);
    });

    it('returns an empty object when no column is numeric', () => {
      expect(summarise([{ key: 'name', label: 'Name' }], [{ name: 'a' }])).toEqual({});
    });
  });

  describe('capRows', () => {
    it('keeps everything when under the cap', () => {
      const result = capRows([1, 2, 3], 5);
      expect(result.truncated).toBe(false);
      expect(result.rows).toEqual([1, 2, 3]);
      expect(result.totalRows).toBe(3);
    });

    it('truncates and reports how many rows existed', () => {
      const result = capRows([1, 2, 3, 4], 2);
      expect(result.truncated).toBe(true);
      expect(result.rows).toEqual([1, 2]);
      expect(result.totalRows).toBe(4);
    });

    it('defaults to the server ceiling', () => {
      expect(MAX_REPORT_ROWS).toBe(5000);
      expect(capRows(new Array(MAX_REPORT_ROWS + 1).fill(0)).truncated).toBe(true);
    });
  });

  describe('scoreCompliance', () => {
    it('gives a clean company 100/100', () => {
      const result = scoreCompliance({ confirmedViolations: 0, openViolations: 0, remediationOverdue: 0, inspectionsCompleted: 0 });
      expect(result.score).toBe(100);
      expect(result.rating).toBe('COMPLIANT');
      expect(result.factors).toEqual([]);
    });

    it('deducts 15 points per confirmed violation, capped at 45', () => {
      expect(scoreCompliance({ confirmedViolations: 1, openViolations: 0, remediationOverdue: 0, inspectionsCompleted: 0 }).score).toBe(85);
      expect(scoreCompliance({ confirmedViolations: 5, openViolations: 0, remediationOverdue: 0, inspectionsCompleted: 0 }).score).toBe(55);
    });

    it('combines the deductions of every factor', () => {
      const result = scoreCompliance({
        confirmedViolations: 1,
        openViolations: 2,
        remediationOverdue: 1,
        inspectionsCompleted: 3,
        averageComplianceScore: 60,
      });
      // 100 - 15 (confirmed) - 10 (open) - 10 (overdue) - 10 (compliance shortfall 40/4)
      expect(result.score).toBe(55);
      expect(result.factors.map((factor) => factor.code)).toEqual([
        'CONFIRMED_VIOLATIONS',
        'OVERDUE_REMEDIATION',
        'OPEN_CASES',
        'INSPECTION_COMPLIANCE',
      ]);
    });

    it('never goes below zero', () => {
      const result = scoreCompliance({
        confirmedViolations: 12,
        openViolations: 9,
        remediationOverdue: 6,
        expiredPermitsWithActivity: 4,
        inspectionsCompleted: 5,
        averageComplianceScore: 0,
      });
      expect(result.score).toBe(0);
      expect(result.rating).toBe('CRITICAL_NON_COMPLIANCE');
    });

    it('applies the rating bands', () => {
      const score = (input: Parameters<typeof scoreCompliance>[0]) => scoreCompliance(input);
      // 100 → COMPLIANT, 85 → MINOR, 70 → MAJOR, 40 → CRITICAL
      expect(score({ confirmedViolations: 0, openViolations: 0, remediationOverdue: 0, inspectionsCompleted: 0 })).toMatchObject({
        score: 100,
        rating: 'COMPLIANT',
      });
      expect(score({ confirmedViolations: 1, openViolations: 0, remediationOverdue: 0, inspectionsCompleted: 0 })).toMatchObject({
        score: 85,
        rating: 'MINOR_NON_COMPLIANCE',
      });
      expect(score({ confirmedViolations: 2, openViolations: 0, remediationOverdue: 0, inspectionsCompleted: 0 })).toMatchObject({
        score: 70,
        rating: 'MAJOR_NON_COMPLIANCE',
      });
      // 45 (confirmed, capped) + 15 (open cases, capped) = 60 points of deduction
      expect(score({ confirmedViolations: 3, openViolations: 3, remediationOverdue: 0, inspectionsCompleted: 0 })).toMatchObject({
        score: 40,
        rating: 'CRITICAL_NON_COMPLIANCE',
      });
    });

    it('does not reward a company for never being inspected', () => {
      const neverInspected = scoreCompliance({ confirmedViolations: 0, openViolations: 0, remediationOverdue: 0, inspectionsCompleted: 0 });
      const wellInspected = scoreCompliance({
        confirmedViolations: 0,
        openViolations: 0,
        remediationOverdue: 0,
        inspectionsCompleted: 4,
        averageComplianceScore: 100,
      });
      expect(neverInspected.score).toBe(100);
      expect(wellInspected.score).toBe(100);
      expect(wellInspected.factors).toEqual([]);
    });

    it('deducts for expired permits still showing activity', () => {
      const result = scoreCompliance({
        confirmedViolations: 0,
        openViolations: 0,
        remediationOverdue: 0,
        expiredPermitsWithActivity: 2,
        inspectionsCompleted: 0,
      });
      expect(result.score).toBe(80);
      expect(result.factors[0].code).toBe('EXPIRED_PERMIT_ACTIVITY');
    });
  });

  describe('describePeriod', () => {
    it('describes a bounded period', () => {
      expect(describePeriod(new Date('2026-01-01T00:00:00Z'), new Date('2026-03-31T00:00:00Z'))).toBe('2026-01-01 → 2026-03-31');
    });

    it('handles an open-ended period', () => {
      expect(describePeriod(new Date('2026-01-01T00:00:00Z'), null)).toBe('From 2026-01-01');
      expect(describePeriod(null, new Date('2026-03-31T00:00:00Z'))).toBe('Up to 2026-03-31');
    });

    it('says so when there is no period at all', () => {
      expect(describePeriod(null, null)).toBe('All records to date');
    });
  });

  it('keeps the definition lookup consistent with the catalogue', () => {
    for (const type of REPORT_TYPES) {
      expect(reportDefinition(type).type).toBe(type);
      expect(REPORT_CATALOGUE[type].supportsGlobal).toBe(true);
    }
  });

  it('marks financial and volume columns as numeric in every report', () => {
    expect(reportDefinition(ReportType.PAYMENTS).columns.find((column) => column.key === 'amount')?.numeric).toBe(true);
    expect(reportDefinition(ReportType.PERMITS).columns.find((column) => column.key === 'feeAmount')?.numeric).toBe(true);
    expect(
      reportDefinition(ReportType.EXPLOITATION_ACTIVITIES).columns.find((column) => column.key === 'harvestedVolumeM3')?.numeric,
    ).toBe(true);
    expect(reportDefinition(ReportType.ENVIRONMENTAL_VIOLATIONS).columns.find((column) => column.key === 'penaltyAmountXAF')?.numeric).toBe(true);
  });
});
