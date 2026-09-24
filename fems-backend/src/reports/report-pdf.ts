import PDFDocument from 'pdfkit';
import type { ReportColumn } from './report-datasets';

export interface PdfReportInput {
  title: string;
  organisation: string;
  period: string;
  generatedBy: string;
  generatedAt: Date;
  summary: Array<{ label: string; value: string }>;
  notes?: string[];
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
  totalRows: number;
}

const FOREST_GREEN = '#14532d';
const INK = '#1f2937';
const MUTED = '#6b7280';

function formatCell(value: unknown, column: ReportColumn): string {
  if (value === null || value === undefined || value === '') return '—';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (column.numeric) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
    }
  }
  return String(value);
}

/**
 * Renders a report as a printable PDF (A4, paginated, with a legend and totals).
 *
 * The document is produced server-side from the same rows the JSON/CSV export
 * contains, so a downloaded PDF can never disagree with the API response.
 */
export function renderReportPdf(input: PdfReportInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const left = doc.page.margins.left;

      const header = () => {
        doc.rect(left, doc.page.margins.top - 12, pageWidth, 3).fill(FOREST_GREEN);
        doc.fillColor(INK).fontSize(9).font('Helvetica-Bold').text(input.organisation.toUpperCase(), left, doc.page.margins.top);
        doc.font('Helvetica').fillColor(MUTED).fontSize(8);
        doc.text(`${input.period}  ·  FEMS — Forest Exploitation Management System`, left, doc.page.margins.top + 12);
        doc.moveDown(0.4);
        doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y).strokeColor('#d1d5db').lineWidth(0.5).stroke();
        doc.moveDown(0.6);
      };

      header();

      doc.fillColor(FOREST_GREEN).font('Helvetica-Bold').fontSize(16).text(input.title, left, doc.y);
      doc.moveDown(0.2);
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(8)
        .text(`Generated ${input.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC by ${input.generatedBy}`);
      doc.moveDown(0.8);

      // Summary block — two columns of key/value pairs.
      if (input.summary.length > 0) {
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Summary');
        doc.moveDown(0.3);
        const columnWidth = pageWidth / 2;
        const startY = doc.y;
        let rowIndex = 0;
        for (const entry of input.summary) {
          const column = rowIndex % 2;
          const y = startY + Math.floor(rowIndex / 2) * 16;
          doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(entry.label, left + column * columnWidth, y, { width: columnWidth - 8 });
          doc
            .fillColor(INK)
            .font('Helvetica-Bold')
            .fontSize(9)
            .text(entry.value, left + column * columnWidth + columnWidth * 0.42, y, { width: columnWidth * 0.58 });
          rowIndex += 1;
        }
        doc.y = startY + Math.ceil(input.summary.length / 2) * 16 + 8;
      }

      if (input.notes && input.notes.length > 0) {
        doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8);
        for (const note of input.notes) doc.text(`· ${note}`, left, doc.y);
        doc.moveDown(0.5);
      }

      // Data table
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(`Records (${input.rows.length}${input.truncated ? ` of ${input.totalRows}` : ''})`);
      doc.moveDown(0.3);

      const columnWidth = pageWidth / Math.max(1, input.columns.length);
      const rowHeight = 16;

      const drawTableHeader = () => {
        const y = doc.y;
        doc.rect(left, y - 2, pageWidth, rowHeight).fill('#f3f4f6').fillColor(INK);
        doc.font('Helvetica-Bold').fontSize(7.5);
        input.columns.forEach((column, index) => {
          doc.text(column.label, left + index * columnWidth + 2, y + 3, { width: columnWidth - 4, ellipsis: true });
        });
        doc.y = y + rowHeight;
      };

      drawTableHeader();

      input.rows.forEach((row, rowIndex) => {
        if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();
          header();
          drawTableHeader();
        }
        const y = doc.y;
        if (rowIndex % 2 === 1) {
          doc.rect(left, y - 2, pageWidth, rowHeight).fill('#fafafa');
        }
        doc.fillColor(INK).font('Helvetica').fontSize(7.5);
        input.columns.forEach((column, index) => {
          doc.text(formatCell(row[column.key], column), left + index * columnWidth + 2, y + 3, {
            width: columnWidth - 4,
            height: rowHeight - 2,
            ellipsis: true,
            align: column.numeric ? 'right' : 'left',
          });
        });
        doc.y = y + rowHeight;
      });

      if (input.rows.length === 0) {
        doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9).text('No record matches the selected filters.', left, doc.y + 4);
      }

      // Page numbers
      const range = doc.bufferedPageRange();
      for (let page = range.start; page < range.start + range.count; page += 1) {
        doc.switchToPage(page);
        doc
          .fillColor(MUTED)
          .font('Helvetica')
          .fontSize(7)
          .text(
            `Page ${page + 1} / ${range.count} — FEMS report ${input.period}`,
            left,
            doc.page.height - doc.page.margins.bottom + 6,
            { width: pageWidth, align: 'center' },
          );
      }

      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error('PDF rendering failed.'));
    }
  });
}
