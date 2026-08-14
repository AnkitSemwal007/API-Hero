/**
 * Framework-free Quick Run: detect a `fetch("https://...")` call under the
 * cursor, match method + concrete URL against the catalog, and synthesize
 * `.api` text for temporary runs.
 *
 * Does not execute JavaScript. Identifier URLs/bodies and interpolated
 * template strings fail closed. Does not expand `{{variables}}` when matching.
 */

import { serializeRequestDocument } from '../request-source';
import type {
  RequestSourceBody,
  RequestSourceDocument,
  RequestSourceHeader,
} from '../request-source';
import { HTTP_METHODS, type HttpMethod } from '../types';
import type { CatalogRequest } from './models';
import type { SourceIntegrationCatalog } from './catalog';

/**
 * Non-file URI for unsaved Quick Run executions. History rerun of a Quick Run
 * may not reopen the original source file — that is acceptable.
 */
export const QUICK_RUN_SOURCE_ID = 'untitled:api-hero-quick-run.api';

export interface DetectedFetchCall {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: readonly RequestSourceHeader[];
  readonly body?: RequestSourceBody;
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

export type CatalogMethodUrlMatch =
  | { readonly kind: 'unique'; readonly request: CatalogRequest }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly requests: readonly CatalogRequest[] };

/** Detects the `fetch(` call under `offset`, or `undefined` when none. */
export function detectFetchAtCursor(
  text: string,
  offset: number,
): DetectedFetchCall | undefined {
  const calls = findFetchCalls(text);
  const selected = selectCallAtCursor(calls, text, offset);
  if (selected === undefined) {
    return undefined;
  }
  return parseFetchCall(text, selected);
}

/**
 * Matches exact HTTP method + normalized concrete http(s) URL.
 * GraphQL/WebSocket catalog entries and unparseable URLs (e.g. `{{baseUrl}}/x`)
 * never match. Variables are not expanded.
 */
export function matchCatalogByMethodAndUrl(
  catalog: SourceIntegrationCatalog,
  method: string,
  url: string,
): CatalogMethodUrlMatch {
  const normalizedUrl = normalizeConcreteHttpUrl(url);
  const normalizedMethod = method.trim().toUpperCase();
  if (normalizedUrl === undefined) {
    return { kind: 'none' };
  }
  const matches = catalog.requests.filter((request) => {
    if (!isHttpCatalogProtocol(request.protocol)) {
      return false;
    }
    if (request.method.trim().toUpperCase() !== normalizedMethod) {
      return false;
    }
    return normalizeConcreteHttpUrl(request.url) === normalizedUrl;
  });
  if (matches.length === 0) {
    return { kind: 'none' };
  }
  if (matches.length === 1) {
    return { kind: 'unique', request: matches[0]! };
  }
  return { kind: 'ambiguous', requests: matches };
}

/**
 * Lowercases the host, strips default ports and a trailing slash (except `/`),
 * keeps the query string. Returns `undefined` when the URL is not an absolute
 * `http:` / `https:` URL.
 */
export function normalizeConcreteHttpUrl(url: string): string | undefined {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }
  const protocol = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const isDefaultPort =
    parsed.port === '' ||
    (protocol === 'http:' && parsed.port === '80') ||
    (protocol === 'https:' && parsed.port === '443');
  const port = isDefaultPort ? '' : `:${parsed.port}`;
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return `${protocol}//${host}${port}${path}${parsed.search}`;
}

export function requestNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter((part) => part.length > 0);
    const last = segments[segments.length - 1];
    if (last !== undefined && last.length > 0) {
      try {
        return decodeURIComponent(last);
      } catch {
        return last;
      }
    }
    return parsed.hostname.length > 0 ? parsed.hostname : 'Request';
  } catch {
    return 'Request';
  }
}

export function requestDocumentFromDetectedFetch(
  detected: DetectedFetchCall,
): RequestSourceDocument {
  return {
    name: detected.name,
    method: detected.method,
    url: detected.url,
    ...(detected.headers.length > 0 ? { headers: detected.headers } : {}),
    ...(detected.body !== undefined && detected.body.type !== 'none'
      ? { body: detected.body }
      : {}),
  };
}

export function serializeDetectedFetch(detected: DetectedFetchCall): string {
  return serializeRequestDocument(requestDocumentFromDetectedFetch(detected));
}

interface FetchCallSpan {
  readonly start: number;
  readonly open: number;
  readonly end: number;
}

