/**
 * Maps an Insomnia request resource to a RequestSourceDocument and serialized `.api`.
 */

import {
  serializeRequestDocument,
  type RequestSourceBody,
  type RequestSourceDocument,
  type RequestSourceHeader,
  type RequestSourceMethod,
  type RequestSourceQueryParam,
} from '../../request-source';
import { HTTP_METHODS } from '../../types';
import type { ImportDiagnostic } from '../models';
import {
  isSensitiveName,
  maskImportSecretText,
  placeholderForSensitiveName,
  scrubSensitiveExampleValue,
} from '../sanitize';
import { sanitizeHeaderValue } from './map-auth';
import { isPlainObject } from './parse';
import { rewriteInsomniaEnvRefs } from './map-variables';
import type { InsomniaResourceLike } from './types';

export interface MapRequestInput {
  readonly name: string;
  readonly resource: InsomniaResourceLike;
  readonly description?: string;
  readonly authProfileId?: string;
  readonly path: string;
}

export interface MapRequestResult {
  readonly content: string;
  readonly requestName: string;
  readonly method: RequestSourceMethod;
  readonly diagnostics: readonly ImportDiagnostic[];
}

const METHOD_SET = new Set<string>(HTTP_METHODS);

/**
 * Converts one Insomnia request resource into serialized `.api` source.
 */
export function mapInsomniaRequest(input: MapRequestInput): MapRequestResult {
  const diagnostics: ImportDiagnostic[] = [];
  const requestName =
    input.name.trim().length > 0 ? singleLine(input.name) : 'Untitled Request';
  const resource = input.resource;

  const method = normalizeMethod(resource.method);
  let envRefRewriteCount = 0;
  const noteEnvRewrites = (count: number): void => {
    envRefRewriteCount += count;
  };

  const urlResult = mapUrl(
    resource.url,
    resource.parameters,
    `${input.path}/url`,
    noteEnvRewrites,
  );
  diagnostics.push(...urlResult.diagnostics);

  const headers = mapHeaders(
    resource.headers,
    `${input.path}/headers`,
    diagnostics,
    noteEnvRewrites,
  );
  const bodyResult = mapBody(
    resource.body,
    `${input.path}/body`,
    noteEnvRewrites,
  );
  diagnostics.push(...bodyResult.diagnostics);

  if (envRefRewriteCount > 0) {
    diagnostics.push({
      code: 'insomnia-env-ref-rewritten',
      severity: 'info',
      path: input.path,
      message: maskImportSecretText(
        `Rewrote ${envRefRewriteCount} Insomnia {{ _.var }} reference(s) to {{var}} for API Hero substitution.`,
      ),
    });
  }

  // Scripts — never execute; report only.
  for (const diag of collectScriptDiagnostics(resource, input.path, requestName)) {
    diagnostics.push(diag);
  }

  const comments: string[] = [];
  if (bodyResult.comment !== undefined) {
    comments.push(bodyResult.comment);
  }

  const description =
    input.description?.trim() ||
    (typeof resource.description === 'string'
      ? resource.description.trim()
      : undefined) ||
    undefined;

  const filteredHeaders =
    bodyResult.body !== undefined &&
    (bodyResult.body.type === 'json' ||
      bodyResult.body.type === 'form' ||
      bodyResult.body.type === 'multipart' ||
      bodyResult.body.type === 'text')
      ? headers.filter((h) => h.name.toLowerCase() !== 'content-type')
      : headers;

  const document: RequestSourceDocument = {
    name: requestName,
    method,
    url: urlResult.url,
    ...(description !== undefined
      ? { description: singleLine(description) }
      : {}),
    ...(input.authProfileId !== undefined
      ? { authProfileId: input.authProfileId }
      : {}),
    ...(comments.length > 0 ? { comments } : {}),
    ...(filteredHeaders.length > 0 ? { headers: filteredHeaders } : {}),
    ...(urlResult.queryParams.length > 0
      ? { queryParams: urlResult.queryParams }
      : {}),
    ...(bodyResult.body !== undefined ? { body: bodyResult.body } : {}),
  };

  return {
    content: serializeRequestDocument(document),
    requestName,
    method,
    diagnostics,
  };
}

