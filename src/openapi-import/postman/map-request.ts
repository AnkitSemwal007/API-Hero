/**
 * Maps a Postman request item to a RequestSourceDocument and serialized `.api`.
 */

import {
  serializeRequestDocument,
  type RequestSourceBody,
  type RequestSourceDocument,
  type RequestSourceHeader,
  type RequestSourceMethod,
  type RequestSourceQueryParam,
  type RequestSourceVariable,
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
import { type MappedVariable } from './map-variables';
import { isPlainObject } from './parse';
import type {
  PostmanBodyLike,
  PostmanHeaderLike,
  PostmanQueryParamLike,
  PostmanRequestLike,
  PostmanUrlLike,
} from './types';

export interface MapRequestInput {
  readonly name: string;
  readonly request: unknown;
  readonly description?: string;
  readonly authProfileId?: string;
  readonly documentVariables?: readonly MappedVariable[];
  readonly path: string;
}

export interface MapRequestResult {
  readonly content: string;
  readonly requestName: string;
  readonly method: RequestSourceMethod;
  readonly diagnostics: readonly ImportDiagnostic[];
}

const METHOD_SET = new Set<string>(HTTP_METHODS);

/** Cap document `@variable` lines per `.api` to avoid folder-var × request explosion. */
const MAX_DOCUMENT_VARIABLES_PER_REQUEST = 80;

/**
 * Converts one Postman request into serialized `.api` source.
 */
export function mapPostmanRequest(input: MapRequestInput): MapRequestResult {
  const diagnostics: ImportDiagnostic[] = [];
  const requestName =
    input.name.trim().length > 0 ? singleLine(input.name) : 'Untitled Request';

  if (!isPlainObject(input.request)) {
    diagnostics.push({
      code: 'postman-invalid-request',
      severity: 'warning',
      path: input.path,
      message: maskImportSecretText(
        `Skipping malformed request "${requestName}".`,
      ),
    });
    return {
      content: serializeRequestDocument({
        name: requestName,
        method: 'GET',
        url: '{{baseUrl}}/',
        comments: ['Imported request was malformed; placeholder generated.'],
      }),
      requestName,
      method: 'GET',
      diagnostics,
    };
  }

  const req = input.request as PostmanRequestLike;
  const method = normalizeMethod(req.method);
  const urlResult = mapUrl(req.url, `${input.path}/url`);
  diagnostics.push(...urlResult.diagnostics);

  const headers = mapHeaders(req.header, `${input.path}/header`, diagnostics);
  const bodyResult = mapBody(req.body, `${input.path}/body`);
  diagnostics.push(...bodyResult.diagnostics);

  const comments: string[] = [];
  if (bodyResult.comment !== undefined) {
    comments.push(bodyResult.comment);
  }

  const description =
    input.description?.trim() ||
    readDescription(req.description) ||
    undefined;

  // Cap inherited + request vars so large folder scopes do not fan out unbounded.
  const variables: RequestSourceVariable[] = (input.documentVariables ?? [])
    .slice(0, MAX_DOCUMENT_VARIABLES_PER_REQUEST)
    .map((item) => ({
      name: item.name,
      value: item.value,
      ...(item.sensitive ? { sensitive: true as const } : {}),
    }));

  // Drop Content-Type when serializer owns it for json/form/multipart.
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
    ...(variables.length > 0 ? { variables } : {}),
  };

  return {
    content: serializeRequestDocument(document),
    requestName,
    method,
    diagnostics,
  };
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
  raw: unknown,
  path: string,
): {
  readonly url: string;
  readonly queryParams: readonly RequestSourceQueryParam[];
  readonly diagnostics: readonly ImportDiagnostic[];
} {
  const diagnostics: ImportDiagnostic[] = [];
  const queryParams: RequestSourceQueryParam[] = [];

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return {
      url: trimmed.length > 0 ? stripQuery(trimmed) : '{{baseUrl}}/',
      queryParams: parseQueryFromRaw(trimmed),
      diagnostics,
    };
  }

  if (!isPlainObject(raw)) {
    diagnostics.push({
      code: 'postman-invalid-url',
      severity: 'warning',
      path,
      message: 'Request URL missing or malformed; using {{baseUrl}}/.',
    });
    return { url: '{{baseUrl}}/', queryParams, diagnostics };
  }

  const urlObj = raw as Exclude<PostmanUrlLike, string>;
  if (typeof urlObj.raw === 'string' && urlObj.raw.trim().length > 0) {
    const rawUrl = urlObj.raw.trim();
    // Prefer structured query when present; otherwise parse from raw.
    if (Array.isArray(urlObj.query)) {
      queryParams.push(...mapQueryArray(urlObj.query));
      return { url: stripQuery(rawUrl), queryParams, diagnostics };
    }
    return {
      url: stripQuery(rawUrl),
      queryParams: parseQueryFromRaw(rawUrl),
      diagnostics,
    };
  }

  // Build from host + path parts; convert :id → {{id}}.
  const hostParts = Array.isArray(urlObj.host)
    ? urlObj.host.filter((p): p is string => typeof p === 'string')
    : typeof urlObj.host === 'string'
      ? [urlObj.host]
      : [];
  const pathParts = Array.isArray(urlObj.path)
    ? urlObj.path.map((p) => {
        if (typeof p !== 'string') {
          return '';
        }
        if (p.startsWith(':')) {
          const name = p.slice(1);
          return name.length > 0 ? `{{${name}}}` : p;
        }
        return p;
      })
    : typeof urlObj.path === 'string'
      ? [urlObj.path]
      : [];

  // Path variables from url.variable
  if (Array.isArray(urlObj.variable)) {
    for (const entry of urlObj.variable) {
      if (!isPlainObject(entry)) {
        continue;
      }
      const key = typeof entry.key === 'string' ? entry.key.trim() : '';
      if (key.length === 0) {
        continue;
      }
      // Ensure path uses {{key}} if still :key
      for (let i = 0; i < pathParts.length; i += 1) {
        if (pathParts[i] === `:${key}`) {
          pathParts[i] = `{{${key}}}`;
        }
      }
    }
  }

  const protocol =
    typeof urlObj.protocol === 'string' && urlObj.protocol.trim().length > 0
      ? urlObj.protocol.replace(/:$/u, '')
      : undefined;
  const port =
    typeof urlObj.port === 'string' && urlObj.port.trim().length > 0
      ? urlObj.port.trim()
      : typeof urlObj.port === 'number'
        ? String(urlObj.port)
        : undefined;

  let host = hostParts.join('.');
  if (port !== undefined && host.length > 0 && !host.includes('{{')) {
    host = `${host}:${port}`;
  }

  let built: string;
  if (host.length === 0) {
    built = pathParts.length > 0 ? `/${pathParts.filter(Boolean).join('/')}` : '{{baseUrl}}/';
    if (!built.includes('{{') && !built.startsWith('http')) {
      built = `{{baseUrl}}${built.startsWith('/') ? built : `/${built}`}`;
    }
  } else if (protocol !== undefined) {
    built = `${protocol}://${host}`;
    if (pathParts.length > 0) {
      built += `/${pathParts.filter(Boolean).join('/')}`;
    }
  } else if (host.includes('{{') || host.startsWith('http')) {
    built = host;
    if (pathParts.length > 0) {
      built += `/${pathParts.filter(Boolean).join('/')}`;
    }
  } else {
    built = `https://${host}`;
    if (pathParts.length > 0) {
      built += `/${pathParts.filter(Boolean).join('/')}`;
    }
  }

  if (Array.isArray(urlObj.query)) {
    queryParams.push(...mapQueryArray(urlObj.query));
  }

  return { url: built, queryParams, diagnostics };
}

