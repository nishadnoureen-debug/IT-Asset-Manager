import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney, setDefaultCurrency } from './format';

// Intl separates the code from the amount with a (non-breaking) space.
const norm = (s: string) => s.replace(/\s/gu, ' ');

afterEach(() => setDefaultCurrency('AED'));

describe('formatMoney', () => {
  it('shows amounts in dirhams by default, with the ISO code', () => {
    expect(norm(formatMoney(150))).toBe('AED 150.00');
    expect(norm(formatMoney('1234567.891'))).toBe('AED 1,234,567.89');
  });

  it("uses the record's own currency when it has one", () => {
    expect(norm(formatMoney(12.5, 'EUR'))).toBe('EUR 12.50');
  });

  it('follows the default currency from Settings', () => {
    setDefaultCurrency('SAR');
    expect(norm(formatMoney(99))).toBe('SAR 99.00');
    setDefaultCurrency('not-a-code');
    expect(norm(formatMoney(99))).toBe('SAR 99.00');
  });

  it('prints a dash for missing values', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney('')).toBe('—');
    expect(formatMoney('abc')).toBe('—');
  });
});
