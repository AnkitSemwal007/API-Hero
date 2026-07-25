/**
 * Stable request identity for runtime overlay lookups and extraction writes.
 * Must match between orchestrator, ExtractionObserver, and getVariableContext.
 */
export function requestKeyFor(sourceId: string, index: number): string {
  return `request:${sourceId}#${index}`;
}
