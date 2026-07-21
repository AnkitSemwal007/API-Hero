/**
 * Generates a single `.api` request source string from an OpenAPI operation.
 *
 * Maps the operation to a {@link RequestSourceDocument}, then serializes via
 * shared `serializeRequestDocument` (blank line before METHOD, query-in-URL,
 * headers, body). Scrubbing and import diagnostics stay in this module.
 */

import {
  serializeRequestDocument,
  type RequestSourceBody,
  type RequestSourceDocument,
  type RequestSourceHeader,
  type RequestSourceMethod,
  type RequestSourceQueryParam,
} from '../../request-source';
import type { ImportDiagnostic, ImportLimits } from '../models';
import { DEFAULT_IMPORT_LIMITS } from '../models';
import type { OpenApiRefResolver } from '../openapi/resolve';
import type {
  OpenApiDocument,
  OpenApiExampleOrRef,
  OpenApiHttpMethod,
  OpenApiMediaType,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSecurityRequirement,
} from '../openapi/types';
import { isReference } from '../openapi/types';
import {
  isSensitiveName,
  maskImportSecretText,
  placeholderForSensitiveName,
  scrubSensitiveExampleValue,
} from '../sanitize';
import { buildSchemaSample } from './schema-sample';

export interface RequestGenerationInput {
  readonly document: OpenApiDocument;
  readonly resolver: OpenApiRefResolver;
  readonly pathKey: string;
  readonly method: OpenApiHttpMethod;
  readonly pathItem: OpenApiPathItem;
  readonly operation: OpenApiOperation;
  readonly schemeToProfileId: ReadonlyMap<string, string>;
  readonly limits?: Partial<ImportLimits>;
}

export interface RequestGenerationResult {
  readonly content: string;
  readonly requestName: string;
  readonly diagnostics: readonly ImportDiagnostic[];
}

export function generateRequestSource(
  input: RequestGenerationInput,
): RequestGenerationResult {
  const diagnostics: ImportDiagnostic[] = [];
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...input.limits };
  const { operation, method, pathKey, resolver, schemeToProfileId } = input;

  const requestName =
    operation.operationId?.trim() ||
    operation.summary?.trim() ||
    `${method.toUpperCase()} ${pathKey}`;

  const comments: string[] = [];

  if (operation.operationId) {
    comments.push(`operationId: ${sanitizeComment(operation.operationId)}`);
  }
  if (operation.summary && operation.summary !== operation.operationId) {
    comments.push(`summary: ${sanitizeComment(operation.summary)}`);
  }
  if (operation.deprecated === true) {
    comments.push('deprecated: true');
  }
  if (operation.externalDocs?.url) {
    comments.push(`externalDocs: ${sanitizeComment(operation.externalDocs.url)}`);
  }

  appendResponseComments(operation, resolver, comments, diagnostics);

  const parameters = collectParameters(
    input.pathItem,
    operation,
    resolver,
    diagnostics,
  );

  for (const cookie of parameters.filter((item) => item.in === 'cookie')) {
    comments.push(
      `cookie ${cookie.name}={{${cookieVarName(cookie.name)}}}`,
    );
  }

  const headers: RequestSourceHeader[] = [];
  for (const header of parameters.filter((item) => item.in === 'header')) {
    headers.push({
      name: header.name,
      value: parameterValue(header),
      enabled: true,
    });
  }

  const queryParams: RequestSourceQueryParam[] = parameters
    .filter((item) => item.in === 'query')
    .map((item) => ({
      name: item.name,
      value: parameterValue(item),
      enabled: true,
    }));

  const bodyResult = generateBody(operation, resolver, limits, diagnostics);

  // Content-Type is owned by serializeRequestDocument. Only override when the
  // OpenAPI media type differs from the serializer default (e.g. problem+json).
  if (
    bodyResult.body?.type === 'json' &&
    bodyResult.contentType !== undefined &&
    bodyResult.contentType !== 'application/json'
  ) {
    const hasContentType = headers.some(
      (item) => item.name.toLowerCase() === 'content-type',
    );
    if (!hasContentType) {
      headers.push({
        name: 'Content-Type',
        value: bodyResult.contentType,
        enabled: true,
      });
    }
  }
  if (bodyResult.accept !== undefined) {
    const hasAccept = headers.some(
      (item) => item.name.toLowerCase() === 'accept',
    );
    if (!hasAccept) {
      headers.push({
        name: 'Accept',
        value: bodyResult.accept,
        enabled: true,
      });
    }
  }

  const authProfileId = pickAuthProfile(
    operation.security ?? input.document.security,
    schemeToProfileId,
  );

  const document: RequestSourceDocument = {
    name: singleLine(requestName),
    method: toRequestSourceMethod(method),
    url: buildPathUrl(pathKey),
    ...(operation.description
      ? { description: singleLine(operation.description) }
      : {}),
    ...(authProfileId !== undefined ? { authProfileId } : {}),
    ...(comments.length > 0 ? { comments } : {}),
    ...(headers.length > 0 ? { headers } : {}),
    ...(queryParams.length > 0 ? { queryParams } : {}),
    ...(bodyResult.body !== undefined ? { body: bodyResult.body } : {}),
  };

  return {
    content: serializeRequestDocument(document),
    requestName,
    diagnostics,
  };
}

