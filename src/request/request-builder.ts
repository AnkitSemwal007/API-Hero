import {
  AstNodeType,
  type ApiDocument,
  type DirectiveNode,
  type LiteralNode,
  type RequestNode,
  type ValidationResult,
  type VariableNode,
} from '../parser';
import type {
  HttpMethod,
  RuntimeBody,
  RuntimeDirective,
  RuntimeHeader,
  RuntimeJsonValue,
  RuntimeRequest,
  RuntimeVariablePlaceholder,
} from '../models';
import { HTTP_METHOD_SET, deepFreeze, parseParameters, queryPart } from '../shared';

export type RequestBuilderErrorCode =
  | 'REQUEST_COUNT'
  | 'INVALID_REQUEST'
  | 'INVALID_DIRECTIVE'
  | 'INVALID_VALIDATION'
  | 'UNSUPPORTED_BODY';

/** Base error for runtime-domain programming and invariant failures. */
export class RuntimeDomainError extends Error {}

/** Base error for failures while projecting a document into runtime values. */
export class RequestBuildError extends RuntimeDomainError {
  public constructor(
    public readonly code: RequestBuilderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RequestBuildError';
  }
}

/**
 * Compatibility base for callers that previously caught RequestBuilderError.
 */
export class RequestBuilderError extends RequestBuildError {
  public constructor(
    code: RequestBuilderErrorCode,
    message: string,
  ) {
    super(code, message);
    this.name = 'RequestBuilderError';
  }
}

/** Signals a violated builder precondition or canonical AST invariant. */
export class BuilderInvariantError extends RequestBuilderError {
  public constructor(code: RequestBuilderErrorCode, message: string) {
    super(code, message);
    this.name = 'BuilderInvariantError';
  }
}

/** Reserved for future execution attempts with unresolved runtime state. */
export class InvalidRuntimeStateError extends RuntimeDomainError {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidRuntimeStateError';
  }
}

/**
 * Builds the only request in a semantically valid canonical document.
 *
 * @throws {RequestBuildError} when the document does not contain exactly one
 * request or violates an invariant guaranteed by semantic validation.
 */
export function buildRequest(
  document: ApiDocument,
  validation?: ValidationResult,
): RuntimeRequest {
  assertValidationPrecondition(validation);
  if (document.requests.length !== 1) {
    throw new BuilderInvariantError(
      'REQUEST_COUNT',
      `buildRequest requires exactly one request declaration; received ${document.requests.length}. Use buildRequests for an explicitly multi-request document.`,
    );
  }
  return buildRequestNode(document, document.requests[0]!, 0);
}

/**
 * Builds every request in source order from a semantically valid document.
 * The returned collection and every nested runtime value are deeply frozen.
 */
export function buildRequests(
  document: ApiDocument,
  validation?: ValidationResult,
): readonly RuntimeRequest[] {
  assertValidationPrecondition(validation);
  const requests = document.requests.map((request, index) =>
    buildRequestNode(document, request, index),
  );
  return deepFreeze(requests);
}

/**
 * Builds one canonical request selected from a parsed document.
 *
 * This avoids projecting unrelated requests while preserving source-order IDs
 * and document-level directives.
 */
export function buildSelectedRequest(
  document: ApiDocument,
  request: RequestNode,
  validation?: ValidationResult,
): RuntimeRequest {
  assertValidationPrecondition(validation);
  const index = document.requests.indexOf(request);
  if (index < 0) {
    throw new BuilderInvariantError(
      'INVALID_REQUEST',
      'Selected request must belong to the canonical document.',
    );
  }
  return buildRequestNode(document, request, index);
}

