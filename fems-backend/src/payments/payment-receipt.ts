import { createHash } from 'node:crypto';
import type { DocumentSection, OfficialDocumentInput } from '../common/pdf/official-document';

/**
 * Payment receipt document.
 *
 * Built from exactly the payload `PaymentsService.receipt()` returns, so the
 * printed receipt and the API response are the same statement of fact. A
 * sandbox payment is stamped as such — a simulated settlement must never look
 * like money that actually moved.
 */

export interface ReceiptPayload {
  receiptNumber: string;
  issuedAt: Date | string;
  issuedBy: string;
  organisation: string;
  payment: {
    reference: string;
    purpose: string;
    method: string;
    amount: number;
    currency: string;
    provider: string;
    providerReference: string | null;
    isSandbox: boolean;
    paidAt: Date | string | null;
  };
  payer: { id: string; name: string; email: string; phone: string | null };
  company: { id?: string; name: string } | null;
  permit: { id?: string; permitNumber: string; title?: string | null } | null;
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function moment(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function receiptVerificationCode(receiptNumber: string, reference: string): string {
  const digest = createHash('sha256').update(`fems:receipt:${receiptNumber}:${reference}`).digest('hex').toUpperCase();
  return `${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8, 12)}`;
}

export function buildPaymentReceipt(receipt: ReceiptPayload): OfficialDocumentInput {
  const { payment } = receipt;
  const amount = `${payment.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${payment.currency}`;

  const sections: DocumentSection[] = [
    {
      title: 'Amount settled',
      fields: [
        { label: 'Amount', value: amount },
        { label: 'Paid on', value: moment(payment.paidAt) },
        { label: 'Purpose', value: humanize(payment.purpose) },
        { label: 'Method', value: humanize(payment.method) },
      ],
    },
    {
      title: 'Payer',
      fields: [
        { label: 'Name', value: receipt.payer.name },
        { label: 'Email', value: receipt.payer.email },
        { label: 'Phone', value: receipt.payer.phone ?? '—' },
        { label: 'Company', value: receipt.company?.name ?? '—' },
      ],
    },
    {
      title: 'Transaction',
      fields: [
        { label: 'Payment reference', value: payment.reference },
        { label: 'Provider', value: humanize(payment.provider) },
        { label: 'Provider reference', value: payment.providerReference ?? '—' },
        { label: 'Permit', value: receipt.permit ? receipt.permit.permitNumber : 'not linked to a permit' },
        ...(receipt.permit?.title ? [{ label: 'Permit subject', value: receipt.permit.title, wide: true }] : []),
      ],
    },
  ];

  return {
    organisation: receipt.organisation,
    documentType: 'Payment receipt',
    title: `${amount} — ${humanize(payment.purpose)}`,
    subtitle: receipt.permit ? `Permit ${receipt.permit.permitNumber}` : undefined,
    reference: receipt.receiptNumber,
    stamp: payment.isSandbox ? { label: 'Sandbox — no funds moved', tone: 'void' } : { label: 'Paid', tone: 'valid' },
    warning: payment.isSandbox
      ? 'SANDBOX TRANSACTION — this settlement was simulated for testing. It is not proof of payment.'
      : undefined,
    sections,
    issuedAt: receipt.issuedAt instanceof Date ? receipt.issuedAt : new Date(receipt.issuedAt),
    issuedBy: receipt.issuedBy,
    verification: {
      code: receiptVerificationCode(receipt.receiptNumber, payment.reference),
      instruction: `Quote receipt ${receipt.receiptNumber} and payment reference ${payment.reference} to have this settlement confirmed against the register.`,
    },
    footerNote: payment.isSandbox ? undefined : 'This receipt is issued electronically and is valid without a signature.',
  };
}
