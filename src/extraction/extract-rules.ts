import type { ApiDocument } from '../parser';
import type { ExtractionRule } from './models';
import { parseExtractDirective } from './parse-extract';

export interface RequestExtractionRules {
  readonly requestIndex: number;
  readonly rules: readonly ExtractionRule[];
  readonly malformed: readonly string[];
}

export interface ExtractExtractionRulesOptions {
  readonly sourceId?: string;
}

/**
 * Associates `@extract` / `@sensitive-extract` directives with each request.
 *
 * Prefer request-attached directives on {@link RequestNode.directives}.
 * Document-level extract directives are included when their `requestBlock`
 * matches the request's block (same association used for block-scoped
 * directives such as `@name`).
 */
export function extractExtractionRulesForDocument(
  document: ApiDocument,
  _sourceText: string,
  _options?: ExtractExtractionRulesOptions,
): readonly RequestExtractionRules[] {
  void _sourceText;
  void _options;
  return document.requests.map((request, requestIndex) => {
    const block = readRequestBlock(request.metadata.requestBlock, requestIndex);
    const directives = [
      ...document.directives.filter(
        (directive) =>
          isExtractDirective(directive.knownName) &&
          readRequestBlock(directive.metadata.requestBlock, 0) === block,
      ),
      ...request.directives.filter((directive) =>
        isExtractDirective(directive.knownName),
      ),
    ].sort(
      (left, right) => left.range.start.offset - right.range.start.offset,
    );

    const rules: ExtractionRule[] = [];
    const malformed: string[] = [];
    let ordinal = 0;
    for (const directive of directives) {
      const knownName = directive.knownName as 'extract' | 'sensitive-extract';
      ordinal += 1;
      const sourceText = `@${knownName} ${directive.value}`.trim();
      const parsed = parseExtractDirective({
        knownName,
        value: directive.value,
        sourceText,
        id: `extract_${requestIndex}_${ordinal}`,
      });
      if (parsed.ok) {
        rules.push(parsed.rule);
      } else {
        malformed.push(parsed.reason);
      }
    }

    return Object.freeze({
      requestIndex,
      rules: Object.freeze(rules),
      malformed: Object.freeze(malformed),
    });
  });
}

/**
 * Extracts rules for the request whose range (or post-range gap until the next
 * request) contains `offset`.
 */
export function extractExtractionRulesForOffset(
  document: ApiDocument,
  sourceText: string,
  offset: number,
  options?: ExtractExtractionRulesOptions,
): { readonly rules: readonly ExtractionRule[]; readonly malformed: readonly string[] } | undefined {
  const all = extractExtractionRulesForDocument(document, sourceText, options);
  for (let index = 0; index < document.requests.length; index += 1) {
    const request = document.requests[index]!;
    const nextStart =
      index + 1 < document.requests.length
        ? document.requests[index + 1]!.range.start.offset
        : sourceText.length;
    if (offset >= request.range.start.offset && offset < nextStart) {
      const entry = all[index]!;
      return Object.freeze({
        rules: entry.rules,
        malformed: entry.malformed,
      });
    }
  }

  // Cursor in leading document directives for the first request block.
  if (document.requests.length > 0) {
    const first = document.requests[0]!;
    if (offset < first.range.start.offset) {
      const entry = all[0]!;
      return Object.freeze({
        rules: entry.rules,
        malformed: entry.malformed,
      });
    }
  }

  return undefined;
}

function isExtractDirective(
  knownName: string | undefined,
): knownName is 'extract' | 'sensitive-extract' {
  return knownName === 'extract' || knownName === 'sensitive-extract';
}

function readRequestBlock(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}
