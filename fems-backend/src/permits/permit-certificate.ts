import { createHash } from 'node:crypto';
import { PermitStatus } from '@prisma/client';
import { renderOfficialDocument, type DocumentSection, type OfficialDocumentInput } from '../common/pdf/official-document';

/**
 * Permit certificate.
 *
 * The printable instrument a company carries in the field and an officer checks
 * at a control post. It is rendered from the live permit row — never from a
 * stored copy — so a suspended or expired permit can never print as valid, and
 * the status stamp always tells the truth at the moment of download.
 */

type Decimalish = { toString(): string } | number | null | undefined;

export interface PermitCertificateData {
  id: string;
  permitNumber: string;
  type: string;
  status: PermitStatus;
  title: string;
  purpose: string | null;
  conditions: string | null;
  currency: string;
  feeAmount: Decimalish;
  royaltyRatePerM3: Decimalish;
  volumeRequestedM3: Decimalish;
  volumeApprovedM3: Decimalish;
  areaRequestedHa: Decimalish;
  startDate: Date;
  endDate: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  approvedAt: Date | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  revokedAt: Date | null;
  revocationReason: string | null;
  rejectionReason: string | null;
  expiresAt: Date | null;
  renewalCount: number;
  isDemo: boolean;
  createdAt: Date;
  company: { name: string; type?: string | null } | null;
  applicant: { firstName: string; lastName: string; email: string } | null;
  forest: { code: string; name: string; region?: string | null } | null;
  zone: { code: string; name: string } | null;
  approvedBy: { firstName: string; lastName: string } | null;
  reviewedBy: { firstName: string; lastName: string } | null;
  statusHistory?: Array<{
    fromStatus: PermitStatus | null;
    toStatus: PermitStatus;
    reason: string | null;
    createdAt: Date;
    changedBy?: { firstName: string; lastName: string } | null;
  }>;
  payments?: Array<{ reference: string; amount: Decimalish; currency: string; status: string; paidAt: Date | null }>;
}

/** Statuses that make the document a valid authorisation to exploit. */
const VALID_STATUSES = new Set<PermitStatus>([PermitStatus.APPROVED, PermitStatus.ACTIVE]);

const STATUS_NOTE: Partial<Record<PermitStatus, string>> = {
  [PermitStatus.DRAFT]: 'This application is still a draft. The document is a working copy and authorises nothing.',
  [PermitStatus.SUBMITTED]: 'This application has been submitted and is awaiting review. It authorises no exploitation.',
  [PermitStatus.UNDER_REVIEW]: 'This application is under review. It authorises no exploitation.',
  [PermitStatus.REVISION_REQUIRED]: 'A revision has been requested from the applicant. This copy authorises no exploitation.',
  [PermitStatus.REJECTED]: 'This application was rejected. The document is kept for the record only.',
  [PermitStatus.SUSPENDED]: 'This permit is SUSPENDED. All exploitation must stop until the suspension is lifted.',
  [PermitStatus.REVOKED]: 'This permit has been REVOKED. It confers no right whatsoever.',
  [PermitStatus.EXPIRED]: 'This permit has EXPIRED. Continuing to exploit under it is an offence.',
  [PermitStatus.CANCELLED]: 'This application was cancelled by the applicant.',
  [PermitStatus.PAYMENT_PENDING]: 'The permit fee has not been settled in full. Exploitation may not start until payment is confirmed.',
};

function stampFor(status: PermitStatus): { label: string; tone: 'valid' | 'warning' | 'void' } {
  if (VALID_STATUSES.has(status)) return { label: status, tone: 'valid' };
  if (status === PermitStatus.REVOKED || status === PermitStatus.REJECTED || status === PermitStatus.EXPIRED) {
    return { label: `${status} — not valid`, tone: 'void' };
  }
  return { label: `${status} — not valid`, tone: 'warning' };
}