function buildRequestNode(
  document: ApiDocument,
  node: RequestNode,
  index: number,
): RuntimeRequest {
  assertValidRequestNode(node);
  const directives = [
    ...document.directives.map(toRuntimeDirective),
    ...node.directives.map(toRuntimeDirective),
  ];
  const name = effectiveDirective(document, node, 'name')?.value;
  const description = effectiveDirective(document, node, 'description')?.value;
  const timeout = effectiveDirective(document, node, 'timeout');
  const authentication = effectiveDirective(document, node, 'auth');
  const connection = effectiveDirective(document, node, 'connection');
  const headers = node.headers.map<RuntimeHeader>((header) => ({
    name: header.name.trim(),
    value: header.value.trim(),
  }));
  const contentType = findHeaderValue(headers, 'content-type');
  const body = node.body === undefined
    ? undefined
    : buildBody(node.body, contentType);

  const url = node.url.trim();
  const request: RuntimeRequest = {
    id: requestId(document, index),
    ...(name === undefined ? {} : { name: name.trim() }),
    method: String(node.method).toUpperCase() as HttpMethod,
    url,
    headers,
    queryParameters: parseParameters(queryPart(url)),
    pathParameters: parsePathParameters(url),
    cookies: [],
    ...(body === undefined ? {} : { body }),
    bodyType: body?.type ?? 'none',
    authentication: authentication === undefined
      ? { kind: 'none', extensions: {} }
      : {
          kind: 'unresolved',
          reference: authentication.value.trim(),
          extensions: {},
        },
    variables: buildVariables(document, node),
    environment: connection === undefined
      ? { kind: 'none', extensions: {} }
      : {
          kind: 'unresolved',
          reference: connection.value.trim(),
          extensions: {},
        },
    metadata: {
      ...(document.sourceId === undefined ? {} : { sourceId: document.sourceId }),
      declarationIndex: index,
      ...(description === undefined ? {} : { description: description.trim() }),
      tags: [
        ...directiveValues(document.directives, 'tag'),
        ...directiveValues(node.directives, 'tag'),
      ],
      extensions: {},
    },
    ...(timeout === undefined
      ? {}
      : { timeoutMs: parseTimeout(timeout.value) }),
    redirectPolicy: { mode: 'follow' },
    ssl: {
      verifyCertificates: true,
      extensions: {},
    },
    configuration: {
      ...(connection === undefined
        ? {}
        : { connectionReference: connection.value.trim() }),
      directives,
      extensions: {},
    },
    executionExtensions: {},
  };
  return deepFreeze(request);
}

function assertValidRequestNode(node: RequestNode): void {
  if (!HTTP_METHOD_SET.has(String(node.method).toUpperCase()) || node.url.trim().length === 0) {
    throw new BuilderInvariantError(
      'INVALID_REQUEST',
      'Request builder received an invalid method or empty URL. Semantic validation must succeed before request construction.',
    );
  }
}

function buildBody(
  body: RequestNode['body'] & {},
  contentType: string | undefined,
): RuntimeBody {
  switch (body.type) {
    case AstNodeType.JsonBody:
      return {
        type: 'json',
        content: body.value.raw,
        value: literalValue(body.value),
      };
    case AstNodeType.TextBody:
      return { type: 'text', content: body.content };
    case AstNodeType.RawBody:
      if (mediaType(contentType) === 'application/x-www-form-urlencoded') {
        return {
          type: 'form',
          content: body.content,
          fields: parseParameters(body.content, '&'),
        };
      }
      if (mediaType(contentType)?.startsWith('text/') === true) {
        return { type: 'text', content: body.content };
      }
      return { type: 'raw', content: body.content };
    case AstNodeType.MultipartBody:
      return { type: 'multipart', content: body.content, parts: [] };
    case AstNodeType.BinaryBody:
      return { type: 'binary', content: body.content };
    default:
      throw new BuilderInvariantError(
        'UNSUPPORTED_BODY',
        `Request builder received an unsupported body type: ${String((body as { type?: unknown }).type)}.`,
      );
  }
}

