import type { ExtractionContext, ExtractionSource, ResponseExtractor } from '../models';

/** Extracts `String(statusCode)` from a successful response. */
export class StatusExtractor implements ResponseExtractor {
  public readonly kind = 'status' as const;

  public extract(
    source: ExtractionSource,
    context: ExtractionContext,
  ):
    | { readonly found: true; readonly value: unknown }
    | { readonly found: false; readonly reason: string } {
    if (source.kind !== 'status') {
      return { found: false, reason: 'Extractor kind mismatch: expected status.' };
    }
    if (!context.result.success) {
      return {
        found: false,
        reason: 'No response status available for status extraction.',
      };
    }

    return {
      found: true,
      value: String(context.result.response.statusCode),
    };
  }
}
