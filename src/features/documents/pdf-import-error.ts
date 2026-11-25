export type PdfImportErrorCode =
  | 'empty-file'
  | 'not-pdf'
  | 'invalid-pdf'
  | 'password-required'
  | 'password-incorrect'
  | 'password-cancelled'
  | 'full-read-cancelled'
  | 'read-failed';

export class PdfImportError extends Error {
  readonly code: PdfImportErrorCode;

  constructor(code: PdfImportErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.code = code;
    this.name = 'PdfImportError';
  }
}

export function sanitizeText(
  value: unknown,
  limit = 500,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  })
    .join('')
    .trim();
  return cleaned ? cleaned.slice(0, limit) : null;
}
