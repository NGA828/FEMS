import type { PermitAction } from './permit-state';

/**
 * Actions accepted by `POST /permits/:id/actions/:action`.
 *
 * Kept as a plain constant so both the controller (Swagger enum) and the
 * Swagger plugin can reference it without importing the state machine.
 */
export const PERMIT_ACTIONS: PermitAction[] = [
  'SUBMIT',
  'RESUBMIT',
  'START_REVIEW',
  'REQUEST_REVISION',
  'APPROVE',
  'REJECT',
  'ACTIVATE',
  'SUSPEND',
  'REINSTATE',
  'REVOKE',
  'CANCEL',
];