function findFetchCalls(text: string): readonly FetchCallSpan[] {
  const calls: FetchCallSpan[] = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith('//', index)) {
      index = skipLineComment(text, index);
      continue;
    }
    if (text.startsWith('/*', index)) {
      index = skipBlockComment(text, index);
      continue;
    }
    const quote = quoteAt(text, index);
    if (quote !== undefined) {
      index = skipQuoted(text, index);
      continue;
    }
    if (isFetchKeywordAt(text, index)) {
      const start = index;
      const open = skipTrivia(text, index + 5);
      if (text[open] === '(') {
        const close = skipBalanced(text, open);
        if (close !== undefined) {
          calls.push({ start, open, end: close });
          index = close + 1;
          continue;
        }
      }
    }
    index += 1;
  }
  return calls;
}

function isFetchKeywordAt(text: string, index: number): boolean {
  if (text.slice(index, index + 5) !== 'fetch') {
    return false;
  }
  const previous = index === 0 ? '' : text[index - 1] ?? '';
  if (previous.length > 0 && isIdentChar(previous)) {
    return false;
  }
  const after = text[index + 5];
  if (after !== undefined && isIdentChar(after)) {
    return false;
  }
  const next = skipTrivia(text, index + 5);
  return text[next] === '(';
}

function selectCallAtCursor(
  calls: readonly FetchCallSpan[],
  text: string,
  offset: number,
): FetchCallSpan | undefined {
  if (calls.length === 0 || !Number.isSafeInteger(offset) || offset < 0) {
    return undefined;
  }
  const inSpan = calls.filter(
    (call) => offset >= call.start && offset <= call.end,
  );
  if (inSpan.length === 1) {
    return inSpan[0];
  }
  if (inSpan.length > 1) {
    return inSpan.reduce((smallest, call) =>
      call.end - call.start < smallest.end - smallest.start ? call : smallest,
    );
  }
  const onLine = calls.filter((call) => {
    const line = lineBounds(text, call.start);
    return offset >= line.start && offset <= line.end;
  });
  if (onLine.length === 0) {
    return undefined;
  }
  if (onLine.length === 1) {
    return onLine[0];
  }
  return onLine.reduce((closest, call) => {
    const distance = distanceToSpan(offset, call.start, call.end);
    const closestDistance = distanceToSpan(offset, closest.start, closest.end);
    return distance < closestDistance ? call : closest;
  });
}

function parseFetchCall(
  text: string,
  span: FetchCallSpan,
): DetectedFetchCall | undefined {
  const args = splitTopLevelArgs(text.slice(span.open + 1, span.end));
  if (args.length === 0) {
    return undefined;
  }
  const url = parseUrlLiteral(args[0]!);
  if (url === undefined) {
    return undefined;
  }
  const options = args.length > 1 ? parseOptionsObject(args[1]!) : undefined;
  if (args.length > 1 && options === undefined) {
    return undefined;
  }
  if (options?.methodInvalid === true) {
    return undefined;
  }
  const method = options?.method ?? 'GET';
  const headers = options?.headers ?? [];
  const body = options?.body;
  return {
    method,
    url,
    headers,
    ...(body !== undefined ? { body } : {}),
    name: requestNameFromUrl(url),
    start: span.start,
    end: span.end,
  };
}

function parseUrlLiteral(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.startsWith('`')) {
    return undefined;
  }
  const parsed = parseStringLiteral(trimmed, 0);
  if (parsed === undefined || skipTrivia(trimmed, parsed.end) !== trimmed.length) {
    return undefined;
  }
  const url = parsed.value.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return undefined;
  }
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return url;
}

interface ParsedFetchOptions {
  readonly method?: HttpMethod;
  readonly methodInvalid?: boolean;
  readonly headers?: readonly RequestSourceHeader[];
  readonly body?: RequestSourceBody;
}