function literalValue(node: LiteralNode): RuntimeJsonValue {
  switch (node.type) {
    case AstNodeType.StringLiteral:
    case AstNodeType.NumberLiteral:
    case AstNodeType.BooleanLiteral:
    case AstNodeType.NullLiteral:
      return node.value;
    case AstNodeType.ArrayLiteral:
      return node.elements.map(literalValue);
    case AstNodeType.ObjectLiteral: {
      const value: Record<string, RuntimeJsonValue> = {};
      for (const property of node.properties) {
        Object.defineProperty(value, property.key.value, {
          value: literalValue(property.value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return value;
    }
  }
}

function effectiveDirective(
  document: ApiDocument,
  request: RequestNode,
  name: string,
): DirectiveNode | undefined {
  return (
    findLastDirective(request.directives, name) ??
    findLastDirective(document.directives, name)
  );
}

function findLastDirective(
  directives: readonly DirectiveNode[],
  name: string,
): DirectiveNode | undefined {
  for (let index = directives.length - 1; index >= 0; index -= 1) {
    const directive = directives[index];
    if (directive !== undefined && directiveName(directive) === name) {
      return directive;
    }
  }
  return undefined;
}

function directiveValues(
  directives: readonly DirectiveNode[],
  name: string,
): readonly string[] {
  return directives
    .filter((directive) => directiveName(directive) === name)
    .map((directive) => directive.value.trim());
}

function toRuntimeDirective(directive: DirectiveNode): RuntimeDirective {
  return {
    name: directiveName(directive),
    value: directive.value.trim(),
  };
}

function directiveName(directive: DirectiveNode): string {
  return (directive.knownName ?? directive.name.replace(/^@/, '')).toLowerCase();
}

function parseTimeout(value: string): number {
  const timeout = Number(value.trim());
  if (!Number.isSafeInteger(timeout) || timeout < 0) {
    throw new BuilderInvariantError(
      'INVALID_DIRECTIVE',
      'Request builder received an invalid @timeout value. Semantic validation must succeed before request construction.',
    );
  }
  return timeout;
}

function findHeaderValue(
  headers: readonly RuntimeHeader[],
  lowerCaseName: string,
): string | undefined {
  for (let index = headers.length - 1; index >= 0; index -= 1) {
    const header = headers[index];
    if (header?.name.toLowerCase() === lowerCaseName) {
      return header.value;
    }
  }
  return undefined;
}

function mediaType(contentType: string | undefined): string | undefined {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase();
}

function parsePathParameters(url: string): readonly RuntimeVariablePlaceholder[] {
  const pathEnd = firstDelimiter(url, ['?', '#']);
  const pathAndAuthority = url.slice(0, pathEnd);
  const path = pathPart(pathAndAuthority);
  return [...path.matchAll(/\{\{([^{}]+)\}\}/gu)].map((match) => ({
    name: match[1]!,
    originalText: match[0],
  }));
}

function pathPart(url: string): string {
  const scheme = /^[A-Za-z][A-Za-z\d+.-]*:\/\//u.exec(url);
  const authorityStart = scheme?.[0].length ?? (url.startsWith('//') ? 2 : -1);
  if (authorityStart < 0) {
    return url;
  }
  const pathStart = url.indexOf('/', authorityStart);
  return pathStart < 0 ? '' : url.slice(pathStart);
}

function firstDelimiter(value: string, delimiters: readonly string[]): number {
  const indexes = delimiters
    .map((delimiter) => value.indexOf(delimiter))
    .filter((index) => index >= 0);
  return indexes.length === 0 ? value.length : Math.min(...indexes);
}

function buildVariables(
  document: ApiDocument,
  request: RequestNode,
): readonly RuntimeVariablePlaceholder[] {
  const bodyVariables =
    request.body?.type === AstNodeType.RawBody ||
    request.body?.type === AstNodeType.TextBody
      ? request.body.variables
      : [];
  const variables = [
    ...document.directives.flatMap((directive) => directive.variables),
    ...request.variables,
    ...request.directives.flatMap((directive) => directive.variables),
    ...bodyVariables,
  ];
  return [...variables]
    .sort((left, right) => sourceOffset(left) - sourceOffset(right))
    .map((variable) => ({
      name: variable.name,
      originalText: variable.originalText,
    }));
}

function sourceOffset(variable: VariableNode): number {
  return variable.range.start.offset;
}

function requestId(document: ApiDocument, index: number): string {
  return `${document.sourceId ?? 'document'}#request-${index + 1}`;
}

function assertValidationPrecondition(
  validation: ValidationResult | undefined,
): void {
  if (validation?.valid === false) {
    throw new BuilderInvariantError(
      'INVALID_VALIDATION',
      'Request builder received a failed semantic validation result. Resolve diagnostics before request construction.',
    );
  }
}
