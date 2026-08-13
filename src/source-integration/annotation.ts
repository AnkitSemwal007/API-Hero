import type { SourceAnnotation, SourceAnnotationSite } from './models';

const LINE_COMMENT = /^\s*\/\/\s*@api-hero(?:\s+|$)(.*)$/iu;
const HASH_COMMENT = /^\s*#\s*@api-hero(?:\s+|$)(.*)$/iu;
const JSDOC_API_HERO = /^\s*\*\s*@api-hero(?:\s+|$)(.*)$/iu;
const JSDOC_API_HERO_CAMEL = /^\s*\*\s*@apiHero(?:\s+|$)(.*)$/iu;
const BLOCK_OPEN_ANNOTATION =
  /^\s*\/\*\*?\s*@api-hero(?:\s+|$)(.*?)(?:\*\/\s*)?$/iu;

/**
 * Extracts explicit `@api-hero` annotation sites from source text.
 *
 * Only comment forms are recognized. Call sites such as `api.getUser()` never
 * produce a mapping on their own.
 */
export function parseSourceAnnotations(text: string): readonly SourceAnnotationSite[] {
  const lines = splitLines(text);
  const sites: SourceAnnotationSite[] = [];
  let pending: SourceAnnotation[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const parsed = parseAnnotationLine(line);
    if (parsed !== undefined) {
      pending.push(parsed);
      continue;
    }
    if (pending.length === 0) {
      continue;
    }
    if (isCommentOrBlank(line)) {
      continue;
    }
    sites.push({
      line: index,
      character: leadingWhitespace(line),
      annotations: pending,
    });
    pending = [];
  }

  return sites;
}

/** Parses a single comment line into an annotation, or `undefined`. */
export function parseAnnotationLine(line: string): SourceAnnotation | undefined {
  const match =
    LINE_COMMENT.exec(line) ??
    HASH_COMMENT.exec(line) ??
    JSDOC_API_HERO.exec(line) ??
    JSDOC_API_HERO_CAMEL.exec(line) ??
    BLOCK_OPEN_ANNOTATION.exec(line);
  if (match === null) {
    return undefined;
  }
  return parseAnnotationBody((match[1] ?? '').trim());
}

function parseAnnotationBody(body: string): SourceAnnotation | undefined {
  const trimmed = stripWrappingQuotes(body).trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const keyed = /^(request|name|id)\s*:\s*(.+)$/iu.exec(trimmed);
  if (keyed !== null) {
    const kind = keyed[1]!.toLowerCase() as SourceAnnotation['kind'];
    const value = stripWrappingQuotes(keyed[2]!.trim());
    if (value.length === 0) {
      return undefined;
    }
    return { kind, value };
  }
  if (looksLikeApiPath(trimmed)) {
    return { kind: 'request', value: trimmed };
  }
  return { kind: 'name', value: trimmed };
}

function looksLikeApiPath(value: string): boolean {
  const withoutLine = value.replace(/:\d+$/u, '');
  return withoutLine.toLowerCase().endsWith('.api');
}

function stripWrappingQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isCommentOrBlank(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
    return true;
  }
  if (trimmed.startsWith('/*') || trimmed.startsWith('*/') || trimmed === '*/') {
    return true;
  }
  return false;
}

function leadingWhitespace(line: string): number {
  const match = /^\s*/u.exec(line);
  return match?.[0]?.length ?? 0;
}

function splitLines(text: string): readonly string[] {
  return text.split(/\r?\n/u);
}