function toRequestSourceMethod(method: OpenApiHttpMethod): RequestSourceMethod {
  return method.toUpperCase() as RequestSourceMethod;
}

function appendResponseComments(
  operation: OpenApiOperation,
  resolver: OpenApiRefResolver,
  comments: string[],
  diagnostics: ImportDiagnostic[],
): void {
  const responses = operation.responses;
  if (responses === undefined) {
    return;
  }
  for (const [status, responseOrRef] of Object.entries(responses)) {
    if (responseOrRef === undefined) {
      continue;
    }
    let response: OpenApiResponse | undefined;
    if (isReference(responseOrRef)) {
      const resolved = resolver.resolveRef<OpenApiResponse>(responseOrRef.$ref);
      diagnostics.push(...resolved.diagnostics);
      response = resolved.value;
    } else {
      response = responseOrRef;
    }
    const description = response?.description?.trim() ?? '';
    const contentTypes = response?.content
      ? Object.keys(response.content).join(', ')
      : '';
    const parts = [
      `response ${status}`,
      description.length > 0 ? description : undefined,
      contentTypes.length > 0 ? `content: ${contentTypes}` : undefined,
    ].filter((part): part is string => part !== undefined);
    comments.push(sanitizeComment(parts.join(' — ')));
  }
}

function collectParameters(
  pathItem: OpenApiPathItem,
  operation: OpenApiOperation,
  resolver: OpenApiRefResolver,
  diagnostics: ImportDiagnostic[],
): OpenApiParameter[] {
  const merged = new Map<string, OpenApiParameter>();
  const sources = [
    ...(pathItem.parameters ?? []),
    ...(operation.parameters ?? []),
  ];

  for (const item of sources) {
    let parameter: OpenApiParameter | undefined;
    if (isReference(item)) {
      const resolved = resolver.resolveRef<OpenApiParameter>(item.$ref);
      diagnostics.push(...resolved.diagnostics);
      parameter = resolved.value;
    } else {
      parameter = item;
    }
    if (
      parameter === undefined ||
      typeof parameter.name !== 'string' ||
      typeof parameter.in !== 'string'
    ) {
      continue;
    }
    merged.set(`${parameter.in}:${parameter.name}`, parameter);
  }

  return [...merged.values()];
}

/** Path URL with `{{baseUrl}}` and path-param templates (query applied by serialize). */
function buildPathUrl(pathKey: string): string {
  const path = pathKey.replace(
    /\{([^}]+)\}/gu,
    (_match, name: string) => `{{${pathVarName(name)}}}`,
  );
  return `{{baseUrl}}${path.startsWith('/') ? path : `/${path}`}`;
}

function parameterValue(parameter: OpenApiParameter): string {
  if (parameter.in === 'header' && isSensitiveName(parameter.name)) {
    return placeholderForSensitiveName(parameter.name);
  }
  if (parameter.in === 'cookie') {
    return `{{${cookieVarName(parameter.name)}}}`;
  }
  if (isSensitiveName(parameter.name)) {
    return placeholderForSensitiveName(parameter.name);
  }

  if (parameter.example !== undefined && parameter.example !== null) {
    return String(parameter.example);
  }
  if (parameter.examples !== undefined) {
    const first = firstExampleValue(parameter.examples);
    if (first !== undefined) {
      return String(first);
    }
  }
  if (parameter.in === 'path') {
    return `{{${pathVarName(parameter.name)}}}`;
  }
  if (parameter.in === 'query') {
    return `{{${queryVarName(parameter.name)}}}`;
  }
  if (parameter.in === 'header') {
    return `{{${headerVarName(parameter.name)}}}`;
  }
  return `{{${cookieVarName(parameter.name)}}}`;
}

function firstExampleValue(
  examples: Readonly<Record<string, OpenApiExampleOrRef | undefined>>,
): unknown {
  for (const example of Object.values(examples)) {
    if (example === undefined || isReference(example)) {
      continue;
    }
    if (example.value !== undefined) {
      return example.value;
    }
  }
  return undefined;
}

function generateBody(
  operation: OpenApiOperation,
  resolver: OpenApiRefResolver,
  limits: ImportLimits,
  diagnostics: ImportDiagnostic[],
): {
  readonly contentType?: string;
  readonly accept?: string;
  readonly body?: RequestSourceBody;
} {
  const accept = pickPreferredResponseContentType(operation, resolver);
  if (operation.requestBody === undefined) {
    return {
      ...(accept === undefined ? {} : { accept }),
    };
  }

  let requestBody: OpenApiRequestBody | undefined;
  if (isReference(operation.requestBody)) {
    const resolved = resolver.resolveRef<OpenApiRequestBody>(
      operation.requestBody.$ref,
    );
    diagnostics.push(...resolved.diagnostics);
    requestBody = resolved.value;
  } else {
    requestBody = operation.requestBody;
  }

  if (requestBody?.content === undefined) {
    return {
      ...(accept === undefined ? {} : { accept }),
    };
  }

  const media = pickMediaType(requestBody.content);
  if (media === undefined) {
    return {
      ...(accept === undefined ? {} : { accept }),
    };
  }

  const [contentType, mediaType] = media;
  const body = mediaTypeToBody(
    contentType,
    mediaType,
    resolver,
    limits,
    diagnostics,
  );
  return {
    contentType,
    ...(accept === undefined ? {} : { accept }),
    body,
  };
}

