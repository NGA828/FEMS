import { ViolationSeverity, ViolationStatus } from '@prisma/client';

/**
 * Pure violation lifecycle + penalty rules.
 *
 * A violation is a *human* regulatory finding: it is always raised from field
 * evidence (an inspection or an observation) by an officer, investigated, and
 * either confirmed or dismissed. FEMS never opens a violation from an automated
 * signal, and an AI alert can only ever be *linked* to a violation that a person
 * already decided to open.
 */

export const VIOLATION_ACTIONS = ['INVESTIGATE', 'CONFIRM', 'DISMISS', 'ESCALATE', 'RESOLVE', 'REOPEN'] as const;
export type ViolationAction = (typeof VIOLATION_ACTIONS)[number];

export interface ViolationTransition {
  action: ViolationAction;
  label: string;
  from: ViolationStatus[];
  to: ViolationStatus;
  /** One of these permissions is required (checked server-side). */
  permissions: string[];
  requiresReason: boolean;
  description: string;
}

export const VIOLATION_TRANSITIONS: Record<ViolationAction, ViolationTransition> = {
  INVESTIGATE: {
    action: 'INVESTIGATE',
    label: 'Open an investigation',
    from: [ViolationStatus.OPEN],
    to: ViolationStatus.UNDER_INVESTIGATION,
    permissions: ['environmental:manage_violations'],
    requiresReason: false,
    description: 'Assign the case for field verification before any finding is made.',
  },
  CONFIRM: {
    action: 'CONFIRM',
    label: 'Confirm the violation',
    from: [ViolationStatus.OPEN, ViolationStatus.UNDER_INVESTIGATION],
    to: ViolationStatus.CONFIRMED,
    permissions: ['environmental:manage_violations'],
    requiresReason: true,
    description: 'Record the regulatory finding, the assessed damage and any penalty.',
  },
  DISMISS: {
    action: 'DISMISS',
    label: 'Dismiss the violation',
    from: [ViolationStatus.OPEN, ViolationStatus.UNDER_INVESTIGATION],
    to: ViolationStatus.DISMISSED,
    permissions: ['environmental:manage_violations'],
    requiresReason: true,
    description: 'Close the case as unfounded; the reason is stored in the audit trail.',
  },
  ESCALATE: {
    action: 'ESCALATE',
    label: 'Escalate the case',
    from: [ViolationStatus.OPEN, ViolationStatus.UNDER_INVESTIGATION, ViolationStatus.CONFIRMED],
    to: ViolationStatus.ESCALATED,
    permissions: ['environmental:manage_violations'],
    requiresReason: true,
    description: 'Hand the case to the hierarchy (prosecution, ministry, judicial follow-up).',
  },
  RESOLVE: {
    action: 'RESOLVE',
    label: 'Resolve the violation',
    from: [ViolationStatus.CONFIRMED, ViolationStatus.ESCALATED],
    to: ViolationStatus.RESOLVED,
    permissions: ['environmental:resolve_violation'],
    requiresReason: true,
    description: 'Close a confirmed case once the penalty is settled and remediation is agreed.',
  },
  REOPEN: {
    action: 'REOPEN',
    label: 'Reopen the case',
    from: [ViolationStatus.DISMISSED, ViolationStatus.RESOLVED],
    to: ViolationStatus.UNDER_INVESTIGATION,
    permissions: ['environmental:manage_violations'],
    requiresReason: true,
    description: 'Reopen a closed case when new evidence appears.',
  },
};

export interface TransitionCheck {
  ok: boolean;
  code?: 'VIOLATION_ACTION_UNKNOWN' | 'VIOLATION_INVALID_TRANSITION' | 'REASON_REQUIRED' | 'VIOLATION_ACTION_FORBIDDEN';
  message?: string;
  transition?: ViolationTransition;
}

export function isViolationAction(value: string): value is ViolationAction {
  return (VIOLATION_ACTIONS as readonly string[]).includes(value.toUpperCase());
}

export function checkViolationTransition(
  action: string,
  currentStatus: ViolationStatus,
  reason?: string | null,
): TransitionCheck {
  const normalised = action.toUpperCase();
  if (!isViolationAction(normalised)) {
    return {
      ok: false,
      code: 'VIOLATION_ACTION_UNKNOWN',
      message: `Unknown violation action ${action}. Expected one of: ${VIOLATION_ACTIONS.join(', ')}.`,
    };
  }
  const transition = VIOLATION_TRANSITIONS[normalised];
  if (!transition.from.includes(currentStatus)) {
    return {
      ok: false,
      code: 'VIOLATION_INVALID_TRANSITION',
      message: `A violation in status ${currentStatus} cannot be ${normalised.toLowerCase()}d.`,
    };
  }
  if (transition.requiresReason && !reason) {
    return {
      ok: false,
      code: 'REASON_REQUIRED',
      message: `A justification is required to ${normalised.toLowerCase()} a violation.`,
    };
  }
  return { ok: true, transition };
}

