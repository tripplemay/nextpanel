export const XHTTP_MODES = ['auto', 'packet-up', 'stream-up', 'stream-one'] as const;
export type XhttpMode = typeof XHTTP_MODES[number];

export const XHTTP_EXTRA_MAX_BYTES = 16 * 1024;

export function parseXhttpMode(value: string | null | undefined): XhttpMode | null {
  const normalized = value || 'auto';
  return (XHTTP_MODES as readonly string[]).includes(normalized)
    ? normalized as XhttpMode
    : null;
}

export function parseXhttpHost(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('XHTTP host contains invalid characters');
  }
  return value;
}

export function parseXhttpExtra(value: string | null | undefined): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (Buffer.byteLength(value, 'utf8') > XHTTP_EXTRA_MAX_BYTES) {
    throw new Error(`XHTTP extra exceeds ${XHTTP_EXTRA_MAX_BYTES} bytes`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('XHTTP extra must be valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('XHTTP extra must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}