function parseOptionsObject(raw: string): ParsedFetchOptions | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }
  const close = skipBalanced(trimmed, 0);
  if (close === undefined) {
    return undefined;
  }
  const afterObject = skipTrivia(trimmed, close + 1);
  if (
    afterObject !== trimmed.length &&
    !isTypeScriptAssertionSuffix(trimmed, afterObject)
  ) {
    return undefined;
  }
  let method: HttpMethod | undefined;
  let methodInvalid = false;
  let headers: readonly RequestSourceHeader[] | undefined;
  let body: RequestSourceBody | undefined;
  let index = skipTrivia(trimmed, 1);
  while (index < close) {
    index = skipTrivia(trimmed, index);
    if (index >= close || trimmed[index] === '}') {
      break;
    }
    if (trimmed[index] === ',') {
      index += 1;
      continue;
    }
    const key = parsePropertyKey(trimmed, index);
    if (key === undefined) {
      index = skipExpression(trimmed, index, close);
      continue;
    }
    index = skipTrivia(trimmed, key.end);
    if (trimmed[index] !== ':') {
      index = skipExpression(trimmed, index, close);
      continue;
    }
    index = skipTrivia(trimmed, index + 1);
    const name = key.name.toLowerCase();
    if (name === 'method') {
      const literal = parseStringLiteral(trimmed, index);
      if (literal !== undefined) {
        const parsedMethod = httpMethodFromLiteral(literal.value);
        if (parsedMethod === undefined) {
          methodInvalid = true;
        } else {
          method = parsedMethod;
        }
        index = literal.end;
      } else {
        methodInvalid = true;
        index = skipExpression(trimmed, index, close);
      }
      continue;
    }
    if (name === 'headers') {
      const parsedHeaders = parseHeadersObject(trimmed, index);
      if (parsedHeaders !== undefined) {
        headers = parsedHeaders.headers;
        index = parsedHeaders.end;
      } else {
        index = skipExpression(trimmed, index, close);
      }
      continue;
    }
    if (name === 'body') {
      const parsedBody = parseBodyValue(trimmed, index);
      if (parsedBody !== undefined) {
        if (parsedBody.body !== undefined) {
          body = parsedBody.body;
        }
        index = parsedBody.end;
      } else {
        index = skipExpression(trimmed, index, close);
      }
      continue;
    }
    index = skipExpression(trimmed, index, close);
  }
  return {
    ...(method !== undefined ? { method } : {}),
    ...(methodInvalid ? { methodInvalid: true } : {}),
    ...(headers !== undefined ? { headers } : {}),
    ...(body !== undefined ? { body } : {}),
  };
}

function httpMethodFromLiteral(value: string): HttpMethod | undefined {
  const upper = value.trim().toUpperCase();
  return HTTP_METHODS.includes(upper as HttpMethod)
    ? (upper as HttpMethod)
    : undefined;
}

/** Allows trailing `as const`, `as Type`, or `satisfies Type` after `{ ... }`. */
function isTypeScriptAssertionSuffix(text: string, start: number): boolean {
  const asConst = readKeyword(text, start, 'as');
  if (asConst !== undefined) {
    const ident = readIdent(text, skipTrivia(text, asConst));
    if (ident === undefined) {
      return false;
    }
    return skipTrivia(text, ident.end) === text.length;
  }
  const satisfies = readKeyword(text, start, 'satisfies');
  if (satisfies === undefined) {
    return false;
  }
  const ident = readIdent(text, skipTrivia(text, satisfies));
  if (ident === undefined) {
    return false;
  }
  return skipTrivia(text, ident.end) === text.length;
}

function readKeyword(
  text: string,
  start: number,
  keyword: string,
): number | undefined {
  const ident = readIdent(text, start);
  if (ident === undefined || ident.name !== keyword) {
    return undefined;
  }
  return ident.end;
}

function parseHeadersObject(
  text: string,
  start: number,
): { readonly headers: readonly RequestSourceHeader[]; readonly end: number } | undefined {
  if (text[start] !== '{') {
    return undefined;
  }
  const close = skipBalanced(text, start);
  if (close === undefined) {
    return undefined;
  }
  const headers: RequestSourceHeader[] = [];
  let index = skipTrivia(text, start + 1);
  while (index < close) {
    index = skipTrivia(text, index);
    if (index >= close || text[index] === '}') {
      break;
    }
    if (text[index] === ',') {
      index += 1;
      continue;
    }
    const key = parsePropertyKey(text, index);
    if (key === undefined) {
      index = skipExpression(text, index, close);
      continue;
    }
    index = skipTrivia(text, key.end);
    if (text[index] !== ':') {
      index = skipExpression(text, index, close);
      continue;
    }
    index = skipTrivia(text, index + 1);
    const value = parseStringLiteral(text, index);
    if (value !== undefined) {
      headers.push({ name: key.name, value: value.value });
      index = value.end;
      continue;
    }
    index = skipExpression(text, index, close);
  }
  return { headers, end: close + 1 };
}

