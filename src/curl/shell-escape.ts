/**
 * POSIX single-quote shell escaping for cURL argument values.
 * Escapes `'` as `'\''` (end quote, escaped quote, reopen quote).
 */
export function posixSingleQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}
