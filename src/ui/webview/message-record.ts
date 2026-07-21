/**
 * Narrows an unknown webview postMessage payload to a plain object record.
 * Arrays and null are rejected.
 */
export function isWebviewMessageRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