function pickMediaType(
  content: Readonly<Record<string, OpenApiMediaType | undefined>>,
): readonly [string, OpenApiMediaType] | undefined {
  const preferred = [
    'application/json',
    'application/problem+json',
    'text/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'application/xml',
    'text/plain',
  ];
  for (const type of preferred) {
    const media = content[type];
    if (media !== undefined) {
      return [type, media];
    }
  }
  const first = Object.entries(content).find(
    (entry): entry is [string, OpenApiMediaType] => entry[1] !== undefined,
  );
  return first;
}

function mediaTypeToBody(
  contentType: string,
  media: OpenApiMediaType,
  resolver: OpenApiRefResolver,
  limits: ImportLimits,
  diagnostics: ImportDiagnostic[],
): RequestSourceBody {
  if (media.example !== undefined) {
    return formatBody(contentType, scrubSensitiveExampleValue(media.example));
  }
  if (media.examples !== undefined) {
    const value = firstExampleValue(media.examples);
    if (value !== undefined) {
      return formatBody(contentType, scrubSensitiveExampleValue(value));
    }
  }

  if (contentType.includes('json')) {
    const sample = buildSchemaSample(media.schema, { resolver, limits });
    diagnostics.push(...sample.diagnostics);
    return formatBody(contentType, scrubSensitiveExampleValue(sample.value));
  }

  if (contentType.includes('xml')) {
    return {
      type: 'raw',
      contentType,
      text: [
        '<!-- TODO: replace with a real XML body from the OpenAPI schema -->',
        '<request />',
      ].join('\n'),
    };
  }

  if (contentType.includes('urlencoded')) {
    return {
      type: 'form',
      fields: [{ name: 'field', value: '{{fieldValue}}' }],
    };
  }

  if (contentType.includes('multipart')) {
    return {
      type: 'multipart',
      boundary: 'boundary',
      fields: [{ name: 'field', value: 'value' }],
    };
  }

  if (contentType.startsWith('text/')) {
    return { type: 'text', text: 'text body' };
  }

  return {
    type: 'binary',
    note: 'unsupported media type — add body manually',
  };
}

function formatBody(contentType: string, value: unknown): RequestSourceBody {
  if (contentType.includes('json')) {
    let text: string;
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = '{}';
    }
    return { type: 'json', text };
  }
  return {
    type: 'raw',
    contentType,
    text: String(value),
  };
}

function pickPreferredResponseContentType(
  operation: OpenApiOperation,
  resolver: OpenApiRefResolver,
): string | undefined {
  const success =
    operation.responses?.['200'] ??
    operation.responses?.['201'] ??
    operation.responses?.default;
  if (success === undefined) {
    return undefined;
  }
  let response: OpenApiResponse | undefined;
  if (isReference(success)) {
    response = resolver.resolveRef<OpenApiResponse>(success.$ref).value;
  } else {
    response = success;
  }
  const content = response?.content;
  if (content === undefined) {
    return undefined;
  }
  if (content['application/json'] !== undefined) {
    return 'application/json';
  }
  return Object.keys(content)[0];
}

function pickAuthProfile(
  security: readonly OpenApiSecurityRequirement[] | undefined,
  schemeToProfileId: ReadonlyMap<string, string>,
): string | undefined {
  if (security === undefined || security.length === 0) {
    return undefined;
  }
  // Empty requirement object means optional auth — skip @auth.
  for (const requirement of security) {
    const names = Object.keys(requirement);
    if (names.length === 0) {
      return undefined;
    }
    for (const name of names) {
      const profileId = schemeToProfileId.get(name);
      if (profileId !== undefined) {
        return profileId;
      }
    }
  }
  return undefined;
}

function sanitizeComment(value: string): string {
  return maskImportSecretText(value.replace(/[\r\n]+/gu, ' ').trim());
}

function singleLine(value: string): string {
  return sanitizeComment(value);
}

function pathVarName(name: string): string {
  return sanitizeVar(name);
}

function queryVarName(name: string): string {
  return sanitizeVar(name);
}

function headerVarName(name: string): string {
  return sanitizeVar(name.replace(/-/gu, '_'));
}

function cookieVarName(name: string): string {
  return sanitizeVar(name);
}

function sanitizeVar(name: string): string {
  const cleaned = name.replace(/[^\w.-]/gu, '_');
  return /^[A-Za-z_]/u.test(cleaned) ? cleaned : `param_${cleaned}`;
}
