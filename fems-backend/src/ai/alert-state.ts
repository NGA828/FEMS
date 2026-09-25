import { AlertStatus, RiskLevel } from '@prisma/client';

/**
 * AI alert review lifecycle.
 *
 * FEMS never lets an algorithm decide that an organisation or a person is
 * breaking the law. The detectors only raise a **signal** with a risk level and
 * the arithmetic behind it; the alert then follows this table, and every step
 * that has a regulatory meaning is taken by a named officer who leaves a reason.
 */

export type AlertAction = 'ACKNOWLEDGE' | 'CONFIRM' | 'DISMISS' | 'RESOLVE' | 'REOPEN';

export const ALERT_ACTIONS: AlertAction[] = ['ACKNOWLEDGE', 'CONFIRM', 'DISMISS', 'RESOLVE', 'REOPEN'];

/** Transitions allowed by the business rules (anything else is rejected). */
export const ALERT_TRANSITIONS: Record<AlertStatus, Partial<Record<AlertAction, AlertStatus>>> = {
  [AlertStatus.NEW]: {
    ACKNOWLEDGE: AlertStatus.REVIEWING,
    CONFIRM: AlertStatus.CONFIRMED,
    DISMISS: AlertStatus.DISMISSED,
  },
  [AlertStatus.REVIEWING]: {
    CONFIRM: AlertStatus.CONFIRMED,
    DISMISS: AlertStatus.DISMISSED,
  },
  [AlertStatus.CONFIRMED]: {
    RESOLVE: AlertStatus.RESOLVED,
  },
  [AlertStatus.DISMISSED]: {
    REOPEN: AlertStatus.REVIEWING,
  },
  [AlertStatus.RESOLVED]: {
    REOPEN: AlertStatus.REVIEWING,
  },
};

/** Permission required for each review action — checked before the transition. */
export const ALERT_ACTION_PERMISSIONS: Record<AlertAction, string[]> = {
  ACKNOWLEDGE: ['ai:alerts_review'],
  CONFIRM: ['ai:alerts_review'],
  DISMISS: ['ai:alerts_review'],
  RESOLVE: ['ai:alerts_review'],
  REOPEN: ['ai:alerts_review'],
};

/** Actions that carry a regulatory consequence and therefore need a written reason. */
export const ALERT_ACTION_REASONS_REQUIRED: AlertAction[] = ['CONFIRM', 'DISMISS', 'RESOLVE', 'REOPEN'];

/** Minimum length of a review reason, so "ok" cannot close a case. */
export const ALERT_REASON_MIN_LENGTH = 10;

/** Technical detector values that must never be presented as a human decision. */
export const ALERT_DETECTORS = ['LOCAL_RULE_ENGINE', 'GEMINI'] as const;

/** Risk ordering, used for sorting and for deciding whether to notify. */
export const RISK_ORDER: Record<RiskLevel, number> = {
  [RiskLevel.LOW]: 0,
  [RiskLevel.MODERATE]: 1,
  [RiskLevel.HIGH]: 2,
  [RiskLevel.CRITICAL]: 3,
};

export function compareRisk(a: RiskLevel, b: RiskLevel): number {
  return RISK_ORDER[a] - RISK_ORDER[b];
}

export interface TransitionCheck {
  allowed: boolean;
  from: AlertStatus;
  to: AlertStatus | null;
  code: string;
  message: string;
}

/** Pure state-machine check — the caller maps a rejection to HTTP 400. */
export function checkAlertTransition(current: AlertStatus, action: AlertAction): TransitionCheck {
  const table = ALERT_TRANSITIONS[current];
  const next = table?.[action];
  if (!next) {
    const allowed = Object.keys(table ?? {});
    return {
      allowed: false,
      from: current,
      to: null,
      code: 'ALERT_INVALID_TRANSITION',
      message: allowed.length
        ? `An alert in status ${current} cannot be ${action.toLowerCase()}d. Allowed action(s): ${allowed.join(', ')}.`
        : `An alert in status ${current} is closed; it can only be reopened.`,
    };
  }
  return {
    allowed: true,
    from: current,
    to: next,
    code: 'ALERT_TRANSITION_OK',
    message: `${current} → ${next} through ${action}.`,
  };
}

export interface ReviewInput {
  action: AlertAction;
  reason?: string | null;
  resolutionAction?: string | null;
  evidenceNote?: string | null;
  violationId?: string | null;
}

export interface ReviewValidation {
  ok: boolean;
  problems: Array<{ field: string; code: string; message: string }>;
}

/**
 * Field-level validation of a review payload, independent of the database, so
 * it can be unit-tested and reused by the mobile form.
 */
