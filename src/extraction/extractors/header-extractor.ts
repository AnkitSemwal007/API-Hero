import type { ExtractionContext, ExtractionSource, ResponseExtractor } from '../models';

/**
 * Case-insensitive header lookup on a successful response.
 * Duplicate names are joined with `, `.
 */
export class HeaderExtractor implements ResponseExtractor {
  public readonly kind = 'header' as const;

  public extract(
    source: ExtractionSource,
    context: ExtractionContext,
  ):
    | { readonly found: true; readonly value: unknown }
    | { readonly found: false; readonly reason: string } {
    if (source.kind !== 'header') {
      return { found: false, reason: 'Extractor kind mismatch: expected header.' };
    }
    if (!context.result.success) {
      return {
        found: false,
        reason: 'No response headers available for header extraction.',
      };
    }

    const target = source.name.toLowerCase();
    const values: string[] = [];
    for (const header of context.result.response.headers) {
      if (header.name.toLowerCase() === target) {
        values.push(header.value);
      }
    }

    if (values.length === 0) {
      return {
        found: false,
        reason: `Header "${source.name}" was not found.`,
      };
    }

    return { found: true, value: values.join(', ') };
  }
}
