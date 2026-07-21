/**
 * Maps a parsed `.api` document (+ source text) into RequestSourceDocument.
 * Used by the Custom Text Editor for single-request files only.
 *
 * Does not modify the parser. Disabled headers are recovered from `# Name: value`
 * comments; expect lines come from the shared assertion extractor.
 */

import { extractAssertionsForDocument } from '../assertions';
import {
  AstNodeType,
  parseApiDocument,
  type ApiDocument,
  type BodyNode,
  type CommentNode,
  type DirectiveNode,
  type RequestNode,
} from '../parser';
import { parseParameters, queryPart } from '../shared';
import type { HttpMethod } from '../types';
import { HTTP_METHODS } from '../types';
import { extractDocumentVariables } from '../variables';
import type {
  RequestSourceBody,
  RequestSourceDocument,
  RequestSourceHeader,
  RequestSourceQueryParam,
  RequestSourceVariable,
} from './models';

/** Result of projecting source/AST into the request-source model. */
export type ParseRequestSourceResult =
  | { readonly kind: 'single'; readonly document: RequestSourceDocument }
  | { readonly kind: 'empty' }
  | { readonly kind: 'multi'; readonly requestCount: number };

/**
 * Parses source text and projects a single-request document into
 * {@link RequestSourceDocument}. Multi-request and empty files are reported
 * without inventing a merged model.
 */
export function parseSourceToRequestDocument(
  sourceText: string,
  sourceId?: string,
): ParseRequestSourceResult {
  const parsed = parseApiDocument(sourceText, {
    ...(sourceId === undefined ? {} : { sourceId }),
  });
  return documentToRequestSource(parsed.ast, sourceText);
}

/**
 * Projects an already-parsed ApiDocument into RequestSourceDocument when the
 * file contains exactly one request.
 */
