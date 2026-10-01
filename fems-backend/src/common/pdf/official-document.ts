import PDFDocument from 'pdfkit';

/**
 * Official single-document renderer (permit certificate, payment receipt).
 *
 * Reports are tabular and paginated; a certificate is a one-page instrument that
 * has to look like an administrative document: issuing authority, title, the
 * decisive facts in labelled blocks, the conditions in full, and a verification
 * footer so a printed copy can be checked back against the register.
 */

export interface DocumentField {
  label: string;
  value: string;
  /** Render the value on its own full-width line (long text). */
  wide?: boolean;
}

export interface DocumentSection {
  title: string;
  fields?: DocumentField[];
  /** Free paragraphs rendered under the fields (conditions, legal notice). */
  paragraphs?: string[];
  /** Chronological entries — "2026-03-04 · Approved by …". */
  entries?: string[];
}

export interface OfficialDocumentInput {
  /** Issuing authority printed at the very top. */
  organisation: string;
  /** "EXPLOITATION PERMIT", "PAYMENT RECEIPT". */
  documentType: string;
  /** The human title of this particular document. */
  title: string;
  subtitle?: string;
  /** The register reference — permit number, receipt number. */
  reference: string;
  /** Status stamp drawn across the page ("ACTIVE", "DRAFT — NOT VALID"). */
  stamp?: { label: string; tone: 'valid' | 'warning' | 'void' };
  /** Shown above the body when the document is not a valid instrument. */
  warning?: string;
  sections: DocumentSection[];
  issuedAt: Date;
  issuedBy: string;
  /** Printed in the footer so a paper copy can be verified online. */
  verification: { code: string; instruction: string };
  footerNote?: string;
}

const FOREST_GREEN = '#14532d';
const INK = '#1f2937';
const MUTED = '#6b7280';
const TONES: Record<'valid' | 'warning' | 'void', string> = {
  valid: '#15803d',
  warning: '#b45309',
  void: '#b91c1c',
};

