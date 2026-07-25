/**
 * Coerces an extracted JSON/header/status value to a string suitable for
 * VariableWriter persistence (P1 §5.4).
 */
export function coerceExtractionValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}