export function documentToRequestSource(
  document: ApiDocument,
  sourceText: string,
): ParseRequestSourceResult {
  const count = document.requests.length;
  if (count === 0) {
    return { kind: 'empty' };
  }
  if (count !== 1) {
    return { kind: 'multi', requestCount: count };
  }

  const request = document.requests[0]!;
  const name =
    directiveValue(document, request, 'name')?.trim() ||
    `${String(request.method).toUpperCase()} ${request.url.trim()}`;
  const description = directiveValue(document, request, 'description')?.trim();
  const authProfileId = directiveValue(document, request, 'auth')?.trim();
  const timeoutRaw = directiveValue(document, request, 'timeout')?.trim();
  const timeoutMs = parseTimeoutMs(timeoutRaw);

  const { baseUrl, queryParams } = splitUrlAndQuery(request.url);
  const headers = collectHeaders(request);
  const body = mapBody(request.body, headers);
  const expectLines = extractAssertionsForDocument(document, sourceText)[0]
    ?.lines.map((line) => line.text.trim())
    .filter((line) => line.length > 0);
  const variables = collectVariables(document);
  const comments = collectLeadingComments(document, request);

  const methodUpper = String(request.method).toUpperCase();
  const method = (
    HTTP_METHODS.includes(methodUpper as HttpMethod)
      ? methodUpper
      : 'GET'
  ) as HttpMethod;

  const model: RequestSourceDocument = {
    name,
    method,
    url: baseUrl.length > 0 ? baseUrl : request.url.trim(),
    ...(description !== undefined && description.length > 0
      ? { description }
      : {}),
    ...(authProfileId !== undefined && authProfileId.length > 0
      ? { authProfileId }
      : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(headers.length > 0 ? { headers } : {}),
    ...(queryParams.length > 0 ? { queryParams } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(expectLines !== undefined && expectLines.length > 0
      ? { expectLines }
      : {}),
    ...(variables.length > 0 ? { variables } : {}),
    ...(comments.length > 0 ? { comments } : {}),
  };

  return { kind: 'single', document: model };
}

function directiveValue(
  document: ApiDocument,
  request: RequestNode,
  name: string,
): string | undefined {
  return (
    findLastDirective(request.directives, name)?.value ??
    findLastDirective(document.directives, name)?.value
  );
}

function findLastDirective(
  directives: readonly DirectiveNode[],
  name: string,
): DirectiveNode | undefined {
  const target = name.toLowerCase();
  for (let index = directives.length - 1; index >= 0; index -= 1) {
    const directive = directives[index];
    if (directive === undefined) {
      continue;
    }
    const directiveName = (
      directive.knownName ?? directive.name.replace(/^@/u, '')
    ).toLowerCase();
    if (directiveName === target) {
      return directive;
    }
  }
  return undefined;
}

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function splitUrlAndQuery(rawUrl: string): {
  readonly baseUrl: string;
  readonly queryParams: readonly RequestSourceQueryParam[];
} {
  const url = rawUrl.trim();
  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const question = withoutHash.indexOf('?');
  const pathOnly =
    question >= 0 ? withoutHash.slice(0, question) : withoutHash;
  const query = queryPart(withoutHash);
  const queryParams = parseParameters(query).map((param) => ({
    name: decodeQueryComponent(param.name),
    value: decodeQueryComponent(param.value ?? ''),
    enabled: true as const,
  }));
  return {
    baseUrl: `${pathOnly}${hash}`,
    queryParams,
  };
}

function decodeQueryComponent(value: string): string {
  const plusAsSpace = value.replace(/\+/gu, ' ');
  if (plusAsSpace.startsWith('{{') && plusAsSpace.endsWith('}}')) {
    return plusAsSpace;
  }
  try {
    return decodeURIComponent(plusAsSpace);
  } catch {
    return plusAsSpace;
  }
}

function collectHeaders(request: RequestNode): RequestSourceHeader[] {
  type OrderedHeader = {
    readonly offset: number;
    readonly header: RequestSourceHeader;
  };
  const ordered: OrderedHeader[] = [];

  for (const comment of request.comments) {
    const disabled = parseDisabledHeaderComment(comment);
    if (disabled === undefined) {
      continue;
    }
    ordered.push({
      offset: comment.range.start.offset,
      header: disabled,
    });
  }

  for (const header of request.headers) {
    const name = header.name.trim();
    const value = header.value.trim();
    if (name.length === 0) {
      continue;
    }
    ordered.push({
      offset: header.range.start.offset,
      header: { name, value, enabled: true },
    });
  }

  ordered.sort((left, right) => left.offset - right.offset);
  return ordered.map((entry) => entry.header);
}

function parseDisabledHeaderComment(
  comment: CommentNode,
): RequestSourceHeader | undefined {
  const text = comment.text.trim();
  const match = /^([^:\s][^:]*):\s*(.*)$/u.exec(text);
  if (match === null) {
    return undefined;
  }
  const name = match[1]!.trim();
  if (name.length === 0 || /^expect\b/iu.test(name)) {
    return undefined;
  }
  return {
    name,
    value: (match[2] ?? '').trim(),
    enabled: false,
  };
}

function mapBody(
  body: BodyNode | undefined,
  headers: readonly RequestSourceHeader[],
): RequestSourceBody | undefined {
  if (body === undefined) {
    return { type: 'none' };
  }

  const contentType = findHeaderValue(headers, 'content-type');
  const media = mediaType(contentType);

  switch (body.type) {
    case AstNodeType.JsonBody:
      return {
        type: 'json',
        text: body.value.raw.trim().length > 0 ? body.value.raw : '{}',
      };
    case AstNodeType.TextBody:
      return { type: 'text', text: body.content };
    case AstNodeType.RawBody:
      if (media === 'application/x-www-form-urlencoded') {
        const fields = parseParameters(body.content, '&').map((field) => ({
          name: decodeQueryComponent(field.name),
          value: decodeQueryComponent(field.value ?? ''),
        }));
        return { type: 'form', fields };
      }
      if (media?.startsWith('text/') === true) {
        return { type: 'text', text: body.content };
      }
      return {
        type: 'raw',
        text: body.content,
        ...(contentType !== undefined && contentType.trim().length > 0
          ? { contentType: contentType.trim() }
          : {}),
      };
    case AstNodeType.MultipartBody: {
      const boundary = extractBoundary(contentType);
      return {
        type: 'multipart',
        ...(boundary !== undefined ? { boundary } : {}),
        fields: [{ name: 'field', value: body.content.trim() || 'value' }],
      };
    }
    case AstNodeType.BinaryBody:
      return {
        type: 'binary',
        ...(body.content.trim().length > 0
          ? { note: body.content.trim().slice(0, 120) }
          : {}),
      };
    default:
      return { type: 'none' };
  }
}

function findHeaderValue(
  headers: readonly RequestSourceHeader[],
  lowerName: string,
): string | undefined {
  for (let index = headers.length - 1; index >= 0; index -= 1) {
    const header = headers[index];
    if (
      header !== undefined &&
      header.enabled !== false &&
      header.name.trim().toLowerCase() === lowerName
    ) {
      return header.value;
    }
  }
  return undefined;
}

function mediaType(contentType: string | undefined): string | undefined {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase();
}

function extractBoundary(contentType: string | undefined): string | undefined {
  if (contentType === undefined) {
    return undefined;
  }
  const match = /;\s*boundary\s*=\s*([^;]+)/iu.exec(contentType);
  if (match === null) {
    return undefined;
  }
  return match[1]!.trim().replace(/^["']|["']$/gu, '');
}

function collectVariables(document: ApiDocument): RequestSourceVariable[] {
  const fromAdapter = extractDocumentVariables(document).definitions.map(
    (definition) => ({
      name: definition.name,
      value: definition.value,
      ...(definition.sensitive ? { sensitive: true as const } : {}),
    }),
  );
  if (fromAdapter.length > 0) {
    return fromAdapter;
  }

  // Fallback: request-scoped @variable when none are on the document.
  const variables: RequestSourceVariable[] = [];
  for (const request of document.requests) {
    for (const directive of request.directives) {
      const name = (
        directive.knownName ?? directive.name.replace(/^@/u, '')
      ).toLowerCase();
      if (name !== 'variable' && name !== 'sensitive-variable') {
        continue;
      }
      const equals = directive.value.indexOf('=');
      if (equals < 0) {
        continue;
      }
      const variableName = directive.value.slice(0, equals).trim();
      const value = directive.value.slice(equals + 1).trim();
      if (variableName.length === 0) {
        continue;
      }
      variables.push({
        name: variableName,
        value,
        ...(name === 'sensitive-variable' ? { sensitive: true as const } : {}),
      });
    }
  }
  return variables;
}

function collectLeadingComments(
  document: ApiDocument,
  request: RequestNode,
): string[] {
  const comments: string[] = [];
  for (const comment of document.comments) {
    if (comment.range.start.offset >= request.range.start.offset) {
      continue;
    }
    const text = comment.text.trim();
    if (text.length === 0) {
      continue;
    }
    if (parseDisabledHeaderComment(comment) !== undefined) {
      continue;
    }
    comments.push(text);
  }
  return comments;
}
