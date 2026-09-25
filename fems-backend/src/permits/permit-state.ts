import { BadRequestException } from '@nestjs/common';
import { PermitStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators';
import { hasAnyPermission } from '../common/utils/access-scope.util';

/**
 * Permit lifecycle — the authoritative state machine.
 *
 * Every transition is described once, here. The service executes only what the
 * table allows, the API exposes exactly the actions the caller may perform
 * (`GET /permits/:id/actions`), and the unit tests assert the whole matrix —
 * so an invalid transition can never slip through a controller, and the mobile
 * app is never the only thing standing between a user and an illegal change of
 * state.
 */
export type PermitAction =
  | 'SUBMIT'
  | 'RESUBMIT'
  | 'START_REVIEW'
  | 'REQUEST_REVISION'
  | 'APPROVE'
  | 'REJECT'
  | 'MARK_PAYMENT_PENDING'
  | 'ACTIVATE'
  | 'SUSPEND'
  | 'REINSTATE'
  | 'EXPIRE'
  | 'REVOKE'
  | 'CANCEL'
  | 'RENEW';

export interface PermitTransitionSpec {
  action: PermitAction;
  label: string;
  /** Statuses the action may be applied from. */
  from: PermitStatus[];
  to: PermitStatus;
  /** Any one of these permissions is required (checked server-side). */
  permissions: string[];
  /** Restricts the action to the permit applicant (self-service actions). */
  applicantOnly?: boolean;
  /** Reason text is mandatory (rejection, suspension, revocation). */
  requiresReason?: boolean;
  /** Not reachable through the API — only the scheduler/system may perform it. */
  systemOnly?: boolean;
  /** Human explanation shown in the mobile app for the action button. */
  description: string;
}

export const PERMIT_TRANSITIONS: PermitTransitionSpec[] = [
  {
    action: 'SUBMIT',
    label: 'Submit for review',
    from: [PermitStatus.DRAFT],
    to: PermitStatus.SUBMITTED,
    permissions: ['permits:submit'],
    applicantOnly: true,
    description: 'Send the application to the forest administration for review.',
  },
  {
    action: 'START_REVIEW',
    label: 'Start review',
    from: [PermitStatus.SUBMITTED],
    to: PermitStatus.UNDER_REVIEW,
    permissions: ['permits:review'],
    description: 'Claim the application and begin the regulatory review.',
  },
  {
    action: 'REQUEST_REVISION',
    label: 'Request revision',
    from: [PermitStatus.UNDER_REVIEW],
    to: PermitStatus.REVISION_REQUIRED,
    permissions: ['permits:request_revision'],
    requiresReason: true,
    description: 'Return the application to the applicant with corrections to make.',
  },
  {
    action: 'RESUBMIT',
    label: 'Resubmit application',
    from: [PermitStatus.REVISION_REQUIRED],
    to: PermitStatus.SUBMITTED,
    permissions: ['permits:submit'],
    applicantOnly: true,
    description: 'Send the corrected application back to the administration.',
  },
  {
    action: 'APPROVE',
    label: 'Approve permit',
    from: [PermitStatus.UNDER_REVIEW],
    to: PermitStatus.APPROVED,
    permissions: ['permits:approve'],
    description: 'Approve the requested volume so the applicant can pay the fees.',
  },
  {
    action: 'REJECT',
    label: 'Reject application',
    from: [PermitStatus.UNDER_REVIEW],
    to: PermitStatus.REJECTED,
    permissions: ['permits:reject'],
    requiresReason: true,
    description: 'Refuse the application with a written justification.',
  },
  {
    action: 'MARK_PAYMENT_PENDING',
    label: 'Await payment',
    from: [PermitStatus.APPROVED],
    to: PermitStatus.PAYMENT_PENDING,
    permissions: ['payments:create', 'payments:initiate'],
    description: 'Recorded automatically when the fee payment is initiated.',
  },
  {
    action: 'ACTIVATE',
    label: 'Activate permit',
    from: [PermitStatus.PAYMENT_PENDING],
    to: PermitStatus.ACTIVE,
    permissions: ['payments:verify', 'permits:approve'],
    description: 'Start the exploitation period once the fees are settled.',
  },
  {
    action: 'SUSPEND',
    label: 'Suspend permit',
    from: [PermitStatus.ACTIVE],
    to: PermitStatus.SUSPENDED,
    permissions: ['permits:suspend'],
    requiresReason: true,
    description: 'Stop the exploitation temporarily (compliance or safety concern).',
  },
  {
    action: 'REINSTATE',
    label: 'Reinstate permit',
    from: [PermitStatus.SUSPENDED],
    to: PermitStatus.ACTIVE,
    permissions: ['permits:suspend'],
    description: 'Lift the suspension and allow the exploitation to resume.',
  },
  {
    action: 'EXPIRE',
    label: 'Expire permit',
    from: [PermitStatus.ACTIVE, PermitStatus.SUSPENDED],
    to: PermitStatus.EXPIRED,
    permissions: ['permits:suspend'],
    systemOnly: true,
    description: 'Recorded automatically when the permit end date is reached.',
  },
  {
    action: 'REVOKE',
    label: 'Revoke permit',
    from: [PermitStatus.ACTIVE, PermitStatus.SUSPENDED, PermitStatus.PAYMENT_PENDING],
    to: PermitStatus.REVOKED,
    permissions: ['permits:revoke'],
    requiresReason: true,
    description: 'Definitively withdraw the permit for a serious breach.',
  },
  {
    action: 'CANCEL',
    label: 'Cancel application',
    from: [PermitStatus.DRAFT, PermitStatus.SUBMITTED, PermitStatus.REVISION_REQUIRED],
    to: PermitStatus.CANCELLED,
    permissions: ['permits:cancel'],
    applicantOnly: true,
    description: 'Withdraw the application before a decision is taken.',
  },
  {
    action: 'RENEW',
    label: 'Request renewal',
    from: [PermitStatus.ACTIVE, PermitStatus.EXPIRED],
    to: PermitStatus.DRAFT,
    permissions: ['permits:renew'],
    description: 'Open a new application that continues this permit.',
  },
];

export function findTransition(action: PermitAction): PermitTransitionSpec {
  const spec = PERMIT_TRANSITIONS.find((transition) => transition.action === action);
  if (!spec) {
    throw new BadRequestException({
      code: 'PERMIT_ACTION_UNKNOWN',
      message: `Unknown permit action ${action}.`,
    });
  }
  return spec;
}

export function canTransition(from: PermitStatus, action: PermitAction): boolean {
  return findTransition(action).from.includes(from);
}

/** Throws a precise 400 when the current status does not allow the action. */
export function assertTransition(from: PermitStatus, action: PermitAction): PermitTransitionSpec {
  const spec = findTransition(action);
  if (!spec.from.includes(from)) {
    throw new BadRequestException({
      code: 'PERMIT_INVALID_TRANSITION',
      message: `A permit in status ${from} cannot be moved with "${spec.label}". Allowed from: ${spec.from.join(', ')}.`,
      details: { currentStatus: from, action, allowedFrom: spec.from },
    });
  }
  return spec;
}


/** The actions this user may perform on a permit in its current status. */
export function availableActions(
  user: AuthenticatedUser,
  permit: { status: PermitStatus; applicantId: string },
): PermitTransitionSpec[] {
  return PERMIT_TRANSITIONS.filter((spec) => {
    if (spec.systemOnly) return false;
    if (!spec.from.includes(permit.status)) return false;
    if (spec.applicantOnly && permit.applicantId !== user.id) return false;
    return hasAnyPermission(user, spec.permissions);
  });
}

/** Terminal statuses never move again. */
export const TERMINAL_PERMIT_STATUSES: PermitStatus[] = [
  PermitStatus.REJECTED,
  PermitStatus.REVOKED,
  PermitStatus.CANCELLED,
  PermitStatus.EXPIRED,
];

export const ACTIVE_PERMIT_STATUSES: PermitStatus[] = [PermitStatus.ACTIVE, PermitStatus.APPROVED, PermitStatus.PAYMENT_PENDING];
