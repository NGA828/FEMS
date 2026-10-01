import { PermitStatus } from '@prisma/client';
import { buildPermitCertificate, permitVerificationCode, renderPermitCertificate, type PermitCertificateData } from './permit-certificate';

function permit(overrides: Partial<PermitCertificateData> = {}): PermitCertificateData {
  return {
    id: 'permit-1',
    permitNumber: 'PRM-2026-0001',
    type: 'SELECTIVE_LOGGING',
    status: PermitStatus.ACTIVE,
    title: 'Selective logging — Block 4',
    purpose: 'Harvest of mature sapelli under the approved management plan.',
    conditions: 'No felling within 50 m of a watercourse.\nDaily volume reported in FEMS.',
    currency: 'XAF',
    feeAmount: 1_500_000,
    royaltyRatePerM3: 3_200,
    volumeRequestedM3: 5_000,
    volumeApprovedM3: 4_200,
    areaRequestedHa: 180,
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2026-12-31T00:00:00Z'),
    submittedAt: new Date('2025-11-02T09:00:00Z'),
    reviewedAt: new Date('2025-11-20T09:00:00Z'),
    approvedAt: new Date('2025-12-01T09:00:00Z'),
    suspendedAt: null,
    suspensionReason: null,
    revokedAt: null,
    revocationReason: null,
    rejectionReason: null,
    expiresAt: null,
    renewalCount: 0,
    isDemo: false,
    createdAt: new Date('2025-10-30T09:00:00Z'),
    company: { name: 'Société Forestière du Sud', type: 'LOGGING_COMPANY' },
    applicant: { firstName: 'Awa', lastName: 'Ngono', email: 'awa@sfs.cm' },
    forest: { code: 'FR-012', name: 'Dja', region: 'Est' },
    zone: { code: 'Z-4', name: 'Block 4' },
    approvedBy: { firstName: 'Paul', lastName: 'Biya' },
    reviewedBy: { firstName: 'Marie', lastName: 'Eyenga' },
    statusHistory: [
      { fromStatus: null, toStatus: PermitStatus.DRAFT, reason: 'Application created', createdAt: new Date('2025-10-30T09:00:00Z'), changedBy: null },
      {
        fromStatus: PermitStatus.UNDER_REVIEW,
        toStatus: PermitStatus.APPROVED,
        reason: 'Management plan compliant',
        createdAt: new Date('2025-12-01T09:00:00Z'),
        changedBy: { firstName: 'Paul', lastName: 'Biya' },
      },
    ],
    payments: [{ reference: 'PAY-9001', amount: 1_500_000, currency: 'XAF', status: 'SUCCESSFUL', paidAt: new Date('2025-12-05T09:00:00Z') }],
    ...overrides,
  };
}

const context = { organisation: 'Ministère des Forêts et de la Faune', generatedBy: 'Marie Eyenga' };

describe('permit certificate', () => {
  it('stamps an active permit as valid and states the authorised volume', () => {
    const document = buildPermitCertificate(permit(), context);

    expect(document.reference).toBe('PRM-2026-0001');
    expect(document.stamp).toEqual({ label: 'ACTIVE', tone: 'valid' });
    expect(document.warning).toBeUndefined();

    const operation = document.sections.find((section) => section.title === 'Authorised operation');
    expect(operation?.fields?.find((field) => field.label === 'Volume authorised')?.value).toContain('4');
    expect(operation?.fields?.find((field) => field.label === 'Valid until')?.value).toBe('2026-12-31');
  });

  it.each([
    [PermitStatus.DRAFT, 'warning'],
    [PermitStatus.SUBMITTED, 'warning'],
    [PermitStatus.SUSPENDED, 'warning'],
    [PermitStatus.REVOKED, 'void'],
    [PermitStatus.EXPIRED, 'void'],
    [PermitStatus.REJECTED, 'void'],
  ])('never prints %s as a valid authorisation', (status, tone) => {
    const document = buildPermitCertificate(permit({ status }), context);
    expect(document.stamp?.tone).toBe(tone);
    expect(document.stamp?.label).toContain('not valid');
    expect(document.warning).toBeTruthy();
    expect(document.footerNote).toBe('Not an authorisation to exploit.');
  });

  it('shows the fee actually settled and what is still outstanding', () => {
    const document = buildPermitCertificate(
      permit({ feeAmount: 2_000_000, payments: [{ reference: 'PAY-1', amount: 500_000, currency: 'XAF', status: 'SUCCESSFUL', paidAt: new Date() }] }),
      context,
    );
    const fees = document.sections.find((section) => section.title === 'Fees');
    expect(fees?.fields?.find((field) => field.label === 'Settled')?.value).toContain('500');
    // 2 000 000 assessed − 500 000 settled
    expect(fees?.fields?.find((field) => field.label === 'Outstanding')?.value.replace(/\s/g, '')).toBe('1500000XAF');
  });

  it('ignores payments that never settled', () => {
    const document = buildPermitCertificate(
      permit({
        payments: [
          { reference: 'PAY-1', amount: 900_000, currency: 'XAF', status: 'PENDING', paidAt: null },
          { reference: 'PAY-2', amount: 100_000, currency: 'XAF', status: 'SUCCESSFUL', paidAt: new Date() },
        ],
      }),
      context,
    );
    const fees = document.sections.find((section) => section.title === 'Fees');
    expect(fees?.fields?.find((field) => field.label === 'Receipts')?.value).toBe('PAY-2');
  });

  it('marks demonstration data so a seeded permit cannot pass for an administrative act', () => {
    const document = buildPermitCertificate(permit({ isDemo: true }), context);
    expect(document.warning).toContain('DEMONSTRATION DATA');
  });

  it('carries the suspension and revocation reasons into the document', () => {
    const document = buildPermitCertificate(
      permit({ status: PermitStatus.SUSPENDED, suspensionReason: 'Unpaid royalties for Q3' }),
      context,
    );
    const restrictions = document.sections.find((section) => section.title === 'Restrictions on this permit');
    expect(restrictions?.paragraphs?.[0]).toContain('Unpaid royalties');
  });

  it('splits the conditions into one paragraph per line', () => {
    const document = buildPermitCertificate(permit(), context);
    const conditions = document.sections.find((section) => section.title === 'Conditions');
    expect(conditions?.paragraphs).toHaveLength(2);
  });

  it('derives a stable verification code from the permit identity', () => {
    const code = permitVerificationCode({ id: 'permit-1', permitNumber: 'PRM-2026-0001' });
    expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(permitVerificationCode({ id: 'permit-1', permitNumber: 'PRM-2026-0001' })).toBe(code);
    expect(permitVerificationCode({ id: 'permit-2', permitNumber: 'PRM-2026-0001' })).not.toBe(code);
  });

  it('renders a real PDF document', async () => {
    const buffer = await renderPermitCertificate(permit(), context);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1_000);
  });
});
