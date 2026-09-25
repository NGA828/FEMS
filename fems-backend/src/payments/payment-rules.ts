import { PaymentMethod, PaymentStatus } from '@prisma/client';

/**
 * Pure payment rules.
 *
 * Kept free of NestJS/Prisma dependencies so they can be unit-tested directly
 * and reused by any caller (mobile-sync, webhooks, admin console) without
 * duplicating the business logic.
 */

export const MOBILE_MONEY_METHODS: PaymentMethod[] = [
  PaymentMethod.MOBILE_MONEY_MTN,
  PaymentMethod.MOBILE_MONEY_ORANGE,
  PaymentMethod.MOBILE_MONEY_AIRTEL,
];

export function requiresPayerPhone(method: PaymentMethod): boolean {
  return MOBILE_MONEY_METHODS.includes(method);
}

export interface RuleResult {
  ok: boolean;
  code?: string;
  message?: string;
}

/** A payment may never exceed what is still owed on the permit. */
export function checkPayableAmount(amount: number, outstandingBalance: number): RuleResult {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, code: 'PAYMENT_AMOUNT_INVALID', message: 'The payment amount must be greater than zero.' };
  }
  if (outstandingBalance <= 0) {
    return { ok: false, code: 'PERMIT_FULLY_PAID', message: 'This permit has no outstanding balance.' };
  }
  if (amount > outstandingBalance) {
    return {
      ok: false,
      code: 'PAYMENT_EXCEEDS_OUTSTANDING_BALANCE',
      message: `The outstanding balance is ${outstandingBalance} XAF; ${amount} XAF would overpay it.`,
    };
  }
  return { ok: true };
}

/** Only an unsettled payment can be moved by a provider answer. */
export function isProviderSettleable(status: PaymentStatus): boolean {
  return status === PaymentStatus.PENDING || status === PaymentStatus.PROCESSING;
}

export function canRefund(status: PaymentStatus): boolean {
  return status === PaymentStatus.SUCCESSFUL;
}

export interface ProviderOutcome {
  status: 'PENDING' | 'PROCESSING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
  reason?: string;
}

/**
 * Maps a provider answer onto FEMS' payment status. A provider can never move a
 * payment backwards, and an unknown answer leaves the payment untouched
 * (`PROCESSING` at most).
 */
export function nextStatusForProviderOutcome(current: PaymentStatus, outcome: ProviderOutcome): PaymentStatus {
  if (current === PaymentStatus.SUCCESSFUL || current === PaymentStatus.REFUNDED) return current;
  switch (outcome.status) {
    case 'SUCCESSFUL':
      return PaymentStatus.SUCCESSFUL;
    case 'FAILED':
      return PaymentStatus.FAILED;
    case 'CANCELLED':
      return PaymentStatus.CANCELLED;
    case 'PENDING':
      return PaymentStatus.PENDING;
    default:
      return PaymentStatus.PROCESSING;
  }
}

/** Outstanding amount given the permit fee and everything already collected. */
export function computeOutstanding(feeAmount: number, collectedAmount: number): number {
  const fee = Number.isFinite(feeAmount) ? feeAmount : 0;
  const collected = Number.isFinite(collectedAmount) ? collectedAmount : 0;
  return Math.max(0, Math.round((fee - collected) * 100) / 100);
}