function mapQueryArray(raw: unknown[]): RequestSourceQueryParam[] {
  const result: RequestSourceQueryParam[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const item = entry as PostmanQueryParamLike;
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    if (key.length === 0 || key === '__proto__') {
      continue;
    }
    const valueRaw =
      typeof item.value === 'string'
        ? item.value
        : item.value === null || item.value === undefined
          ? ''
          : String(item.value);
    const value = isSensitiveName(key)
      ? placeholderForSensitiveName(key)
      : valueRaw;
    result.push({
      name: key,
      value,
      enabled: item.disabled !== true,
    });
  }
  return result;
}

function parseQueryFromRaw(rawUrl: string): RequestSourceQueryParam[] {
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
      value: isSensitiveName(name) ? placeholderForSensitiveName(name) : value,
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
): RequestSourceHeader[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    diagnostics.push({
      code: 'postman-invalid-headers',
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
    const item = entry as PostmanHeaderLike;
    const name = typeof item.key === 'string' ? item.key.trim() : '';
    if (name.length === 0 || name === '__proto__') {
      continue;
    }
    const valueRaw =
      typeof item.value === 'string'
        ? item.value
        : item.value === null || item.value === undefined
          ? ''
          : String(item.value);
    result.push({
      name,
      value: sanitizeHeaderValue(name, valueRaw),
      enabled: item.disabled !== true,
    });
  }
  return result;
}

function mapBody(
  raw: unknown,
  path: string,
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
      code: 'postman-invalid-body',
      severity: 'warning',
      path,
      message: 'Ignoring malformed request body.',
    });
    return { diagnostics };
  }

  const body = raw as PostmanBodyLike;
  const mode =
    typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : '';

  switch (mode) {
    case '':
    case 'raw': {
      const text = typeof body.raw === 'string' ? body.raw : '';
      if (text.trim().length === 0) {
        return { diagnostics };
      }
      const language = readRawLanguage(body);
      if (language === 'json' || looksLikeJson(text)) {
        return {
          body: { type: 'json', text: scrubJsonBody(text) },
          diagnostics,
        };
      }
      if (language === 'text' || language === 'plain') {
        return {
          body: { type: 'text', text: scrubRawTextBody(text) },
          diagnostics,
        };
      }
      const contentType = languageToContentType(language);
      return {
        body: {
          type: 'raw',
          text: scrubRawTextBody(text),
          ...(contentType !== undefined ? { contentType } : {}),
        },
        diagnostics,
      };
    }
    case 'urlencoded': {
      const fields = mapFormFields(body.urlencoded);
      return { body: { type: 'form', fields }, diagnostics };
    }
    case 'formdata': {
      const fields = mapFormFields(body.formdata);
      // File parts become text stubs with a warning.
      if (Array.isArray(body.formdata)) {
        for (const entry of body.formdata) {
          if (
            isPlainObject(entry) &&
            (entry.type === 'file' || entry.src !== undefined)
          ) {
            diagnostics.push({
              code: 'postman-unsupported-body',
              severity: 'warning',
              path,
              message:
                'form-data file parts are imported as text stubs (binary upload not migrated).',
            });
            break;
          }
        }
      }
      return { body: { type: 'multipart', fields }, diagnostics };
    }
    case 'graphql': {
      diagnostics.push({
        code: 'postman-unsupported-graphql',
        severity: 'warning',
        path,
        message:
          'GraphQL request body is not fully supported; imported as raw JSON stub when possible.',
      });
      const gql = body.graphql;
      if (isPlainObject(gql)) {
        const query = typeof gql.query === 'string' ? gql.query : '';
        let variablesValue: unknown;
        if (gql.variables !== undefined) {
          if (typeof gql.variables === 'string') {
            try {
              variablesValue = JSON.parse(gql.variables) as unknown;
            } catch {
              variablesValue = gql.variables;
            }
          } else {
            variablesValue = gql.variables;
          }
        }
        const stubObj = {
          query,
          ...(variablesValue !== undefined ? { variables: variablesValue } : {}),
        };
        const scrubbed = scrubSensitiveExampleValue(stubObj);
        return {
          body: {
            type: 'json',
            text: JSON.stringify(scrubbed, null, 2),
          },
          comment: 'Imported from Postman GraphQL body (best-effort).',
          diagnostics,
        };
      }
      return { diagnostics };
    }
    case 'file': {
      diagnostics.push({
        code: 'postman-unsupported-body',
        severity: 'warning',
        path,
        message: 'Binary file body is not imported; placeholder comment only.',
      });
      return {
        body: { type: 'binary', note: 'Postman file body was not imported.' },
        diagnostics,
      };
    }
    default: {
      diagnostics.push({
        code: 'postman-unsupported-body',
        severity: 'warning',
        path,
        message: maskImportSecretText(
          `Unsupported Postman body mode "${mode}" was not imported.`,
        ),
      });
      return { diagnostics };
    }
  }
}

