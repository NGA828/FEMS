import { ViolationSeverity, ViolationStatus } from '@prisma/client';
import {
  ACTIVE_VIOLATION_STATUSES,
  REMEDIATION_DAYS_BY_SEVERITY,
  VIOLATION_ACTIONS,
  VIOLATION_TRANSITIONS,
  checkRemediationReported,
  checkResolvable,
  checkViolationTransition,
  computePenaltyStatus,
  isRemediationDueSoon,
  isRemediationOverdue,
  isViolationAction,
  isViolationOpen,
  recommendedRemediationDeadline,
} from './violation-state';

describe('violation-state', () => {
  describe('checkViolationTransition', () => {
    it('opens an investigation on a new case', () => {
      const result = checkViolationTransition('INVESTIGATE', ViolationStatus.OPEN);
      expect(result.ok).toBe(true);
      expect(result.transition?.to).toBe(ViolationStatus.UNDER_INVESTIGATION);
    });

    it('starts an investigation without a written justification', () => {
      expect(VIOLATION_TRANSITIONS.INVESTIGATE.requiresReason).toBe(false);
      expect(checkViolationTransition('INVESTIGATE', ViolationStatus.OPEN).ok).toBe(true);
    });

    it('confirms a case from OPEN or UNDER_INVESTIGATION', () => {
      expect(checkViolationTransition('CONFIRM', ViolationStatus.OPEN, 'Stumps measured').transition?.to).toBe(
        ViolationStatus.CONFIRMED,
      );
      expect(
        checkViolationTransition('CONFIRM', ViolationStatus.UNDER_INVESTIGATION, 'Company was heard').ok,
      ).toBe(true);
    });

    it('requires a written finding to confirm or dismiss', () => {
      expect(checkViolationTransition('CONFIRM', ViolationStatus.OPEN).code).toBe('REASON_REQUIRED');
      expect(checkViolationTransition('DISMISS', ViolationStatus.OPEN).code).toBe('REASON_REQUIRED');
    });

    it('never confirms a case that is already closed', () => {
      expect(checkViolationTransition('CONFIRM', ViolationStatus.RESOLVED, 'x').code).toBe('VIOLATION_INVALID_TRANSITION');
      expect(checkViolationTransition('CONFIRM', ViolationStatus.DISMISSED, 'x').code).toBe('VIOLATION_INVALID_TRANSITION');
    });

    it('escalates from OPEN, UNDER_INVESTIGATION or CONFIRMED', () => {
      for (const status of [ViolationStatus.OPEN, ViolationStatus.UNDER_INVESTIGATION, ViolationStatus.CONFIRMED]) {
        const result = checkViolationTransition('ESCALATE', status, 'Referred to the ministry');
        expect(result.ok).toBe(true);
        expect(result.transition?.to).toBe(ViolationStatus.ESCALATED);
      }
    });

    it('never escalates a dismissed case', () => {
      expect(checkViolationTransition('ESCALATE', ViolationStatus.DISMISSED, 'x').code).toBe('VIOLATION_INVALID_TRANSITION');
    });

    it('resolves only a confirmed or escalated case', () => {
      expect(checkViolationTransition('RESOLVE', ViolationStatus.CONFIRMED, 'Penalty paid').ok).toBe(true);
      expect(checkViolationTransition('RESOLVE', ViolationStatus.ESCALATED, 'Penalty paid').ok).toBe(true);
      expect(checkViolationTransition('RESOLVE', ViolationStatus.OPEN, 'Penalty paid').code).toBe('VIOLATION_INVALID_TRANSITION');
    });

    it('requires a justification to resolve', () => {
      expect(checkViolationTransition('RESOLVE', ViolationStatus.CONFIRMED).code).toBe('REASON_REQUIRED');
    });

    it('reopens a closed case with a justification', () => {
      expect(checkViolationTransition('REOPEN', ViolationStatus.DISMISSED, 'New drone imagery').transition?.to).toBe(
        ViolationStatus.UNDER_INVESTIGATION,
      );
      expect(checkViolationTransition('REOPEN', ViolationStatus.RESOLVED, 'New witness statement').ok).toBe(true);
      expect(checkViolationTransition('REOPEN', ViolationStatus.RESOLVED).code).toBe('REASON_REQUIRED');
      expect(checkViolationTransition('REOPEN', ViolationStatus.OPEN, 'x').code).toBe('VIOLATION_INVALID_TRANSITION');
    });

    it('rejects an unknown action with the list of supported actions', () => {
      const result = checkViolationTransition('PROSECUTE', ViolationStatus.OPEN, 'x');
      expect(result.code).toBe('VIOLATION_ACTION_UNKNOWN');
      expect(result.message).toContain('INVESTIGATE');
    });

    it('declares the permission every action needs', () => {
      for (const action of VIOLATION_ACTIONS) {
        expect(VIOLATION_TRANSITIONS[action].permissions.length).toBeGreaterThan(0);
      }
      expect(VIOLATION_TRANSITIONS.RESOLVE.permissions).toEqual(['environmental:resolve_violation']);
      expect(VIOLATION_TRANSITIONS.CONFIRM.permissions).toEqual(['environmental:manage_violations']);
    });

    it('isViolationAction accepts only the supported actions', () => {
      expect(isViolationAction('resolve')).toBe(true);
      expect(isViolationAction('delete')).toBe(false);
    });
  });

  describe('open cases', () => {
    it('counts OPEN, UNDER_INVESTIGATION, CONFIRMED and ESCALATED as active', () => {
      expect(ACTIVE_VIOLATION_STATUSES).toEqual([
        ViolationStatus.OPEN,
        ViolationStatus.UNDER_INVESTIGATION,
        ViolationStatus.CONFIRMED,
        ViolationStatus.ESCALATED,
      ]);
      for (const status of ACTIVE_VIOLATION_STATUSES) expect(isViolationOpen(status)).toBe(true);
    });

    it('treats resolved and dismissed cases as closed', () => {
      expect(isViolationOpen(ViolationStatus.RESOLVED)).toBe(false);
      expect(isViolationOpen(ViolationStatus.DISMISSED)).toBe(false);
    });
  });

  describe('remediation deadlines', () => {
    it('gives a shorter delay for a more serious case', () => {
      expect(REMEDIATION_DAYS_BY_SEVERITY.CRITICAL).toBeLessThan(REMEDIATION_DAYS_BY_SEVERITY.HIGH);
      expect(REMEDIATION_DAYS_BY_SEVERITY.HIGH).toBeLessThan(REMEDIATION_DAYS_BY_SEVERITY.MEDIUM);
      expect(REMEDIATION_DAYS_BY_SEVERITY.MEDIUM).toBeLessThan(REMEDIATION_DAYS_BY_SEVERITY.LOW);
    });

    it('derives the deadline from the severity', () => {
      const from = new Date('2026-01-01T00:00:00Z');
      const deadline = recommendedRemediationDeadline(ViolationSeverity.HIGH, from);
      expect(deadline.toISOString().slice(0, 10)).toBe('2026-01-31');
    });

    it('flags an open case past its deadline as overdue', () => {
      const violation = {
        remediationRequired: true,
        remediationDeadline: new Date('2026-01-01T00:00:00Z'),
        status: ViolationStatus.CONFIRMED,
      };
      expect(isRemediationOverdue(violation, new Date('2026-02-01T00:00:00Z'))).toBe(true);
      expect(isRemediationOverdue(violation, new Date('2025-12-01T00:00:00Z'))).toBe(false);
    });

    it('never flags a closed case as overdue', () => {
      expect(
        isRemediationOverdue(
          { remediationRequired: true, remediationDeadline: new Date('2026-01-01T00:00:00Z'), status: ViolationStatus.RESOLVED },
          new Date('2026-06-01T00:00:00Z'),
        ),
      ).toBe(false);
    });

    it('does not flag a case without remediation', () => {
      expect(
        isRemediationOverdue({ remediationRequired: false, remediationDeadline: null, status: ViolationStatus.OPEN }),
      ).toBe(false);
    });

    it('flags a deadline falling inside the reminder window', () => {
      const now = new Date('2026-01-01T00:00:00Z');
      expect(
        isRemediationDueSoon(
          { remediationRequired: true, remediationDeadline: new Date('2026-01-10T00:00:00Z'), status: ViolationStatus.CONFIRMED },
          14,
          now,
        ),
      ).toBe(true);
      expect(
        isRemediationDueSoon(
          { remediationRequired: true, remediationDeadline: new Date('2026-03-10T00:00:00Z'), status: ViolationStatus.CONFIRMED },
          14,
          now,
        ),
      ).toBe(false);
    });
  });

  describe('computePenaltyStatus', () => {
    it('reports the outstanding amount', () => {
      const status = computePenaltyStatus(900_000, 400_000);
      expect(status.outstandingXAF).toBe(500_000);
      expect(status.settled).toBe(false);
    });

    it('is settled when the penalty was fully collected', () => {
      const status = computePenaltyStatus(900_000, 900_000);
      expect(status.outstandingXAF).toBe(0);
      expect(status.settled).toBe(true);
    });

    it('has nothing to collect when no penalty was set', () => {
      expect(computePenaltyStatus(null, 0)).toMatchObject({ penaltyAmountXAF: 0, outstandingXAF: 0, settled: true });
    });

    it('never reports a negative outstanding amount when the case was overpaid', () => {
      expect(computePenaltyStatus(100_000, 150_000).outstandingXAF).toBe(0);
    });
  });

  describe('checkResolvable', () => {
    it('allows resolving a case whose penalty was collected', () => {
      const result = checkResolvable(computePenaltyStatus(900_000, 900_000), {});
      expect(result.ok).toBe(true);
    });

    it('refuses to resolve a case with an unpaid penalty', () => {
      const result = checkResolvable(computePenaltyStatus(900_000, 0), { reason: 'Company promised to pay' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('PENALTY_OUTSTANDING');
      expect(result.outstandingXAF).toBe(900_000);
    });

    it('allows an explicit waiver with a written justification', () => {
      const result = checkResolvable(computePenaltyStatus(900_000, 0), {
        waivePenalty: true,
        reason: 'Penalty waived: the company reported the damage itself and restored the site.',
      });
      expect(result.ok).toBe(true);
    });

    it('refuses a waiver without a justification', () => {
      expect(checkResolvable(computePenaltyStatus(900_000, 0), { waivePenalty: true }).code).toBe(
        'PENALTY_WAIVER_REASON_REQUIRED',
      );
      expect(checkResolvable(computePenaltyStatus(900_000, 0), { waivePenalty: true, reason: 'ok' }).code).toBe(
        'PENALTY_WAIVER_REASON_REQUIRED',
      );
    });
  });

  describe('checkRemediationReported', () => {
    it('requires a remediation report when remediation was ordered', () => {
      const result = checkRemediationReported({ remediationRequired: true, remediationNotes: null });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('REMEDIATION_REPORT_REQUIRED');
    });

    it('accepts a case with remediation notes', () => {
      expect(checkRemediationReported({ remediationRequired: true, remediationNotes: 'Gap replanted in April.' }).ok).toBe(true);
    });

    it('accepts a case without remediation obligations', () => {
      expect(checkRemediationReported({ remediationRequired: false, remediationNotes: null }).ok).toBe(true);
    });
  });
});
