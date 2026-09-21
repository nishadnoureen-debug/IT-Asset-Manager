import ExcelJS from 'exceljs';
import type { PdfService } from '../pdf/pdf.service';

export type CellValue = string | number | boolean | Date | null | undefined;

export interface ReportColumn {
  key: string;
  label: string;
  /** Relative width for PDF output. */
  width?: number;
  type?: 'text' | 'number' | 'money' | 'date' | 'datetime';
}

export interface ReportResult {
  type: string;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, CellValue>[];
  total: number;
  truncated: boolean;
  generatedAt: string;
  filters: Record<string, unknown>;
}

function formatCell(value: CellValue, column: ReportColumn): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return column.type === 'datetime'
      ? value.toISOString().replace('T', ' ').slice(0, 16)
      : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && column.type === 'money') return value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** Neutralise spreadsheet formula injection (cells starting with = + - @ tab CR). */
export function csvSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsv(report: ReportResult): Buffer {
  const escape = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    report.columns.map((c) => escape(c.label)).join(','),
    ...report.rows.map((row) =>
      report.columns.map((c) => escape(csvSafe(formatCell(row[c.key], c)))).join(','),
    ),
  ];
  // UTF-8 BOM so Excel opens non-ASCII text correctly.
  return Buffer.from('﻿' + lines.join('\r\n'), 'utf8');
}

export async function toXlsx(report: ReportResult): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(report.generatedAt);
  const sheet = workbook.addWorksheet(report.title.slice(0, 31));
  sheet.columns = report.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.max(12, Math.min(48, (c.width ?? 1) * 18)),
    style:
      c.type === 'money'
        ? { numFmt: '#,##0.00' }
        : c.type === 'date'
          ? { numFmt: 'yyyy-mm-dd' }
          : c.type === 'datetime'
            ? { numFmt: 'yyyy-mm-dd hh:mm' }
            : {},
  }));
  for (const row of report.rows) {
    sheet.addRow(
      Object.fromEntries(
        report.columns.map((c) => {
          const v = row[c.key];
          if (v === null || v === undefined) return [c.key, null];
          if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean')
            return [c.key, v];
          return [c.key, csvSafe(String(v))];
        }),
      ),
    );
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: report.columns.length } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function toPdf(report: ReportResult, pdf: PdfService, companyName: string): Promise<Buffer> {
  const totalWidth = report.columns.reduce((sum, c) => sum + (c.width ?? 1), 0);
  return pdf.render(
    (doc) => {
      pdf.header(
        doc,
        report.title,
        `${companyName} · Generated ${report.generatedAt.replace('T', ' ').slice(0, 16)} UTC · ${report.total} rows${report.truncated ? ' (truncated)' : ''}`,
      );
      pdf.table(
        doc,
        report.columns.map((c) => ({ label: c.label, width: (c.width ?? 1) / totalWidth })),
        report.rows.map((row) => report.columns.map((c) => formatCell(row[c.key], c))),
      );
    },
    { layout: report.columns.length > 6 ? 'landscape' : 'portrait', margin: 32 },
  );
}
