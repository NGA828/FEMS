import { PaymentMethod, PaymentStatus } from '@prisma/client';
import {
  MOBILE_MONEY_METHODS,
  canRefund,
  checkPayableAmount,
  computeOutstanding,
  isProviderSettleable,
  nextStatusForProviderOutcome,
  requiresPayerPhone,
} from './payment-rules';

describe('payment-rules', () => {
  describe('payer phone requirement', () => {
    it('requires a phone number for every mobile-money method', () => {
      for (const method of MOBILE_MONEY_METHODS) {
        expect(requiresPayerPhone(method)).toBe(true);
      }
    });

    it('does not require a phone number for card, transfer or cash', () => {
      expect(requiresPayerPhone(PaymentMethod.CARD)).toBe(false);
      expect(requiresPayerPhone(PaymentMethod.BANK_TRANSFER)).toBe(false);
      expect(requiresPayerPhone(PaymentMethod.CASH)).toBe(false);
    });
  });

  describe('checkPayableAmount', () => {
    it('accepts a partial payment below the outstanding balance', () => {
      expect(checkPayableAmount(150_000, 300_000).ok).toBe(true);
    });

    it('accepts a payment equal to the outstanding balance', () => {
      expect(checkPayableAmount(300_000, 300_000).ok).toBe(true);
    });

    it('rejects an overpayment and states the balance', () => {
      const result = checkPayableAmount(400_000, 300_000);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('PAYMENT_EXCEEDS_OUTSTANDING_BALANCE');
      expect(result.message).toContain('300000');
    });

    it('rejects a balance that is already settled', () => {
      expect(checkPayableAmount(10_000, 0).code).toBe('PERMIT_FULLY_PAID');
    });

    it('rejects a non-positive amount', () => {
      expect(checkPayableAmount(0, 300_000).code).toBe('PAYMENT_AMOUNT_INVALID');
      expect(checkPayableAmount(-5, 300_000).code).toBe('PAYMENT_AMOUNT_INVALID');
      expect(checkPayableAmount(Number.NaN, 300_000).code).toBe('PAYMENT_AMOUNT_INVALID');
    });
  });

  describe('provider answers', () => {
    it('only lets an unsettled payment be settled by a provider', () => {
      expect(isProviderSettleable(PaymentStatus.PENDING)).toBe(true);
      expect(isProviderSettleable(PaymentStatus.PROCESSING)).toBe(true);
      expect(isProviderSettleable(PaymentStatus.SUCCESSFUL)).toBe(false);
      expect(isProviderSettleable(PaymentStatus.REFUNDED)).toBe(false);
    });

    it('maps a successful provider answer to SUCCESSFUL', () => {
      expect(nextStatusForProviderOutcome(PaymentStatus.PENDING, { status: 'SUCCESSFUL' })).toBe(PaymentStatus.SUCCESSFUL);
      expect(nextStatusForProviderOutcome(PaymentStatus.PROCESSING, { status: 'SUCCESSFUL' })).toBe(PaymentStatus.SUCCESSFUL);
    });

    it('never moves a settled or refunded payment backwards', () => {
      expect(nextStatusForProviderOutcome(PaymentStatus.SUCCESSFUL, { status: 'PENDING' })).toBe(PaymentStatus.SUCCESSFUL);
      expect(nextStatusForProviderOutcome(PaymentStatus.REFUNDED, { status: 'FAILED' })).toBe(PaymentStatus.REFUNDED);
    });

    it('keeps an unknown provider answer at PROCESSING', () => {
      expect(nextStatusForProviderOutcome(PaymentStatus.PENDING, { status: 'PROCESSING' })).toBe(PaymentStatus.PROCESSING);
    });

    it('maps a failed provider answer to FAILED', () => {
      expect(nextStatusForProviderOutcome(PaymentStatus.PROCESSING, { status: 'FAILED' })).toBe(PaymentStatus.FAILED);
    });
  });

  it('only refunds settled payments', () => {
    expect(canRefund(PaymentStatus.SUCCESSFUL)).toBe(true);
    expect(canRefund(PaymentStatus.PENDING)).toBe(false);
    expect(canRefund(PaymentStatus.FAILED)).toBe(false);
  });

  describe('computeOutstanding', () => {
    it('subtracts collected amounts from the fee', () => {
      expect(computeOutstanding(300_000, 0)).toBe(300_000);
      expect(computeOutstanding(300_000, 120_000)).toBe(180_000);
      expect(computeOutstanding(300_000, 300_000)).toBe(0);
    });

    it('never returns a negative balance when the permit was overpaid', () => {
      expect(computeOutstanding(300_000, 350_000)).toBe(0);
    });

    it('rounds to two decimals', () => {
      expect(computeOutstanding(100.1, 0.05)).toBe(100.05);
    });
  });
});
