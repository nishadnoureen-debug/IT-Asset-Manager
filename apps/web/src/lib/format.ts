import { DEFAULT_SETTINGS } from '@itam/shared';

export { label, LABELS } from '@itam/shared';

/** Currency for amounts that have none of their own; kept in sync with Settings by the app shell. */
let defaultCurrency: string = DEFAULT_SETTINGS.defaultCurrency;
export function setDefaultCurrency(code: string | null | undefined): void {
  if (code && /^[A-Z]{3}$/.test(code)) defaultCurrency = code;
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

export function formatMoney(
  value: string | number | null | undefined,
  currency?: string | null,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  const code = currency || defaultCurrency;
  try {
    // Always the ISO code ("AED 1,250.00"), never a locale symbol such as "$" or "د.إ".
    return new Intl.NumberFormat('en-AE', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'code',
    }).format(n);
  } catch {
    return `${code} ${n.toFixed(2)}`;
  }
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : new Intl.NumberFormat().format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day');
  return formatDate(d);
}

/** Whole days from today until a date (negative when in the past). */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const target = new Date(value);
  const today = new Date();
  const utc = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((utc(target) - utc(today)) / 86_400_000);
}

export function fullName(e: { firstName: string; lastName: string } | null | undefined): string {
  return e ? `${e.firstName} ${e.lastName}` : '—';
}

/** yyyy-mm-dd for <input type="date"> */
export function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

export const ticketRef = (n: number) => `TCK-${String(n).padStart(5, '0')}`;
export const maintenanceRef = (n: number) => `MNT-${String(n).padStart(5, '0')}`;
export const auditRef = (n: number) => `AUD-${String(n).padStart(4, '0')}`;