/** Detects pre-request / after-response scripts on a request resource. */
export function collectScriptDiagnostics(
  resource: InsomniaResourceLike,
  path: string,
  scopeLabel: string,
): readonly ImportDiagnostic[] {
  const diagnostics: ImportDiagnostic[] = [];
  const pre = resource.preRequestScript;
  const after = resource.afterResponseScript;
  if (typeof pre === 'string' && pre.trim().length > 0) {
    diagnostics.push({
      code: 'insomnia-unsupported-script',
      severity: 'warning',
      path: `${path}/preRequestScript`,
      message: maskImportSecretText(
        `"${scopeLabel}" has an Insomnia pre-request script that was not imported (scripts are never executed or migrated).`,
      ),
    });
  }
  if (typeof after === 'string' && after.trim().length > 0) {
    diagnostics.push({
      code: 'insomnia-unsupported-script',
      severity: 'warning',
      path: `${path}/afterResponseScript`,
      message: maskImportSecretText(
        `"${scopeLabel}" has an Insomnia after-response script that was not imported (scripts are never executed or migrated).`,
      ),
    });
  }
  return diagnostics;
}

function normalizeMethod(raw: unknown): RequestSourceMethod {
  const method =
    typeof raw === 'string' ? raw.trim().toUpperCase() : 'GET';
  if (METHOD_SET.has(method)) {
    return method as RequestSourceMethod;
  }
  return 'GET';
}

function mapUrl(
  rawUrl: unknown,
  parameters: unknown,
  path: string,
  noteEnvRewrites: (count: number) => void,
): {
  readonly url: string;
  readonly queryParams: readonly RequestSourceQueryParam[];
  readonly diagnostics: readonly ImportDiagnostic[];
} {
  const diagnostics: ImportDiagnostic[] = [];
  const queryParams: RequestSourceQueryParam[] = [];

  let url =
    typeof rawUrl === 'string' && rawUrl.trim().length > 0
      ? stripQuery(rawUrl.trim())
      : '';

  if (url.length === 0) {
    diagnostics.push({
      code: 'insomnia-invalid-url',
      severity: 'warning',
      path,
      message: 'Request URL missing or malformed; using {{baseUrl}}/.',
    });
    url = '{{baseUrl}}/';
  } else {
    const rewritten = rewriteInsomniaEnvRefs(url);
    noteEnvRewrites(rewritten.rewriteCount);
    url = rewritten.value;
    if (typeof rawUrl === 'string' && rawUrl.includes('?')) {
      // Prefer structured parameters when present; else parse from raw.
      if (!Array.isArray(parameters)) {
        queryParams.push(...parseQueryFromRaw(rawUrl, noteEnvRewrites));
      }
    }
  }

  if (Array.isArray(parameters)) {
    queryParams.push(...mapParameterArray(parameters, noteEnvRewrites));
  }

  return { url, queryParams, diagnostics };
}

function mapParameterArray(
  raw: unknown[],
  noteEnvRewrites: (count: number) => void,
): RequestSourceQueryParam[] {
  const result: RequestSourceQueryParam[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const name =
      typeof entry.name === 'string'
        ? entry.name.trim()
        : typeof entry.key === 'string'
          ? entry.key.trim()
          : '';
    if (name.length === 0 || name === '__proto__') {
      continue;
    }
    const valueRaw =
      typeof entry.value === 'string'
        ? entry.value
        : entry.value === null || entry.value === undefined
          ? ''
          : String(entry.value);
    result.push({
      name,
      value: isSensitiveName(name)
        ? placeholderForSensitiveName(name)
        : rewriteMappedText(valueRaw, noteEnvRewrites),
      enabled: entry.disabled !== true,
    });
  }
  return result;
}

