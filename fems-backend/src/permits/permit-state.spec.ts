import { PermitStatus } from '@prisma/client';
import {
  ACTIVE_PERMIT_STATUSES,
  PERMIT_TRANSITIONS,
  TERMINAL_PERMIT_STATUSES,
  assertTransition,
  availableActions,
  canTransition,
} from './permit-state';
import type { AuthenticatedUser } from '../common/decorators';

const applicant: AuthenticatedUser = {
  id: 'applicant-1',
  email: 'applicant@fems.cm',
  firstName: 'App',
  lastName: 'Licant',
  roles: ['COMPANY_REPRESENTATIVE'],
  permissions: ['permits:read_own', 'permits:create', 'permits:update', 'permits:submit', 'permits:cancel'],
  companyId: 'company-1',
  status: 'ACTIVE',
};

const officer: AuthenticatedUser = {
  id: 'officer-1',
  email: 'officer@fems.cm',
  firstName: 'Of',
  lastName: 'Ficer',
  roles: ['GOVERNMENT_FOREST_OFFICER'],
  permissions: [
    'permits:read',
    'permits:review',
    'permits:approve',
    'permits:reject',
    'permits:request_revision',
    'permits:suspend',
    'permits:revoke',
    'payments:verify',
  ],
  companyId: null,
  status: 'ACTIVE',
};

describe('permit state machine', () => {
  it('defines a complete, non-overlapping transition table', () => {
    const actions = PERMIT_TRANSITIONS.map((transition) => transition.action);
    expect(new Set(actions).size).toBe(actions.length);
    for (const transition of PERMIT_TRANSITIONS) {
      expect(transition.from.length).toBeGreaterThan(0);
      expect(transition.permissions.length).toBeGreaterThan(0);
      expect(transition.from).not.toContain(transition.to);
      expect(transition.description.length).toBeGreaterThan(10);
    }
  });

  it('never allows a transition out of a terminal status (except renewal)', () => {
    for (const status of TERMINAL_PERMIT_STATUSES) {
      const allowed = PERMIT_TRANSITIONS.filter((transition) => transition.from.includes(status));
      const unexpected = allowed.filter((transition) => transition.action !== 'RENEW');
      expect(unexpected).toEqual([]);
    }
  });

  it('rejects invalid transitions with a specific error code', () => {
    expect(() => assertTransition(PermitStatus.DRAFT, 'APPROVE')).toThrow(
      /cannot be moved/,
    );
    try {
      assertTransition(PermitStatus.DRAFT, 'APPROVE');
    } catch (error) {
      const response = (error as { getResponse?: () => unknown }).getResponse?.() as {
        code: string;
        details: { currentStatus: string; allowedFrom: string[] };
      };
      expect(response.code).toBe('PERMIT_INVALID_TRANSITION');
      expect(response.details.currentStatus).toBe(PermitStatus.DRAFT);
      expect(response.details.allowedFrom).toEqual([PermitStatus.UNDER_REVIEW]);
    }
  });

  it('walks the happy path draft → submitted → review → approved → payment → active', () => {
    let status: PermitStatus = PermitStatus.DRAFT;
    const steps: Array<[string, PermitStatus]> = [
      ['SUBMIT', PermitStatus.SUBMITTED],
      ['START_REVIEW', PermitStatus.UNDER_REVIEW],
      ['APPROVE', PermitStatus.APPROVED],
      ['MARK_PAYMENT_PENDING', PermitStatus.PAYMENT_PENDING],
      ['ACTIVATE', PermitStatus.ACTIVE],
    ];
    for (const [action, expected] of steps) {
      expect(canTransition(status, action as never)).toBe(true);
      status = assertTransition(status, action as never).to;
      expect(status).toBe(expected);
    }
    expect(ACTIVE_PERMIT_STATUSES).toContain(status);
  });

  it('supports revision loops and suspension round-trips', () => {
    expect(assertTransition(PermitStatus.UNDER_REVIEW, 'REQUEST_REVISION').to).toBe(PermitStatus.REVISION_REQUIRED);
    expect(assertTransition(PermitStatus.REVISION_REQUIRED, 'RESUBMIT').to).toBe(PermitStatus.SUBMITTED);
    expect(assertTransition(PermitStatus.ACTIVE, 'SUSPEND').to).toBe(PermitStatus.SUSPENDED);
    expect(assertTransition(PermitStatus.SUSPENDED, 'REINSTATE').to).toBe(PermitStatus.ACTIVE);
    expect(assertTransition(PermitStatus.SUSPENDED, 'EXPIRE').to).toBe(PermitStatus.EXPIRED);
  });

  it('marks the transitions that require a written justification', () => {
    const withReason = PERMIT_TRANSITIONS.filter((transition) => transition.requiresReason).map(
      (transition) => transition.action,
    );
    expect(withReason.sort()).toEqual(['REJECT', 'REQUEST_REVISION', 'REVOKE', 'SUSPEND']);
  });

  it('lists only the actions the caller may actually perform', () => {
    const draft = { status: PermitStatus.DRAFT, applicantId: applicant.id };
    const applicantActions = availableActions(applicant, draft).map((action) => action.action);
    expect(applicantActions).toEqual(['SUBMIT', 'CANCEL']);

    const officerOnDraft = availableActions(officer, draft).map((action) => action.action);
    expect(officerOnDraft).toEqual([]);

    const submitted = { status: PermitStatus.SUBMITTED, applicantId: applicant.id };
    expect(availableActions(officer, submitted).map((action) => action.action)).toEqual(['START_REVIEW']);
    expect(availableActions(applicant, submitted).map((action) => action.action)).toEqual(['CANCEL']);
  });

  it('keeps applicant-only actions away from other members of the same company', () => {
    const other: AuthenticatedUser = { ...applicant, id: 'colleague-2' };
    const draft = { status: PermitStatus.DRAFT, applicantId: applicant.id };
    expect(availableActions(other, draft).map((action) => action.action)).toEqual([]);
  });

  it('never exposes system-only transitions through the API', () => {
    const systemOnly = PERMIT_TRANSITIONS.filter((transition) => transition.systemOnly).map(
      (transition) => transition.action,
    );
    expect(systemOnly).toEqual(['EXPIRE']);
    const active = { status: PermitStatus.ACTIVE, applicantId: applicant.id };
    const admin: AuthenticatedUser = { ...officer, permissions: ['*'] };
    expect(availableActions(admin, active).map((action) => action.action)).not.toContain('EXPIRE');
  });
});