export function validateReviewInput(input: ReviewInput): ReviewValidation {
  const problems: ReviewValidation['problems'] = [];
  const reason = (input.reason ?? '').trim();

  if (ALERT_ACTION_REASONS_REQUIRED.includes(input.action) && reason.length < ALERT_REASON_MIN_LENGTH) {
    problems.push({
      field: 'reason',
      code: 'ALERT_REASON_REQUIRED',
      message: `A written reason of at least ${ALERT_REASON_MIN_LENGTH} characters is required to ${input.action.toLowerCase()} an alert.`,
    });
  }

  if (input.action === 'RESOLVE' && (input.resolutionAction ?? '').trim().length < ALERT_REASON_MIN_LENGTH) {
    problems.push({
      field: 'resolutionAction',
      code: 'ALERT_RESOLUTION_REQUIRED',
      message: 'Describe what was actually done before resolving the alert.',
    });
  }

  if (input.action === 'CONFIRM' && (input.evidenceNote ?? '').trim().length < ALERT_REASON_MIN_LENGTH) {
    problems.push({
      field: 'evidenceNote',
      code: 'ALERT_EVIDENCE_REQUIRED',
      message:
        'Confirming an alert means an officer vouches for it: record the documented evidence that supports it.',
    });
  }

  if (input.violationId && input.action !== 'CONFIRM') {
    problems.push({
      field: 'violationId',
      code: 'ALERT_VIOLATION_LINK_ONLY_ON_CONFIRM',
      message: 'Only a confirmed alert can be linked to an environmental case.',
    });
  }

  return { ok: problems.length === 0, problems };
}

/** An alert awaiting a human decision for longer than the SLA. */
export function isAlertOverdue(
  alert: { status: AlertStatus; detectedAt: Date },
  now = new Date(),
  slaHours = 72,
): boolean {
  if (alert.status !== AlertStatus.NEW && alert.status !== AlertStatus.REVIEWING) return false;
  const deadline = new Date(alert.detectedAt.getTime() + slaHours * 3_600_000);
  return now > deadline;
}

/** Presentational flags derived from the row — computed server-side only. */
export interface AlertPosition {
  requiresHumanDecision: boolean;
  overdue: boolean;
  isClosed: boolean;
  detectorLabel: string;
  riskScore: number;
}

export function alertPosition(
  alert: { status: AlertStatus; riskLevel: RiskLevel; detectedAt: Date; detector: string; confidence?: unknown },
  now = new Date(),
  slaHours = 72,
): AlertPosition {
  const confidence = alert.confidence === null || alert.confidence === undefined ? null : Number(alert.confidence);
  return {
    requiresHumanDecision: alert.status !== AlertStatus.CONFIRMED && alert.status !== AlertStatus.DISMISSED,
    overdue: isAlertOverdue(alert as { status: AlertStatus; detectedAt: Date }, now, slaHours),
    isClosed: alert.status === AlertStatus.RESOLVED || alert.status === AlertStatus.DISMISSED,
    detectorLabel: alert.detector === 'GEMINI' ? 'Gemini (narrative only)' : 'FEMS rule engine',
    riskScore: RISK_ORDER[alert.riskLevel] * 25 + Math.round((confidence ?? 0) * 25),
  };
}

/** Actions available to a caller for a given alert, filtered by permission. */
export function availableAlertActions(
  current: AlertStatus,
  hasPermission: (permission: string) => boolean,
): AlertAction[] {
  const table = ALERT_TRANSITIONS[current] ?? {};
  return (Object.keys(table) as AlertAction[]).filter((action) =>
    ALERT_ACTION_PERMISSIONS[action].every((permission) => hasPermission(permission)),
  );
}

export interface AlertStatistics {
  total: number;
  awaitingReview: number;
  overdueReview: number;
  confirmed: number;
  dismissed: number;
  resolved: number;
  byStatus: Array<{ status: AlertStatus; count: number }>;
  byRisk: Array<{ riskLevel: RiskLevel; count: number }>;
  byType: Array<{ type: string; count: number }>;
}

/** Deterministic aggregate used by the alert console header. */
export function summariseAlerts(
  rows: Array<{ status: AlertStatus; riskLevel: RiskLevel; type: string; detectedAt: Date }>,
  now = new Date(),
  slaHours = 72,
): AlertStatistics {
  const bump = <T extends string>(map: Map<T, number>, key: T) => map.set(key, (map.get(key) ?? 0) + 1);
  const byStatus = new Map<AlertStatus, number>();
  const byRisk = new Map<RiskLevel, number>();
  const byType = new Map<string, number>();
  let overdueReview = 0;

  for (const row of rows) {
    bump(byStatus, row.status);
    bump(byRisk, row.riskLevel);
    bump(byType, row.type as string);
    if (isAlertOverdue(row, now, slaHours)) overdueReview += 1;
  }

  return {
    total: rows.length,
    awaitingReview: rows.filter((row) => row.status === AlertStatus.NEW).length,
    overdueReview,
    confirmed: byStatus.get(AlertStatus.CONFIRMED) ?? 0,
    dismissed: byStatus.get(AlertStatus.DISMISSED) ?? 0,
    resolved: byStatus.get(AlertStatus.RESOLVED) ?? 0,
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
    byRisk: [...byRisk.entries()].map(([riskLevel, count]) => ({ riskLevel, count })),
    byType: [...byType.entries()].map(([type, count]) => ({ type, count })),
  };
}
