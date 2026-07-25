import type { ExtractionSourceKind, ExtractorRegistry, ResponseExtractor } from '../models';
import { HeaderExtractor } from './header-extractor';
import { JsonPathExtractor } from './json-path-extractor';
import { StatusExtractor } from './status-extractor';

/** Registers the three built-in response extractors (P1 §5.5). */
export function createDefaultExtractorRegistry(): ExtractorRegistry {
  const extractors: ResponseExtractor[] = [
    new JsonPathExtractor(),
    new HeaderExtractor(),
    new StatusExtractor(),
  ];
  const byKind = new Map<ExtractionSourceKind, ResponseExtractor>();
  for (const extractor of extractors) {
    byKind.set(extractor.kind, extractor);
  }
  return {
    get(kind: ExtractionSourceKind): ResponseExtractor | undefined {
      return byKind.get(kind);
    },
  };
}
