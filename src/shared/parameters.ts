/** Name/value pair produced by query or form field parsing. */
export interface ParsedParameter {
  readonly name: string;
  readonly value?: string;
}

/** Returns the raw query substring of a URL, excluding `?` and any fragment. */
export function queryPart(url: string): string | undefined {
  const question = url.indexOf('?');
  if (question < 0) {
    return undefined;
  }
  const hash = url.indexOf('#', question + 1);
  return url.slice(question + 1, hash < 0 ? undefined : hash);
}

/**
 * Splits a query or form body into ordered name/value pairs without decoding.
 * Entries without `=` keep only a name; empty sources yield an empty list.
 */
export function parseParameters(
  source: string | undefined,
  separator = '&',
): readonly ParsedParameter[] {
  if (source === undefined || source.length === 0) {
    return [];
  }
  return source.split(separator).map((entry) => {
    const equals = entry.indexOf('=');
    return equals < 0
      ? { name: entry }
      : { name: entry.slice(0, equals), value: entry.slice(equals + 1) };
  });
}