/** A case still being worked on — used to block closing an inspection too early. */
export const ACTIVE_VIOLATION_STATUSES: ViolationStatus[] = [
  ViolationStatus.OPEN,
  ViolationStatus.UNDER_INVESTIGATION,
  ViolationStatus.CONFIRMED,
  ViolationStatus.ESCALATED,
];

export function isViolationOpen(status: ViolationStatus): boolean {
  return ACTIVE_VIOLATION_STATUSES.includes(status);
}

/** Remediation delay allowed per severity, in days. */
export const REMEDIATION_DAYS_BY_SEVERITY: Record<ViolationSeverity, number> = {
  LOW: 90,
  MEDIUM: 60,
  HIGH: 30,
  CRITICAL: 7,
};

export function recommendedRemediationDeadline(severity: ViolationSeverity, from = new Date()): Date {
  const days = REMEDIATION_DAYS_BY_SEVERITY[severity] ?? 90;
  return new Date(from.getTime() + days * 86_400_000);
}

export function isRemediationOverdue(
  violation: { remediationRequired: boolean; remediationDeadline: Date | null; status: ViolationStatus },
  now = new Date(),
): boolean {
  if (!violation.remediationRequired || !violation.remediationDeadline) return false;
  if (!isViolationOpen(violation.status)) return false;
  return violation.remediationDeadline.getTime() < now.getTime();
}

export function isRemediationDueSoon(
  violation: { remediationRequired: boolean; remediationDeadline: Date | null; status: ViolationStatus },
  withinDays = 14,
  now = new Date(),
): boolean {
  if (!violation.remediationRequired || !violation.remediationDeadline) return false;
  if (!isViolationOpen(violation.status)) return false;
  const limit = now.getTime() + withinDays * 86_400_000;
  return violation.remediationDeadline.getTime() >= now.getTime() && violation.remediationDeadline.getTime() <= limit;
}

export interface PenaltyStatus {
  penaltyAmountXAF: number;
  paidXAF: number;
  outstandingXAF: number;
  settled: boolean;
}

/** Penalty position of a case: what was fined, what the provider actually settled. */
export function computePenaltyStatus(penaltyAmountXAF: number | null, paidXAF: number): PenaltyStatus {
  const penalty = Number.isFinite(Number(penaltyAmountXAF)) ? Number(penaltyAmountXAF) : 0;
  const paid = Number.isFinite(Number(paidXAF)) ? Number(paidXAF) : 0;
  const outstanding = Math.max(0, Math.round((penalty - paid) * 100) / 100);
  return { penaltyAmountXAF: penalty, paidXAF: paid, outstandingXAF: outstanding, settled: outstanding === 0 };
}

export interface ResolveCheck {
  ok: boolean;
  code?: 'PENALTY_OUTSTANDING' | 'PENALTY_WAIVER_REASON_REQUIRED';
  message?: string;
  outstandingXAF: number;
}

/**
 * A confirmed case carrying an unpaid penalty cannot be resolved — the money has
 * to reach the treasury first, unless a regulator explicitly waives it with a
 * written justification (which is recorded in the audit trail).
 */
export function checkResolvable(
  penalty: PenaltyStatus,
  options: { waivePenalty?: boolean; reason?: string | null },
): ResolveCheck {
  if (penalty.settled) return { ok: true, outstandingXAF: 0 };
  if (!options.waivePenalty) {
    return {
      ok: false,
      code: 'PENALTY_OUTSTANDING',
      message: `${penalty.outstandingXAF} XAF of the ${penalty.penaltyAmountXAF} XAF penalty is still unpaid. Register the PENALTY payment first, or waive it with a written justification.`,
      outstandingXAF: penalty.outstandingXAF,
    };
  }
  if (!options.reason || options.reason.trim().length < 10) {
    return {
      ok: false,
      code: 'PENALTY_WAIVER_REASON_REQUIRED',
      message: 'Waiving a penalty requires a written justification of at least 10 characters.',
      outstandingXAF: penalty.outstandingXAF,
    };
  }
  return { ok: true, outstandingXAF: penalty.outstandingXAF };
}

/** Resolving a case that ordered remediation requires the remediation notes. */
export function checkRemediationReported(violation: {
  remediationRequired: boolean;
  remediationNotes: string | null;
}): { ok: boolean; code?: 'REMEDIATION_REPORT_REQUIRED'; message?: string } {
  if (!violation.remediationRequired || violation.remediationNotes) return { ok: true };
  return {
    ok: false,
    code: 'REMEDIATION_REPORT_REQUIRED',
    message: 'This case ordered remediation: describe what was done (or what was not) before resolving it.',
  };
}
