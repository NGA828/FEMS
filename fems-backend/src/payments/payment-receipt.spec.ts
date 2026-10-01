import { renderOfficialDocument } from '../common/pdf/official-document';
import { buildPaymentReceipt, receiptVerificationCode, type ReceiptPayload } from './payment-receipt';

function receipt(overrides: Partial<ReceiptPayload> = {}): ReceiptPayload {
  return {
    receiptNumber: 'RCP-2026-0007',
    issuedAt: new Date('2026-02-10T10:30:00Z'),
    issuedBy: 'Marie Eyenga',
    organisation: 'Ministère des Forêts et de la Faune',
    payment: {
      reference: 'PAY-2026-0007',
      purpose: 'PERMIT_FEE',
      method: 'MOBILE_MONEY_MTN',
      amount: 1_500_000,
      currency: 'XAF',
      provider: 'CAMPAY',
      providerReference: 'cmp-77123',
      isSandbox: false,
      paidAt: new Date('2026-02-10T10:25:00Z'),
    },
    payer: { id: 'user-1', name: 'Awa Ngono', email: 'awa@sfs.cm', phone: '+237670000000' },
    company: { name: 'Société Forestière du Sud' },
    permit: { permitNumber: 'PRM-2026-0001', title: 'Selective logging — Block 4' },
    ...overrides,
  };
}

describe('payment receipt', () => {
  it('states the amount, the payer and the permit it settles', () => {
    const document = buildPaymentReceipt(receipt());
    expect(document.reference).toBe('RCP-2026-0007');
    expect(document.stamp).toEqual({ label: 'Paid', tone: 'valid' });
    expect(document.title).toContain('XAF');
    const amounts = document.sections.find((section) => section.title === 'Amount settled');
    expect(amounts?.fields?.find((field) => field.label === 'Method')?.value).toBe('Mobile Money Mtn');
    const transaction = document.sections.find((section) => section.title === 'Transaction');
    expect(transaction?.fields?.find((field) => field.label === 'Permit')?.value).toBe('PRM-2026-0001');
  });

  it('never lets a simulated settlement look like money that moved', () => {
    const document = buildPaymentReceipt(receipt({ payment: { ...receipt().payment, isSandbox: true, provider: 'SIMULATOR' } }));
    expect(document.stamp?.tone).toBe('void');
    expect(document.warning).toContain('SANDBOX');
    expect(document.footerNote).toBeUndefined();
  });

  it('handles a payment that is not attached to a permit', () => {
    const document = buildPaymentReceipt(receipt({ permit: null, company: null }));
    const transaction = document.sections.find((section) => section.title === 'Transaction');
    expect(transaction?.fields?.find((field) => field.label === 'Permit')?.value).toBe('not linked to a permit');
    expect(document.subtitle).toBeUndefined();
  });

  it('derives a stable verification code', () => {
    const code = receiptVerificationCode('RCP-2026-0007', 'PAY-2026-0007');
    expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(receiptVerificationCode('RCP-2026-0007', 'PAY-2026-0008')).not.toBe(code);
  });

  it('renders a real PDF document', async () => {
    const buffer = await renderOfficialDocument(buildPaymentReceipt(receipt()));
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1_000);
  });
});