function mapFormFields(
  raw: unknown,
): readonly { readonly name: string; readonly value: string }[] {
  if (!Array.isArray(raw)) {
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
    const name = typeof entry.key === 'string' ? entry.key.trim() : '';
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
        : valueRaw,
    });
  }
  return fields;
}

function readRawLanguage(body: PostmanBodyLike): string | undefined {
  const options = body.options;
  if (!isPlainObject(options)) {
    return undefined;
  }
  const raw = options.raw;
  if (!isPlainObject(raw)) {
    return undefined;
  }
  return typeof raw.language === 'string'
    ? raw.language.trim().toLowerCase()
    : undefined;
}

function languageToContentType(language: string | undefined): string | undefined {
  if (language === undefined || language.length === 0) {
    return undefined;
  }
  switch (language) {
    case 'xml':
      return 'application/xml';
    case 'html':
      return 'text/html';
    case 'javascript':
      return 'application/javascript';
    default:
      return undefined;
  }
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

function scrubJsonBody(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    const scrubbed = scrubSensitiveExampleValue(parsed);
    return JSON.stringify(scrubbed, null, 2);
  } catch {
    return scrubRawTextBody(text);
  }
}

/** Bearer/Basic wipe + maskImportSecretText for non-JSON raw/text bodies. */
function scrubRawTextBody(text: string): string {
  if (/^\s*(Bearer|Basic)\s+\S+/iu.test(text)) {
    return '';
  }
  return maskImportSecretText(text);
}

