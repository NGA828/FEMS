import { AlertStatus, RiskLevel } from '@prisma/client';
import {
  ALERT_ACTION_PERMISSIONS,
  ALERT_TRANSITIONS,
  alertPosition,
  availableAlertActions,
  checkAlertTransition,
  isAlertOverdue,
  summariseAlerts,
  validateReviewInput,
} from './alert-state';

describe('alert-state', () => {
  describe('checkAlertTransition', () => {
    it('lets an officer acknowledge a new alert into review', () => {
      const check = checkAlertTransition(AlertStatus.NEW, 'ACKNOWLEDGE');
      expect(check.allowed).toBe(true);
      expect(check.to).toBe(AlertStatus.REVIEWING);
    });

    it('lets an officer confirm or dismiss a new alert directly', () => {
      expect(checkAlertTransition(AlertStatus.NEW, 'CONFIRM').to).toBe(AlertStatus.CONFIRMED);
      expect(checkAlertTransition(AlertStatus.NEW, 'DISMISS').to).toBe(AlertStatus.DISMISSED);
    });

    it('refuses to confirm an alert that is still in review without passing through the table', () => {
      expect(checkAlertTransition(AlertStatus.REVIEWING, 'CONFIRM').allowed).toBe(true);
      expect(checkAlertTransition(AlertStatus.REVIEWING, 'ACKNOWLEDGE').allowed).toBe(false);
      expect(checkAlertTransition(AlertStatus.REVIEWING, 'ACKNOWLEDGE').code).toBe('ALERT_INVALID_TRANSITION');
    });

    it('resolves only a confirmed alert', () => {
      expect(checkAlertTransition(AlertStatus.CONFIRMED, 'RESOLVE').to).toBe(AlertStatus.RESOLVED);
      expect(checkAlertTransition(AlertStatus.NEW, 'RESOLVE').allowed).toBe(false);
      expect(checkAlertTransition(AlertStatus.DISMISSED, 'RESOLVE').allowed).toBe(false);
    });

    it('reopens a dismissed or resolved alert into review, never back to new', () => {
      expect(checkAlertTransition(AlertStatus.DISMISSED, 'REOPEN').to).toBe(AlertStatus.REVIEWING);
      expect(checkAlertTransition(AlertStatus.RESOLVED, 'REOPEN').to).toBe(AlertStatus.REVIEWING);
      expect(checkAlertTransition(AlertStatus.CONFIRMED, 'REOPEN').allowed).toBe(false);
    });

    it('explains what is allowed instead of failing silently', () => {
      const check = checkAlertTransition(AlertStatus.RESOLVED, 'CONFIRM');
      expect(check.allowed).toBe(false);
      expect(check.message).toContain('REOPEN');
    });

    it('covers every status in the table', () => {
      for (const status of Object.values(AlertStatus)) {
        expect(ALERT_TRANSITIONS[status]).toBeDefined();
      }
    });
  });

  describe('validateReviewInput', () => {
    const long = 'documented reason for the decision';

    it('requires a reason of at least ten characters for a confirmation', () => {
      expect(validateReviewInput({ action: 'CONFIRM', reason: 'ok', evidenceNote: long }).problems[0].code).toBe(
        'ALERT_REASON_REQUIRED',
      );
    });

    it('requires documented evidence to confirm', () => {
      const result = validateReviewInput({ action: 'CONFIRM', reason: long, evidenceNote: 'see photo' });
      expect(result.ok).toBe(false);
      expect(result.problems.map((problem) => problem.code)).toContain('ALERT_EVIDENCE_REQUIRED');
    });

    it('accepts a complete confirmation', () => {
      const result = validateReviewInput({
        action: 'CONFIRM',
        reason: long,
        evidenceNote: 'inspection INS-2026 confirms the harvested volume',
      });
      expect(result.ok).toBe(true);
      expect(result.problems).toEqual([]);
    });

    it('requires a resolution action to resolve', () => {
      const result = validateReviewInput({ action: 'RESOLVE', reason: long, resolutionAction: 'done' });
      expect(result.problems.map((problem) => problem.code)).toContain('ALERT_RESOLUTION_REQUIRED');
    });

    it('lets an officer acknowledge without writing anything', () => {
      expect(validateReviewInput({ action: 'ACKNOWLEDGE' }).ok).toBe(true);
    });

    it('allows linking a case only when confirming', () => {
      const link = '11111111-1111-4111-8111-111111111111';
      expect(validateReviewInput({ action: 'DISMISS', reason: long, violationId: link }).ok).toBe(false);
      expect(
        validateReviewInput({ action: 'CONFIRM', reason: long, evidenceNote: long, violationId: link }).ok,
      ).toBe(true);
    });

    it('reports every problem at once so the form can show them together', () => {
      const result = validateReviewInput({ action: 'CONFIRM', reason: 'x', evidenceNote: 'y' });
      expect(result.problems).toHaveLength(2);
    });
  });

  describe('isAlertOverdue', () => {
    const now = new Date('2026-06-10T12:00:00Z');

    it('is not overdue inside the SLA', () => {
      expect(isAlertOverdue({ status: AlertStatus.NEW, detectedAt: new Date('2026-06-09T12:00:00Z') }, now, 72)).toBe(false);
    });

    it('is overdue once the SLA has passed', () => {
      expect(isAlertOverdue({ status: AlertStatus.NEW, detectedAt: new Date('2026-06-06T12:00:00Z') }, now, 72)).toBe(true);
    });

    it('never counts a decision that was already taken', () => {
      expect(isAlertOverdue({ status: AlertStatus.CONFIRMED, detectedAt: new Date('2026-01-01T00:00:00Z') }, now, 72)).toBe(false);
      expect(isAlertOverdue({ status: AlertStatus.DISMISSED, detectedAt: new Date('2026-01-01T00:00:00Z') }, now, 72)).toBe(false);
    });

    it('counts an alert still being reviewed', () => {
      expect(isAlertOverdue({ status: AlertStatus.REVIEWING, detectedAt: new Date('2026-01-01T00:00:00Z') }, now, 72)).toBe(true);
    });
  });

  describe('alertPosition', () => {
    const now = new Date('2026-06-10T12:00:00Z');

    it('marks a new alert as awaiting a human decision', () => {
      const position = alertPosition(
        { status: AlertStatus.NEW, riskLevel: RiskLevel.HIGH, detectedAt: now, detector: 'LOCAL_RULE_ENGINE', confidence: 0.8 },
        now,
      );
      expect(position.requiresHumanDecision).toBe(true);
      expect(position.isClosed).toBe(false);
      expect(position.detectorLabel).toBe('FEMS rule engine');
    });

    it('makes it obvious that a Gemini-narrated alert is still a machine signal', () => {
      const position = alertPosition(
        { status: AlertStatus.NEW, riskLevel: RiskLevel.LOW, detectedAt: now, detector: 'GEMINI', confidence: 0.4 },
        now,
      );
      expect(position.detectorLabel).toContain('narrative only');
    });

    it('never marks a confirmed alert as still awaiting a decision', () => {
      const position = alertPosition(
        { status: AlertStatus.CONFIRMED, riskLevel: RiskLevel.CRITICAL, detectedAt: now, detector: 'LOCAL_RULE_ENGINE' },
        now,
      );
      expect(position.requiresHumanDecision).toBe(false);
      expect(position.riskScore).toBeGreaterThanOrEqual(75);
    });

    it('treats a dismissed or resolved alert as closed', () => {
      for (const status of [AlertStatus.DISMISSED, AlertStatus.RESOLVED]) {
        expect(alertPosition({ status, riskLevel: RiskLevel.LOW, detectedAt: now, detector: 'LOCAL_RULE_ENGINE' }, now).isClosed).toBe(true);
      }
    });
  });

  describe('availableAlertActions', () => {
    it('returns the transitions the caller can actually perform', () => {
      expect(availableAlertActions(AlertStatus.NEW, () => true)).toEqual(['ACKNOWLEDGE', 'CONFIRM', 'DISMISS']);
    });

    it('returns nothing when the caller cannot review alerts', () => {
      expect(availableAlertActions(AlertStatus.NEW, () => false)).toEqual([]);
    });

    it('only exposes reopening for a closed alert', () => {
      expect(availableAlertActions(AlertStatus.RESOLVED, () => true)).toEqual(['REOPEN']);
    });

    it('requires the review permission for every action', () => {
      for (const permissions of Object.values(ALERT_ACTION_PERMISSIONS)) {
        expect(permissions).toContain('ai:alerts_review');
      }
    });
  });

  describe('summariseAlerts', () => {
    const now = new Date('2026-06-10T12:00:00Z');
    const rows = [
      { status: AlertStatus.NEW, riskLevel: RiskLevel.HIGH, type: 'OVER_HARVESTING', detectedAt: new Date('2026-06-10T08:00:00Z') },
      { status: AlertStatus.NEW, riskLevel: RiskLevel.LOW, type: 'DOCUMENT_ANOMALY', detectedAt: new Date('2026-05-01T08:00:00Z') },
      { status: AlertStatus.CONFIRMED, riskLevel: RiskLevel.CRITICAL, type: 'PAYMENT_ANOMALY', detectedAt: new Date('2026-06-01T08:00:00Z') },
      { status: AlertStatus.DISMISSED, riskLevel: RiskLevel.MODERATE, type: 'OVER_HARVESTING', detectedAt: new Date('2026-06-02T08:00:00Z') },
    ];

    it('counts the workload', () => {
      const summary = summariseAlerts(rows, now, 72);
      expect(summary.total).toBe(4);
      expect(summary.awaitingReview).toBe(2);
      expect(summary.confirmed).toBe(1);
      expect(summary.dismissed).toBe(1);
    });

    it('flags the alerts that breached the review SLA', () => {
      expect(summariseAlerts(rows, now, 72).overdueReview).toBe(1);
    });

    it('groups by status, risk and type', () => {
      const summary = summariseAlerts(rows, now, 72);
      expect(summary.byStatus.find((entry) => entry.status === AlertStatus.NEW)?.count).toBe(2);
      expect(summary.byRisk.find((entry) => entry.riskLevel === RiskLevel.CRITICAL)?.count).toBe(1);
      expect(summary.byType.find((entry) => entry.type === 'OVER_HARVESTING')?.count).toBe(2);
    });

    it('handles an empty console', () => {
      const summary = summariseAlerts([], now, 72);
      expect(summary.total).toBe(0);
      expect(summary.byStatus).toEqual([]);
    });
  });
});