function parseBodyValue(
  text: string,
  start: number,
): { readonly body?: RequestSourceBody; readonly end: number } | undefined {
  const stringLiteral = parseStringLiteral(text, start);
  if (stringLiteral !== undefined) {
    return {
      body: { type: 'text', text: stringLiteral.value },
      end: stringLiteral.end,
    };
  }
  const stringify = parseJsonStringifyCall(text, start);
  if (stringify !== undefined) {
    return {
      ...(stringify.json !== undefined
        ? { body: { type: 'json' as const, text: stringify.json } }
        : {}),
      end: stringify.end,
    };
  }
  return undefined;
}

function parseJsonStringifyCall(
  text: string,
  start: number,
): { readonly json?: string; readonly end: number } | undefined {
  const jsonIdent = readIdent(text, start);
  if (jsonIdent?.name !== 'JSON') {
    return undefined;
  }
  let index = skipTrivia(text, jsonIdent.end);
  if (text[index] !== '.') {
    return undefined;
  }
  index = skipTrivia(text, index + 1);
  const stringifyIdent = readIdent(text, index);
  if (stringifyIdent?.name !== 'stringify') {
    return undefined;
  }
  index = skipTrivia(text, stringifyIdent.end);
  if (text[index] !== '(') {
    return undefined;
  }
  const close = skipBalanced(text, index);
  if (close === undefined) {
    return undefined;
  }
  const inner = text.slice(index + 1, close).trim();
  const json = objectOrArrayLiteralToJson(inner);
  return {
    ...(json !== undefined ? { json } : {}),
    end: close + 1,
  };
}

function objectOrArrayLiteralToJson(source: string): string | undefined {
  if (source.length === 0) {
    return undefined;
  }
  const parsed = parseJsonLikeValue(source, 0);
  if (parsed === undefined) {
    return undefined;
  }
  if (skipTrivia(source, parsed.end) !== source.length) {
    return undefined;
  }
  if (
    typeof parsed.value !== 'object' ||
    parsed.value === null
  ) {
    return undefined;
  }
  return JSON.stringify(parsed.value, null, 2);
}

function parseJsonLikeValue(
  text: string,
  start: number,
): { readonly value: unknown; readonly end: number } | undefined {
  const index = skipTrivia(text, start);
  if (text[index] === '{') {
    return parseJsonLikeObject(text, index);
  }
  if (text[index] === '[') {
    return parseJsonLikeArray(text, index);
  }
  const stringLiteral = parseStringLiteral(text, index);
  if (stringLiteral !== undefined) {
    return { value: stringLiteral.value, end: stringLiteral.end };
  }
  const keyword = readIdent(text, index);
  if (keyword !== undefined) {
    if (keyword.name === 'true') {
      return { value: true, end: keyword.end };
    }
    if (keyword.name === 'false') {
      return { value: false, end: keyword.end };
    }
    if (keyword.name === 'null') {
      return { value: null, end: keyword.end };
    }
    return undefined;
  }
  const number = parseJsonNumber(text, index);
  if (number !== undefined) {
    return number;
  }
  return undefined;
}

function parseJsonLikeObject(
  text: string,
  start: number,
): { readonly value: Record<string, unknown>; readonly end: number } | undefined {
  if (text[start] !== '{') {
    return undefined;
  }
  const result: Record<string, unknown> = {};
  let index = skipTrivia(text, start + 1);
  while (index < text.length) {
    index = skipTrivia(text, index);
    if (text[index] === '}') {
      return { value: result, end: index + 1 };
    }
    if (text[index] === ',') {
      index += 1;
      continue;
    }
    const key = parsePropertyKey(text, index);
    if (key === undefined) {
      return undefined;
    }
    index = skipTrivia(text, key.end);
    if (text[index] !== ':') {
      return undefined;
    }
    const parsed = parseJsonLikeValue(text, index + 1);
    if (parsed === undefined) {
      return undefined;
    }
    result[key.name] = parsed.value;
    index = skipTrivia(text, parsed.end);
    if (text[index] === ',') {
      index += 1;
      continue;
    }
    if (text[index] === '}') {
      return { value: result, end: index + 1 };
    }
    return undefined;
  }
  return undefined;
}