function readDescription(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  if (isPlainObject(raw) && typeof raw.content === 'string') {
    return raw.content.trim();
  }
  return undefined;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/gu, ' '));
  } catch {
    return value;
  }
}

function singleLine(value: string): string {
  // Same masking + length cap as OpenAPI request-generator comments/names.
  return maskImportSecretText(value.replace(/[\r\n]+/gu, ' ').trim());
}

/** Detects pre-request / test scripts on an item or collection. */
export function collectScriptDiagnostics(
  eventRaw: unknown,
  path: string,
  scopeLabel: string,
): readonly ImportDiagnostic[] {
  if (eventRaw === undefined || eventRaw === null) {
    return [];
  }
  if (!Array.isArray(eventRaw)) {
    return [
      {
        code: 'postman-unsupported-script',
        severity: 'warning',
        path,
        message: maskImportSecretText(
          `Malformed event list on ${scopeLabel}; scripts were not imported.`,
        ),
      },
    ];
  }

  const diagnostics: ImportDiagnostic[] = [];
  for (const [index, entry] of eventRaw.entries()) {
    if (!isPlainObject(entry)) {
      continue;
    }
    if (entry.disabled === true) {
      continue;
    }
    const listen =
      typeof entry.listen === 'string' ? entry.listen.trim().toLowerCase() : '';
    if (listen !== 'prerequest' && listen !== 'test') {
      continue;
    }
    const script = entry.script;
    let hasExec = false;
    if (isPlainObject(script)) {
      const exec = script.exec;
      if (typeof exec === 'string' && exec.trim().length > 0) {
        hasExec = true;
      } else if (Array.isArray(exec) && exec.some((line) => typeof line === 'string' && line.trim().length > 0)) {
        hasExec = true;
      }
    }
    if (!hasExec && !isPlainObject(script)) {
      continue;
    }
    const kind = listen === 'prerequest' ? 'pre-request' : 'test';
    diagnostics.push({
      code: 'postman-unsupported-script',
      severity: 'warning',
      path: `${path}/event/${index}`,
      message: maskImportSecretText(
        `${scopeLabel} has a Postman ${kind} script that was not imported (scripts are never executed or migrated).`,
      ),
    });
  }
  return diagnostics;
}
