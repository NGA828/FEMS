import { ChecklistResult, InspectionOutcome, InspectionStatus } from '@prisma/client';
import {
  INSPECTION_ACTIONS,
  INSPECTION_SITE_MAX_M,
  INSPECTION_SITE_WARN_M,
  checkInspectionTransition,
  checkSiteDistance,
  computeComplianceScore,
  defaultChecklist,
  isInspectionEditable,
  outcomeMatchesChecklist,
} from './inspection-state';

describe('inspection-state', () => {
  describe('checkInspectionTransition', () => {
    it('starts a scheduled inspection', () => {
      const result = checkInspectionTransition('START', InspectionStatus.SCHEDULED);
      expect(result.ok).toBe(true);
      expect(result.transition?.to).toBe(InspectionStatus.IN_PROGRESS);
    });

    it('refuses to submit a report before the field work started', () => {
      const result = checkInspectionTransition('SUBMIT', InspectionStatus.SCHEDULED);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INSPECTION_INVALID_TRANSITION');
    });

    it('runs the review only after submission', () => {
      expect(checkInspectionTransition('REVIEW', InspectionStatus.SUBMITTED).ok).toBe(true);
      expect(checkInspectionTransition('REVIEW', InspectionStatus.IN_PROGRESS).code).toBe('INSPECTION_INVALID_TRANSITION');
    });

    it('closes only a reviewed inspection', () => {
      expect(checkInspectionTransition('CLOSE', InspectionStatus.REVIEWED).ok).toBe(true);
      expect(checkInspectionTransition('CLOSE', InspectionStatus.SUBMITTED).code).toBe('INSPECTION_INVALID_TRANSITION');
    });

    it('requires a reason to cancel', () => {
      expect(checkInspectionTransition('CANCEL', InspectionStatus.SCHEDULED).code).toBe('REASON_REQUIRED');
      expect(checkInspectionTransition('CANCEL', InspectionStatus.SCHEDULED, 'Road flooded').ok).toBe(true);
    });

    it('never reopens a closed or cancelled inspection', () => {
      expect(checkInspectionTransition('START', InspectionStatus.CLOSED).code).toBe('INSPECTION_INVALID_TRANSITION');
      expect(checkInspectionTransition('START', InspectionStatus.CANCELLED).code).toBe('INSPECTION_INVALID_TRANSITION');
    });

    it('rejects an unknown action', () => {
      expect(checkInspectionTransition('APPROVE', InspectionStatus.SUBMITTED).code).toBe('INSPECTION_ACTION_UNKNOWN');
    });

    it('marks only the field steps as inspector-only', () => {
      const inspectorOnly = INSPECTION_ACTIONS.filter((action) => {
        const spec = { START: true, SUBMIT: true, REVIEW: false, CLOSE: false, CANCEL: false } as Record<string, boolean>;
        return spec[action];
      });
      expect(inspectorOnly).toEqual(['START', 'SUBMIT']);
    });
  });

  it('allows editing only before the report is submitted', () => {
    expect(isInspectionEditable(InspectionStatus.SCHEDULED)).toBe(true);
    expect(isInspectionEditable(InspectionStatus.IN_PROGRESS)).toBe(true);
    expect(isInspectionEditable(InspectionStatus.SUBMITTED)).toBe(false);
    expect(isInspectionEditable(InspectionStatus.CLOSED)).toBe(false);
  });

  describe('computeComplianceScore', () => {
    it('scores the share of applicable items that passed', () => {
      const result = computeComplianceScore([
        { result: ChecklistResult.PASS },
        { result: ChecklistResult.PASS },
        { result: ChecklistResult.FAIL },
        { result: ChecklistResult.NOT_APPLICABLE },
      ]);
      expect(result.score).toBe(67);
      expect(result.applicable).toBe(3);
      expect(result.failed).toBe(1);
      expect(result.notApplicable).toBe(1);
    });

    it('returns 100 when everything applicable passed', () => {
      expect(computeComplianceScore([{ result: ChecklistResult.PASS }]).score).toBe(100);
    });

    it('returns a null score — never 0 — when nothing is applicable', () => {
      const result = computeComplianceScore([{ result: ChecklistResult.NOT_APPLICABLE }]);
      expect(result.score).toBeNull();
      expect(result.applicable).toBe(0);
    });

    it('returns a null score for an empty checklist', () => {
      expect(computeComplianceScore([]).score).toBeNull();
    });
  });

  describe('outcomeMatchesChecklist', () => {
    it('accepts COMPLIANT only without failures', () => {
      const clean = computeComplianceScore([{ result: ChecklistResult.PASS }]);
      const failed = computeComplianceScore([{ result: ChecklistResult.PASS }, { result: ChecklistResult.FAIL }]);
      expect(outcomeMatchesChecklist(InspectionOutcome.COMPLIANT, clean)).toBe(true);
      expect(outcomeMatchesChecklist(InspectionOutcome.COMPLIANT, failed)).toBe(false);
    });

    it('requires at least one failure for a non-compliance outcome', () => {
      const clean = computeComplianceScore([{ result: ChecklistResult.PASS }]);
      const failed = computeComplianceScore([{ result: ChecklistResult.FAIL }]);
      expect(outcomeMatchesChecklist(InspectionOutcome.MINOR_NON_COMPLIANCE, failed)).toBe(true);
      expect(outcomeMatchesChecklist(InspectionOutcome.MAJOR_NON_COMPLIANCE, failed)).toBe(true);
      expect(outcomeMatchesChecklist(InspectionOutcome.CRITICAL_NON_COMPLIANCE, failed)).toBe(true);
      expect(outcomeMatchesChecklist(InspectionOutcome.MAJOR_NON_COMPLIANCE, clean)).toBe(false);
    });
  });

  describe('checkSiteDistance', () => {
    it('accepts a fix captured on site', () => {
      const result = checkSiteDistance(120);
      expect(result.ok).toBe(true);
      expect(result.warning).toBeNull();
    });

    it('accepts a fix off site but warns about it', () => {
      const result = checkSiteDistance(INSPECTION_SITE_WARN_M + 500);
      expect(result.ok).toBe(true);
      expect(result.warning).toContain('away from the inspected site');
    });

    it('refuses a report filed implausibly far from the site', () => {
      const result = checkSiteDistance(INSPECTION_SITE_MAX_M + 1);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INSPECTION_TOO_FAR_FROM_SITE');
    });
  });

  describe('checklist templates', () => {
    it('provides a template for every inspection type', () => {
      for (const type of ['ROUTINE', 'COMPLIANCE', 'ENVIRONMENTAL', 'POST_ACTIVITY', 'INCIDENT', 'VERIFICATION']) {
        const template = defaultChecklist(type);
        expect(template.length).toBeGreaterThanOrEqual(4);
        expect(new Set(template.map((item) => item.code)).size).toBe(template.length);
      }
    });

    it('falls back to the routine template for an unknown type', () => {
      expect(defaultChecklist('SOMETHING_ELSE')).toEqual(defaultChecklist('ROUTINE'));
    });
  });
});