function parseJsonLikeArray(
  text: string,
  start: number,
): { readonly value: unknown[]; readonly end: number } | undefined {
  if (text[start] !== '[') {
    return undefined;
  }
  const result: unknown[] = [];
  let index = skipTrivia(text, start + 1);
  while (index < text.length) {
    index = skipTrivia(text, index);
    if (text[index] === ']') {
      return { value: result, end: index + 1 };
    }
    if (text[index] === ',') {
      index += 1;
      continue;
    }
    const parsed = parseJsonLikeValue(text, index);
    if (parsed === undefined) {
      return undefined;
    }
    result.push(parsed.value);
    index = skipTrivia(text, parsed.end);
    if (text[index] === ',') {
      index += 1;
      continue;
    }
    if (text[index] === ']') {
      return { value: result, end: index + 1 };
    }
    return undefined;
  }
  return undefined;
}

function parseJsonNumber(
  text: string,
  start: number,
): { readonly value: number; readonly end: number } | undefined {
  const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(start));
  if (match === null) {
    return undefined;
  }
  const raw = match[0] ?? '';
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return { value, end: start + raw.length };
}

function parsePropertyKey(
  text: string,
  start: number,
): { readonly name: string; readonly end: number } | undefined {
  const stringKey = parseStringLiteral(text, start);
  if (stringKey !== undefined) {
    return { name: stringKey.value, end: stringKey.end };
  }
  return readIdent(text, start);
}

function parseStringLiteral(
  text: string,
  start: number,
): { readonly value: string; readonly end: number } | undefined {
  const quote = text[start];
  if (quote !== '"' && quote !== "'") {
    return undefined;
  }
  let index = start + 1;
  let value = '';
  while (index < text.length) {
    const char = text[index] ?? '';
    if (char === quote) {
      return { value, end: index + 1 };
    }
    if (char === '\n' || char === '\r') {
      return undefined;
    }
    if (char === '\\') {
      const escaped = unescapeChar(text, index + 1);
      if (escaped === undefined) {
        return undefined;
      }
      value += escaped.value;
      index = escaped.end;
      continue;
    }
    value += char;
    index += 1;
  }
  return undefined;
}

function unescapeChar(
  text: string,
  start: number,
): { readonly value: string; readonly end: number } | undefined {
  const char = text[start];
  if (char === undefined) {
    return undefined;
  }
  switch (char) {
    case 'n':
      return { value: '\n', end: start + 1 };
    case 'r':
      return { value: '\r', end: start + 1 };
    case 't':
      return { value: '\t', end: start + 1 };
    case '0':
      return { value: '\0', end: start + 1 };
    case '\\':
    case "'":
    case '"':
    case '`':
      return { value: char, end: start + 1 };
    case 'x': {
      const hex = text.slice(start + 1, start + 3);
      if (!/^[0-9a-fA-F]{2}$/u.test(hex)) {
        return undefined;
      }
      return { value: String.fromCharCode(Number.parseInt(hex, 16)), end: start + 3 };
    }
    case 'u': {
      const hex = text.slice(start + 1, start + 5);
      if (!/^[0-9a-fA-F]{4}$/u.test(hex)) {
        return undefined;
      }
      return { value: String.fromCharCode(Number.parseInt(hex, 16)), end: start + 5 };
    }
    default:
      return { value: char, end: start + 1 };
  }
}

function readIdent(
  text: string,
  start: number,
): { readonly name: string; readonly end: number } | undefined {
  const first = text[start];
  if (first === undefined || !isIdentStart(first)) {
    return undefined;
  }
  let end = start + 1;
  while (end < text.length && isIdentChar(text[end] ?? '')) {
    end += 1;
  }
  return { name: text.slice(start, end), end };
}

