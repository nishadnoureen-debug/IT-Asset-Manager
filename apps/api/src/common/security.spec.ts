import { ConfigService } from '@nestjs/config';
import { decodeSignature, detectMime, safeFileName } from '../documents/file-validation';
import { parseScannedCode } from '../qr/qr.service';
import { csvSafe, toCsv } from '../reports/report-renderers';
import { CryptoService, maskSecret } from './crypto/crypto.service';
import { sanitize, diff } from '../activity-logs/activity-log.service';

describe('CryptoService', () => {
  const config = { get: () => Buffer.alloc(32, 3).toString('base64') } as unknown as ConfigService;
  const crypto = new CryptoService(config as never);

  it('round-trips with a random IV and detects tampering', () => {
    const a = crypto.encrypt('ABCD-1234');
    const b = crypto.encrypt('ABCD-1234');
    expect(a).not.toBe(b);
    expect(crypto.decrypt(a)).toBe('ABCD-1234');
    const parts = a.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => crypto.decrypt(parts.join(':'))).toThrow();
  });

  it('masks secrets', () => {
    expect(maskSecret('ABCD-EFGH-WXYZ')).toBe('••••WXYZ');
    expect(maskSecret(null)).toBeNull();
  });
});

describe('file validation', () => {
  it('detects types from magic bytes only', () => {
    expect(detectMime(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectMime(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(detectMime(Buffer.from('MZ\x90\x00'))).toBeNull();
  });

  it('strips paths and unsafe characters from file names', () => {
    expect(safeFileName('..\\..\\windows/system32/evil<script>.pdf')).toBe('evil_script_.pdf');
  });

  it('accepts only real PNG signatures', () => {
    expect(() => decodeSignature('data:image/svg+xml;base64,PHN2Zz4=')).toThrow();
    expect(() =>
      decodeSignature(`data:image/png;base64,${Buffer.from('not png').toString('base64')}`),
    ).toThrow(/valid PNG/);
  });
});

describe('parseScannedCode', () => {
  const token = '3f2a8c1e-9b7d-4e21-8a55-0c1d2e3f4a5b';

  it('extracts the token from label URLs and bare UUIDs', () => {
    expect(parseScannedCode(`https://itam.example.com/qr/${token}`).token).toBe(token);
    expect(parseScannedCode(`http://localhost:3000/qr/${token.toUpperCase()}?x=1`).token).toBe(
      token,
    );
    expect(parseScannedCode(`  ${token} `).token).toBe(token);
  });

  it('treats anything else as a tag or serial', () => {
    expect(parseScannedCode('AST-000123')).toEqual({ text: 'AST-000123' });
  });
});

describe('report CSV', () => {
  it('neutralises spreadsheet formulas and escapes quotes', () => {
    expect(csvSafe('=1+1')).toBe("'=1+1");
    expect(csvSafe('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvSafe('Laptop')).toBe('Laptop');
    const csv = toCsv({
      type: 'assets',
      title: 'x',
      columns: [
        { key: 'a', label: 'Name' },
        { key: 'b', label: 'Cost', type: 'money' },
      ],
      rows: [{ a: 'He said "hi", =cmd', b: 12.5 }],
      total: 1,
      truncated: false,
      generatedAt: new Date().toISOString(),
      filters: {},
    }).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"He said ""hi"", =cmd",12.50');
  });
});

describe('activity log helpers', () => {
  it('redacts secrets recursively', () => {
    expect(
      sanitize({ email: 'a@b.c', password: 'x', nested: { refreshToken: 'y', licenseKey: 'z' } }),
    ).toEqual({
      email: 'a@b.c',
      password: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', licenseKey: '[REDACTED]' },
    });
  });

  it('diffs only changed fields, comparing dates by value', () => {
    const before = { name: 'A', date: new Date('2026-01-01'), notes: null };
    expect(diff(before, { name: 'A', date: new Date('2026-01-01') })).toBeNull();
    expect(diff(before, { name: 'B', notes: undefined })).toEqual({
      oldValues: { name: 'A' },
      newValues: { name: 'B' },
    });
  });
});