function parseQueryFromRaw(
  rawUrl: string,
  noteEnvRewrites: (count: number) => void,
): RequestSourceQueryParam[] {
  const withoutHash = rawUrl.split('#')[0] ?? rawUrl;
  const q = withoutHash.indexOf('?');
  if (q < 0) {
    return [];
  }
  const query = withoutHash.slice(q + 1);
  if (query.length === 0) {
    return [];
  }
  const result: RequestSourceQueryParam[] = [];
  for (const part of query.split('&')) {
    if (part.length === 0) {
      continue;
    }
    const eq = part.indexOf('=');
    const name = eq >= 0 ? decodeSafe(part.slice(0, eq)) : decodeSafe(part);
    const value = eq >= 0 ? decodeSafe(part.slice(eq + 1)) : '';
    if (name.length === 0) {
      continue;
    }
    result.push({
      name,
      value: isSensitiveName(name)
        ? placeholderForSensitiveName(name)
        : rewriteMappedText(value, noteEnvRewrites),
      enabled: true,
    });
  }
  return result;
}

function stripQuery(rawUrl: string): string {
  const hashIndex = rawUrl.indexOf('#');
  const hash = hashIndex >= 0 ? rawUrl.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? rawUrl.slice(0, hashIndex) : rawUrl;
  const q = withoutHash.indexOf('?');
  const base = q >= 0 ? withoutHash.slice(0, q) : withoutHash;
  return `${base}${hash}`;
}

function mapHeaders(
  raw: unknown,
  path: string,
  diagnostics: ImportDiagnostic[],
  noteEnvRewrites: (count: number) => void,
): RequestSourceHeader[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    diagnostics.push({
      code: 'insomnia-invalid-headers',
      severity: 'warning',
      path,
      message: 'Ignoring malformed header list.',
    });
    return [];
  }
  const result: RequestSourceHeader[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const name =
      typeof entry.name === 'string'
        ? entry.name.trim()
        : typeof entry.key === 'string'
          ? entry.key.trim()
          : '';
    if (name.length === 0 || name === '__proto__') {
      continue;
    }
    const valueRaw =
      typeof entry.value === 'string'
        ? entry.value
        : entry.value === null || entry.value === undefined
          ? ''
          : String(entry.value);
    result.push({
      name,
      value: sanitizeHeaderValue(
        name,
        rewriteMappedText(valueRaw, noteEnvRewrites),
      ),
      enabled: entry.disabled !== true,
    });
  }
  return result;
}

function mapBody(
  raw: unknown,
  path: string,
  noteEnvRewrites: (count: number) => void,
): {
  readonly body?: RequestSourceBody;
  readonly comment?: string;
  readonly diagnostics: readonly ImportDiagnostic[];
} {
  const diagnostics: ImportDiagnostic[] = [];
  if (raw === undefined || raw === null) {
    return { diagnostics };
  }
  if (!isPlainObject(raw)) {
    diagnostics.push({
      code: 'insomnia-invalid-body',
      severity: 'warning',
      path,
      message: 'Ignoring malformed request body.',
    });
    return { diagnostics };
  }

  const mimeType =
    typeof raw.mimeType === 'string' ? raw.mimeType.trim().toLowerCase() : '';
  const text = typeof raw.text === 'string' ? raw.text : '';
  const params = Array.isArray(raw.params) ? raw.params : undefined;

  if (
    mimeType.includes('application/json') ||
    (mimeType.length === 0 && looksLikeJson(text))
  ) {
    if (text.trim().length === 0) {
      return { diagnostics };
    }
    return {
      body: {
        type: 'json',
        text: scrubJsonBody(text, noteEnvRewrites),
      },
      diagnostics,
    };
  }

  if (
    mimeType.includes('application/x-www-form-urlencoded') ||
    mimeType.includes('urlencoded')
  ) {
    return {
      body: {
        type: 'form',
        fields: mapFormFields(params, noteEnvRewrites),
      },
      diagnostics,
    };
  }

  if (mimeType.includes('multipart/form-data')) {
    if (params) {
      for (const entry of params) {
        if (
          isPlainObject(entry) &&
          (entry.type === 'file' || entry.fileName !== undefined)
        ) {
          diagnostics.push({
            code: 'insomnia-unsupported-body',
            severity: 'warning',
            path,
            message:
              'multipart file parts are imported as text stubs (binary upload not migrated).',
          });
          break;
        }
      }
    }
    return {
      body: {
        type: 'multipart',
        fields: mapFormFields(params, noteEnvRewrites),
      },
      diagnostics,
    };
  }

  if (mimeType.includes('graphql') || mimeType.includes('application/graphql')) {
    diagnostics.push({
      code: 'insomnia-unsupported-graphql',
      severity: 'warning',
      path,
      message:
        'GraphQL request body is not fully supported; imported as raw JSON stub when possible.',
    });
    if (text.trim().length > 0) {
      if (looksLikeJson(text)) {
        return {
          body: {
            type: 'json',
            text: scrubJsonBody(text, noteEnvRewrites),
          },
          comment: 'Imported from Insomnia GraphQL body (best-effort).',
          diagnostics,
        };
      }
      return {
        body: {
          type: 'raw',
          text: scrubRawTextBody(text, noteEnvRewrites),
          contentType: mimeType,
        },
        comment: 'Imported from Insomnia GraphQL body (best-effort).',
        diagnostics,
      };
    }
    return { diagnostics };
  }

  if (
    mimeType.includes('application/octet-stream') ||
    mimeType.startsWith('image/') ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/')
  ) {
    diagnostics.push({
      code: 'insomnia-unsupported-body',
      severity: 'warning',
      path,
      message: 'Binary body is not imported; placeholder comment only.',
    });
    return {
      body: { type: 'binary', note: 'Insomnia binary body was not imported.' },
      diagnostics,
    };
  }

  if (text.trim().length > 0) {
    if (mimeType.includes('text/plain') || mimeType === 'text') {
      return {
        body: {
          type: 'text',
          text: scrubRawTextBody(text, noteEnvRewrites),
        },
        diagnostics,
      };
    }
    return {
      body: {
        type: 'raw',
        text: scrubRawTextBody(text, noteEnvRewrites),
        ...(mimeType.length > 0 ? { contentType: mimeType } : {}),
      },
      diagnostics,
    };
  }

  if (params !== undefined && params.length > 0) {
    return {
      body: {
        type: 'form',
        fields: mapFormFields(params, noteEnvRewrites),
      },
      diagnostics,
    };
  }

  return { diagnostics };
}