function splitTopLevelArgs(source: string): readonly string[] {
  const args: string[] = [];
  let start = 0;
  let index = 0;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  while (index < source.length) {
    if (source.startsWith('//', index)) {
      index = skipLineComment(source, index);
      continue;
    }
    if (source.startsWith('/*', index)) {
      index = skipBlockComment(source, index);
      continue;
    }
    const quote = quoteAt(source, index);
    if (quote !== undefined) {
      index = skipQuoted(source, index);
      continue;
    }
    const char = source[index] ?? '';
    if (char === '(') {
      paren += 1;
    } else if (char === ')') {
      paren -= 1;
    } else if (char === '{') {
      brace += 1;
    } else if (char === '}') {
      brace -= 1;
    } else if (char === '[') {
      bracket += 1;
    } else if (char === ']') {
      bracket -= 1;
    } else if (
      char === ',' &&
      paren === 0 &&
      brace === 0 &&
      bracket === 0
    ) {
      args.push(source.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  const last = source.slice(start);
  if (last.trim().length > 0 || args.length > 0) {
    args.push(last);
  }
  return args;
}

function skipExpression(text: string, start: number, limit: number): number {
  let index = start;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  while (index < limit) {
    if (text.startsWith('//', index)) {
      index = skipLineComment(text, index);
      continue;
    }
    if (text.startsWith('/*', index)) {
      index = skipBlockComment(text, index);
      continue;
    }
    const quote = quoteAt(text, index);
    if (quote !== undefined) {
      index = skipQuoted(text, index);
      continue;
    }
    const char = text[index] ?? '';
    if (
      (char === ',' || char === '}' || char === ']') &&
      paren === 0 &&
      brace === 0 &&
      bracket === 0
    ) {
      return index;
    }
    if (char === '(') {
      paren += 1;
    } else if (char === ')') {
      paren -= 1;
    } else if (char === '{') {
      brace += 1;
    } else if (char === '}') {
      brace -= 1;
    } else if (char === '[') {
      bracket += 1;
    } else if (char === ']') {
      bracket -= 1;
    }
    index += 1;
  }
  return index;
}

function skipBalanced(text: string, openIndex: number): number | undefined {
  const open = text[openIndex];
  const close =
    open === '(' ? ')' : open === '{' ? '}' : open === '[' ? ']' : undefined;
  if (close === undefined) {
    return undefined;
  }
  let depth = 1;
  let index = openIndex + 1;
  while (index < text.length) {
    if (text.startsWith('//', index)) {
      index = skipLineComment(text, index);
      continue;
    }
    if (text.startsWith('/*', index)) {
      index = skipBlockComment(text, index);
      continue;
    }
    const quote = quoteAt(text, index);
    if (quote !== undefined) {
      index = skipQuoted(text, index);
      continue;
    }
    if (text[index] === open) {
      depth += 1;
      index += 1;
      continue;
    }
    if (text[index] === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
      index += 1;
      continue;
    }
    index += 1;
  }
  return undefined;
}

function skipQuoted(text: string, start: number): number {
  const quote = text[start];
  if (quote === '`') {
    return skipTemplate(text, start);
  }
  if (quote !== '"' && quote !== "'") {
    return start + 1;
  }
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] === quote) {
      return index + 1;
    }
    if (text[index] === '\n') {
      return index;
    }
    index += 1;
  }
  return text.length;
}

function skipTemplate(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] === '`') {
      return index + 1;
    }
    if (text[index] === '$' && text[index + 1] === '{') {
      const close = skipBalanced(text, index + 1);
      index = close === undefined ? text.length : close + 1;
      continue;
    }
    index += 1;
  }
  return text.length;
}

function skipTrivia(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const char = text[index] ?? '';
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }
    if (text.startsWith('//', index)) {
      index = skipLineComment(text, index);
      continue;
    }
    if (text.startsWith('/*', index)) {
      index = skipBlockComment(text, index);
      continue;
    }
    break;
  }
  return index;
}

function skipLineComment(text: string, start: number): number {
  const newline = text.indexOf('\n', start);
  return newline === -1 ? text.length : newline + 1;
}

function skipBlockComment(text: string, start: number): number {
  const close = text.indexOf('*/', start + 2);
  return close === -1 ? text.length : close + 2;
}

function quoteAt(text: string, index: number): string | undefined {
  const char = text[index];
  return char === '"' || char === "'" || char === '`' ? char : undefined;
}

function isIdentStart(char: string): boolean {
  return /[A-Za-z_$]/u.test(char);
}

function isIdentChar(char: string): boolean {
  return /[A-Za-z0-9_$]/u.test(char);
}

function lineBounds(text: string, offset: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const newline = text.indexOf('\n', offset);
  return { start, end: newline === -1 ? text.length : newline };
}

function distanceToSpan(offset: number, start: number, end: number): number {
  if (offset >= start && offset <= end) {
    return 0;
  }
  if (offset < start) {
    return start - offset;
  }
  return offset - end;
}

function isHttpCatalogProtocol(protocol: string | undefined): boolean {
  const value = (protocol ?? 'http').trim().toLowerCase();
  return value.length === 0 || value === 'http';
}
