import type { ExtractionContext, ExtractionSource, ResponseExtractor } from '../models';
import { resolveJsonPath } from '../shared/json-path';

/**
 * Resolves a JSON path against the successful response body only.
 * Prefers `body.json`; falls back to parsing `body.text` once.
 */
export class JsonPathExtractor implements ResponseExtractor {
  public readonly kind = 'json-path' as const;

  public extract(
    source: ExtractionSource,
    context: ExtractionContext,
  ):
    | { readonly found: true; readonly value: unknown }
    | { readonly found: false; readonly reason: string } {
    if (source.kind !== 'json-path') {
      return { found: false, reason: 'Extractor kind mismatch: expected json-path.' };
    }
    if (!context.result.success) {
      return {
        found: false,
        reason: 'No response body available for JSON path extraction.',
      };
    }

    const body = context.result.response.body;
    let root: unknown = body.json;
    if (root === undefined) {
      if (body.text === undefined || body.text.length === 0) {
        return {
          found: false,
          reason: 'Response body is not available as JSON.',
        };
      }
      try {
        root = JSON.parse(body.text) as unknown;
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : 'invalid JSON';
        return {
          found: false,
          reason: `Response body is not valid JSON: ${detail}`,
        };
      }
    }

    return resolveJsonPath(root, source.path);
  }
}
