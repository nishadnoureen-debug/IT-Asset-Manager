export const ALLOWED_UPLOAD_TYPES = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;
export type AllowedMime = keyof typeof ALLOWED_UPLOAD_TYPES;

/**
 * Detect the real file type from magic bytes — the client-supplied MIME type and extension are never
 * trusted.
 */
export function detectMime(buffer: Buffer): AllowedMime | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Strip path components and unsafe characters from an uploaded file name. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^\w.\- ()]/g, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || 'file').slice(0, 200);
}

/** Decode a `data:image/png;base64,...` signature captured by the signature pad. */
export function decodeSignature(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('Signature must be a PNG data URL');
  const buffer = Buffer.from(match[1], 'base64');
  if (detectMime(buffer) !== 'image/png') throw new Error('Signature is not a valid PNG');
  if (buffer.length > 512 * 1024) throw new Error('Signature image is too large');
  return buffer;
}
