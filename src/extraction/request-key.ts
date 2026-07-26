/**
 * Stable request identity for runtime overlay lookups and extraction writes.
 * Must match between orchestrator, ExtractionObserver, and getVariableContext.
 */
export function requestKeyFor(sourceId: string, index: number): string {
  return `request:${sourceId}#${index}`;
}

/**
 * Parses {@link requestKeyFor} output. Uses the last `#` so `sourceId` may
 * contain `#` characters (rare path edge cases).
 */
export function parseRequestKey(
  requestKey: string,
): { readonly sourceId: string; readonly index: number } | undefined {
  if (!requestKey.startsWith('request:')) {
    return undefined;
  }
  const rest = requestKey.slice('request:'.length);
  const hash = rest.lastIndexOf('#');
  if (hash < 0) {
    return undefined;
  }
  const index = Number(rest.slice(hash + 1));
  if (!Number.isInteger(index) || index < 0) {
    return undefined;
  }
  return { sourceId: rest.slice(0, hash), index };
}