function num(value: Decimalish): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(typeof value === 'number' ? value : value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

function amount(value: Decimalish, currency: string): string {
  const parsed = num(value);
  if (parsed === null) return '—';
  return `${parsed.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${currency}`;
}

function quantity(value: Decimalish, unit: string): string {
  const parsed = num(value);
  if (parsed === null) return '—';
  return `${parsed.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${unit}`;
}

function day(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : '—';
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * A short, stable verification code. It is derived from the permit identity, so
 * the same permit always prints the same code and a forged number cannot
 * produce a matching one without the server secret-free but non-obvious hash.
 */
export function permitVerificationCode(permit: { id: string; permitNumber: string }): string {
  const digest = createHash('sha256').update(`fems:permit:${permit.id}:${permit.permitNumber}`).digest('hex').toUpperCase();
  return `${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8, 12)}`;
}

export function buildPermitCertificate(
  permit: PermitCertificateData,
  context: { organisation: string; generatedBy: string; generatedAt?: Date },
): OfficialDocumentInput {
  const generatedAt = context.generatedAt ?? new Date();
  const valid = VALID_STATUSES.has(permit.status);
  const settled = (permit.payments ?? []).filter((payment) => payment.status === 'SUCCESSFUL');
  const paid = settled.reduce((total, payment) => total + (num(payment.amount) ?? 0), 0);
  const fee = num(permit.feeAmount) ?? 0;

  const sections: DocumentSection[] = [
    {
      title: 'Holder',
      fields: [
        { label: 'Company', value: permit.company?.name ?? '—' },
        { label: 'Company type', value: permit.company?.type ? humanize(permit.company.type) : '—' },
        {
          label: 'Applicant',
          value: permit.applicant ? `${permit.applicant.firstName} ${permit.applicant.lastName}` : '—',
        },
        { label: 'Applicant email', value: permit.applicant?.email ?? '—' },
      ],
    },
    {
      title: 'Authorised operation',
      fields: [
        { label: 'Permit type', value: humanize(permit.type) },
        { label: 'Forest', value: permit.forest ? `${permit.forest.name} (${permit.forest.code})` : '—' },
        { label: 'Region', value: permit.forest?.region ?? '—' },
        { label: 'Zone', value: permit.zone ? `${permit.zone.name} (${permit.zone.code})` : 'whole forest' },
        {
          label: 'Volume authorised',
          value: permit.volumeApprovedM3 ? quantity(permit.volumeApprovedM3, 'm³') : `${quantity(permit.volumeRequestedM3, 'm³')} (requested)`,
        },
        { label: 'Area', value: quantity(permit.areaRequestedHa, 'ha') },
        { label: 'Valid from', value: day(permit.startDate) },
        { label: 'Valid until', value: day(permit.endDate) },
        { label: 'Royalty rate', value: permit.royaltyRatePerM3 ? `${amount(permit.royaltyRatePerM3, permit.currency)} / m³` : '—' },
        { label: 'Renewals', value: String(permit.renewalCount) },
        { label: 'Subject', value: permit.title, wide: true },
        ...(permit.purpose ? [{ label: 'Purpose', value: permit.purpose, wide: true }] : []),
      ],
    },
    {
      title: 'Fees',
      fields: [
        { label: 'Fee assessed', value: amount(permit.feeAmount, permit.currency) },
        { label: 'Settled', value: amount(paid, permit.currency) },
        { label: 'Outstanding', value: amount(Math.max(0, fee - paid), permit.currency) },
        { label: 'Receipts', value: settled.length ? settled.map((payment) => payment.reference).join(', ') : 'none' },
      ],
    },
  ];

  if (permit.conditions) {
    sections.push({
      title: 'Conditions',
      paragraphs: permit.conditions
        .split(/\r?\n+/)
        .map((line) => line.trim())
        .filter(Boolean),
    });
  }

  const reasons = [
    permit.rejectionReason ? `Rejection: ${permit.rejectionReason}` : null,
    permit.suspensionReason ? `Suspension: ${permit.suspensionReason}` : null,
    permit.revocationReason ? `Revocation: ${permit.revocationReason}` : null,
  ].filter((entry): entry is string => Boolean(entry));
  if (reasons.length > 0) {
    sections.push({ title: 'Restrictions on this permit', paragraphs: reasons });
  }

  const history = (permit.statusHistory ?? []).slice(-12);
  sections.push({
    title: 'Decision history',
    fields: [
      { label: 'Submitted', value: day(permit.submittedAt) },
      { label: 'Reviewed', value: permit.reviewedAt ? `${day(permit.reviewedAt)} — ${permit.reviewedBy ? `${permit.reviewedBy.firstName} ${permit.reviewedBy.lastName}` : 'FEMS'}` : '—' },
      { label: 'Approved', value: permit.approvedAt ? `${day(permit.approvedAt)} — ${permit.approvedBy ? `${permit.approvedBy.firstName} ${permit.approvedBy.lastName}` : 'FEMS'}` : '—' },
      { label: 'Expiry recorded', value: day(permit.expiresAt) },
    ],
    entries: history.map((entry) => {
      const who = entry.changedBy ? `${entry.changedBy.firstName} ${entry.changedBy.lastName}` : 'system';
      const from = entry.fromStatus ? `${humanize(entry.fromStatus)} → ` : '';
      return `${day(entry.createdAt)} · ${from}${humanize(entry.toStatus)} · ${who}${entry.reason ? ` — ${entry.reason}` : ''}`;
    }),
  });

  const warnings = [
    permit.isDemo ? 'DEMONSTRATION DATA — this document is not an administrative act.' : null,
    valid ? null : STATUS_NOTE[permit.status] ?? 'This permit is not in force.',
  ].filter((entry): entry is string => Boolean(entry));

  return {
    organisation: context.organisation,
    documentType: 'Exploitation permit',
    title: permit.title,
    subtitle: `${humanize(permit.type)} · ${permit.forest?.name ?? 'unassigned forest'}`,
    reference: permit.permitNumber,
    stamp: stampFor(permit.status),
    warning: warnings.length > 0 ? warnings.join('  ') : undefined,
    sections,
    issuedAt: generatedAt,
    issuedBy: context.generatedBy,
    verification: {
      code: permitVerificationCode(permit),
      instruction: `Check this permit against the register: permit ${permit.permitNumber}, status at issue ${permit.status}. A control officer can confirm the current status in FEMS at any time — this sheet reflects the register only at the moment it was produced.`,
    },
    footerNote: valid
      ? 'This document must be presented on request at any control post together with the holder’s identification.'
      : 'Not an authorisation to exploit.',
  };
}

export async function renderPermitCertificate(
  permit: PermitCertificateData,
  context: { organisation: string; generatedBy: string; generatedAt?: Date },
): Promise<Buffer> {
  return renderOfficialDocument(buildPermitCertificate(permit, context));
}