function mapFormFields(
  raw: unknown[] | undefined,
  noteEnvRewrites: (count: number) => void,
): readonly { readonly name: string; readonly value: string }[] {
  if (raw === undefined) {
    return [];
  }
  const fields: { name: string; value: string }[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      continue;
    }
    if (entry.disabled === true) {
      continue;
    }
    const name =
      typeof entry.name === 'string'
        ? entry.name.trim()
        : typeof entry.key === 'string'
          ? entry.key.trim()
          : '';
    if (name.length === 0 || name === '__proto__') {
      continue;
    }
    const valueRaw =
      typeof entry.value === 'string'
        ? entry.value
        : entry.value === null || entry.value === undefined
          ? ''
          : String(entry.value);
    fields.push({
      name,
      value: isSensitiveName(name)
        ? placeholderForSensitiveName(name)
        : rewriteMappedText(valueRaw, noteEnvRewrites),
    });
  }
  return fields;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

function scrubJsonBody(
  text: string,
  noteEnvRewrites: (count: number) => void,
): string {
  const rewritten = rewriteInsomniaEnvRefs(text);
  noteEnvRewrites(rewritten.rewriteCount);
  try {
    const parsed = JSON.parse(rewritten.value) as unknown;
    const scrubbed = scrubSensitiveExampleValue(parsed);
    return JSON.stringify(scrubbed, null, 2);
  } catch {
    return scrubRawTextBody(rewritten.value, () => {
      /* already counted */
    });
  }
}

function scrubRawTextBody(
  text: string,
  noteEnvRewrites: (count: number) => void,
): string {
  if (/^\s*(Bearer|Basic)\s+\S+/iu.test(text)) {
    return '';
  }
  return maskImportSecretText(rewriteMappedText(text, noteEnvRewrites));
}

function rewriteMappedText(
  value: string,
  noteEnvRewrites: (count: number) => void,
): string {
  const rewritten = rewriteInsomniaEnvRefs(value);
  noteEnvRewrites(rewritten.rewriteCount);
  return rewritten.value;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/gu, ' '));
  } catch {
    return value;
  }
}

function singleLine(value: string): string {
  return maskImportSecretText(value.replace(/[\r\n]+/gu, ' ').trim());
}