export function renderOfficialDocument(input: OfficialDocumentInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const left = doc.page.margins.left;

      // ------------------------------------------------------------- masthead
      doc.rect(left, doc.page.margins.top - 16, pageWidth, 4).fill(FOREST_GREEN);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(input.organisation.toUpperCase(), left, doc.page.margins.top);
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('FEMS — Forest Exploitation Management System', left, doc.y + 1);
      doc.moveDown(1);

      doc.fillColor(FOREST_GREEN).font('Helvetica-Bold').fontSize(18).text(input.documentType.toUpperCase(), { align: 'center' });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(input.title, { align: 'center' });
      if (input.subtitle) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(input.subtitle, { align: 'center' });
      }
      doc.moveDown(0.4);

      // Reference + stamp on one line.
      const bandY = doc.y;
      doc.rect(left, bandY, pageWidth, 26).fill('#f3f4f6');
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('REFERENCE', left + 10, bandY + 5);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(input.reference, left + 10, bandY + 13);
      if (input.stamp) {
        const colour = TONES[input.stamp.tone];
        doc.font('Helvetica-Bold').fontSize(9);
        const stampWidth = Math.max(110, doc.widthOfString(input.stamp.label.toUpperCase()) + 28);
        const stampX = left + pageWidth - stampWidth - 10;
        doc.roundedRect(stampX, bandY + 4, stampWidth, 18, 4).lineWidth(1.2).strokeColor(colour).stroke();
        doc
          .fillColor(colour)
          .font('Helvetica-Bold')
          .fontSize(9)
          .text(input.stamp.label.toUpperCase(), stampX, bandY + 10, { width: stampWidth, align: 'center' });
      }
      doc.y = bandY + 34;

      if (input.warning) {
        const warnY = doc.y;
        const height = doc.heightOfString(input.warning, { width: pageWidth - 20 }) + 12;
        doc.rect(left, warnY, pageWidth, height).fill('#fef3c7');
        doc.fillColor('#92400e').font('Helvetica-Bold').fontSize(8.5).text(input.warning, left + 10, warnY + 6, { width: pageWidth - 20 });
        doc.y = warnY + height + 10;
      }

      // -------------------------------------------------------------- sections
      const ensureRoom = (needed: number) => {
        if (doc.y + needed > doc.page.height - doc.page.margins.bottom - 46) {
          doc.addPage();
          doc.y = doc.page.margins.top;
        }
      };

      for (const section of input.sections) {
        ensureRoom(40);
        doc.fillColor(FOREST_GREEN).font('Helvetica-Bold').fontSize(10).text(section.title.toUpperCase(), left, doc.y);
        doc.moveTo(left, doc.y + 2).lineTo(left + pageWidth, doc.y + 2).lineWidth(0.5).strokeColor('#d1d5db').stroke();
        doc.y += 8;

        const fields = section.fields ?? [];
        const columnWidth = pageWidth / 2;
        let slot = 0;
        for (const field of fields) {
          if (field.wide) {
            if (slot % 2 === 1) slot += 1; // close the open row first
            const y = doc.y + Math.floor(slot / 2) * 0;
            ensureRoom(30);
            doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(field.label.toUpperCase(), left, y);
            doc.fillColor(INK).font('Helvetica').fontSize(9).text(field.value, left, doc.y + 1, { width: pageWidth });
            doc.y += 6;
            slot = 0;
            continue;
          }
          const column = slot % 2;
          if (column === 0) ensureRoom(32);
          const rowTop = doc.y;
          doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(field.label.toUpperCase(), left + column * columnWidth, rowTop, {
            width: columnWidth - 12,
          });
          doc
            .fillColor(INK)
            .font('Helvetica-Bold')
            .fontSize(9.5)
            .text(field.value, left + column * columnWidth, rowTop + 10, { width: columnWidth - 12 });
          if (column === 1) {
            doc.y = rowTop + 28;
          } else {
            doc.y = rowTop; // keep the cursor for the right-hand column
          }
          slot += 1;
        }
        if (slot % 2 === 1) doc.y += 28; // a dangling left-hand column

        for (const paragraph of section.paragraphs ?? []) {
          ensureRoom(26);
          doc.fillColor(INK).font('Helvetica').fontSize(9).text(paragraph, left, doc.y, { width: pageWidth, align: 'justify' });
          doc.moveDown(0.4);
        }

        for (const entry of section.entries ?? []) {
          ensureRoom(16);
          doc.fillColor(INK).font('Helvetica').fontSize(8.5).text(`·  ${entry}`, left + 4, doc.y, { width: pageWidth - 8 });
          doc.y += 2;
        }

        doc.moveDown(0.8);
      }

      // --------------------------------------------------------------- footer
      ensureRoom(70);
      doc.moveDown(0.5);
      const sigY = doc.y;
      doc.moveTo(left, sigY).lineTo(left + pageWidth, sigY).lineWidth(0.5).strokeColor('#d1d5db').stroke();
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`Issued ${input.issuedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC by ${input.issuedBy}`, left, sigY + 8);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5).text(`Verification code: ${input.verification.code}`, left, doc.y + 2);
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(input.verification.instruction, left, doc.y + 1, { width: pageWidth });
      if (input.footerNote) {
        doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(7.5).text(input.footerNote, left, doc.y + 4, { width: pageWidth });
      }

      const range = doc.bufferedPageRange();
      for (let page = range.start; page < range.start + range.count; page += 1) {
        doc.switchToPage(page);
        doc
          .fillColor(MUTED)
          .font('Helvetica')
          .fontSize(7)
          .text(
            `${input.reference} — page ${page + 1} / ${range.count} — generated by FEMS`,
            left,
            doc.page.height - doc.page.margins.bottom + 10,
            { width: pageWidth, align: 'center' },
          );
      }

      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Document rendering failed.'));
    }
  });
}
