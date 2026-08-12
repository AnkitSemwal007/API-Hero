/**
 * Framework-free cURL → RequestSourceDocument parser.
 * Never invokes a shell or spawns a process — input is inert text only.
 */

import type {
  RequestSourceBody,
  RequestSourceDocument,
  RequestSourceHeader,
  RequestSourceMethod,
  RequestSourceQueryParam,
} from '../request-source';
import { HTTP_METHODS } from '../types';
import {
  isSensitiveHttpHeaderName,
  SENSITIVE_HTTP_HEADER_NAMES,
} from '../shared';
import {
  CURL_MAX_INPUT_BYTES,
  tokenizeCurlCommand,
} from './curl-tokenizer';

export { CURL_MAX_INPUT_BYTES };

/** Flags this parser understands (documented for users). */
export const CURL_SUPPORTED_FLAGS: readonly string[] = Object.freeze([
  '-X',
  '--request',
  '-H',
  '--header',
  '-G',
  '--get',
  '-u',
  '--user',
  '-b',
  '--cookie',
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-urlencode',
  '-F',
  '--form',
  '-I',
  '--head',
  '-A',
  '--user-agent',
  '-e',
  '--referer',
  '--url',
  '--max-time',
]);

/**
 * Common curl flags that are intentionally ignored (warning only).
 * Presence never triggers shell execution.
 */
export const CURL_UNSUPPORTED_FLAGS: readonly string[] = Object.freeze([
  '-o',
  '--output',
  '-O',
  '--remote-name',
  '-v',
  '--verbose',
  '-s',
  '--silent',
  '-S',
  '--show-error',
  '-i',
  '--include',
  '-k',
  '--insecure',
  '-L',
  '--location',
  '-x',
  '--proxy',
  '--compressed',
  '--http1.0',
  '--http1.1',
  '--http2',
  '-#',
  '--progress-bar',
  '--connect-timeout',
  '-C',
  '--continue-at',
  '--cacert',
  '--capath',
  '--cert',
  '--key',
  '-E',
  '--cert-type',
  '--resolve',
  '--retry',
  '--fail',
  '-f',
  '--location-trusted',
  '-w',
  '--write-out',
  '-D',
  '--dump-header',
  '--trace',
  '--trace-ascii',
  '-n',
  '--netrc',
  '--netrc-optional',
  '--anyauth',
  '--digest',
  '--ntlm',
  '--negotiate',
  '--oauth2-bearer',
  '-T',
  '--upload-file',
  '--unix-socket',
  '-Z',
  '--parallel',
]);

export interface CurlParseDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly code: string;
}

export interface CurlParseSuccess {
  readonly ok: true;
  readonly document: RequestSourceDocument;
  readonly warnings: readonly CurlParseDiagnostic[];
  /** Human notes for preview (auth scheme; secrets masked in UI). */
  readonly authNotes: readonly string[];
}

export interface CurlParseFailure {
  readonly ok: false;
  readonly errors: readonly CurlParseDiagnostic[];
  readonly warnings: readonly CurlParseDiagnostic[];
}

export type CurlParseResult = CurlParseSuccess | CurlParseFailure;

export interface CurlPreviewSummary {
  readonly method: string;
  readonly url: string;
  readonly headerCount: number;
  readonly bodyKind: string;
  readonly authNotes: readonly string[];
  readonly warnings: readonly string[];
  /** Secrets masked for UI display. */
  readonly maskedHeaders: readonly { readonly name: string; readonly value: string }[];
}

const HTTP_METHOD_SET = new Set<string>(HTTP_METHODS);
const MASK = '••••••••';

/**
 * Parses a cURL command string into a {@link RequestSourceDocument}.
 * Never executes HTTP or a shell.
 */
export function parseCurl(input: string): CurlParseResult {
  const warnings: CurlParseDiagnostic[] = [];
  const errors: CurlParseDiagnostic[] = [];

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      errors: [
        {
          severity: 'error',
          message: 'cURL input is empty.',
          code: 'curl.empty',
        },
      ],
      warnings,
    };
  }

  const tokenized = tokenizeCurlCommand(trimmed);
  if (!tokenized.ok) {
    return {
      ok: false,
      errors: [
        {
          severity: 'error',
          message: tokenized.message,
          code: tokenized.code,
        },
      ],
      warnings,
    };
  }

  const tokens = [...tokenized.tokens];
  if (tokens.length === 0) {
    return {
      ok: false,
      errors: [
        {
          severity: 'error',
          message: 'No tokens found in cURL input.',
          code: 'curl.no_tokens',
        },
      ],
      warnings,
    };
  }

  // Drop leading prompt noise: `$`, `>`, `%`, and optional path to curl binary.
  while (tokens.length > 0) {
    const head = tokens[0]!.value;
    if (head === '$' || head === '>' || head === '%') {
      tokens.shift();
      continue;
    }
    break;
  }

  if (tokens.length === 0 || !isCurlInvocation(tokens[0]!.value)) {
    return {
      ok: false,
      errors: [
        {
          severity: 'error',
          message: 'Input does not look like a curl command (expected leading `curl`).',
          code: 'curl.not_curl',
        },
      ],
      warnings,
    };
  }
  tokens.shift();

  let method: RequestSourceMethod | undefined;
  let forceGet = false;
  let headMethod = false;
  let urlRaw: string | undefined;
  const headers: RequestSourceHeader[] = [];
  const dataParts: string[] = [];
  const urlEncodeFields: { name: string; value: string }[] = [];
  const formFields: { name: string; value: string }[] = [];
  let basicUser: string | undefined;
  let cookieValue: string | undefined;
  let timeoutMs: number | undefined;
  let dataKind: 'raw' | 'binary' | 'urlencoded' | undefined;
  const authNotes: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const rawToken = tokens[i]!.value;
    const split = splitFlagValue(rawToken);
    const token = split.flag;
    let inlineValue: string | undefined = split.inlineValue;
    const next = (): string | undefined => {
      if (inlineValue !== undefined) {
        const value = inlineValue;
        inlineValue = undefined;
        return value;
      }
      i += 1;
      return tokens[i]?.value;
    };

    if (token === '-X' || token === '--request') {
      const value = next();
      if (value === undefined) {
        errors.push({
          severity: 'error',
          message: `${token} requires a method argument.`,
          code: 'curl.missing_arg',
        });
        break;
      }
      const normalized = value.toUpperCase();
      if (!HTTP_METHOD_SET.has(normalized)) {
        errors.push({
          severity: 'error',
          message: `Unsupported HTTP method "${value}".`,
          code: 'curl.bad_method',
        });
      } else {
        method = normalized as RequestSourceMethod;
      }
      i += 1;
      continue;
    }

    if (token === '-H' || token === '--header') {
      const value = next();
      if (value === undefined) {
        errors.push({
          severity: 'error',
          message: `${token} requires a header argument.`,
          code: 'curl.missing_arg',
        });
        break;
      }
      const parsed = parseHeaderLine(value);
      if (parsed === undefined) {
        warnings.push({
          severity: 'warning',
          message: formatSkippedHeaderWarning(value),
          code: 'curl.bad_header',
        });
      } else {
        headers.push(parsed);
      }
      i += 1;
      continue;
    }

    if (token === '-G' || token === '--get') {
      forceGet = true;
      i += 1;
      continue;
    }

    if (token === '-I' || token === '--head') {
      headMethod = true;
      i += 1;
      continue;
    }

    if (token === '-u' || token === '--user') {
      const value = next();
      if (value === undefined) {
        errors.push({
          severity: 'error',
          message: `${token} requires a user:password argument.`,
          code: 'curl.missing_arg',
        });
        break;
      }
      basicUser = value;
      authNotes.push('Basic credentials from -u / --user');
      i += 1;
      continue;
    }

    if (token === '-b' || token === '--cookie') {
      const value = next();
      if (value === undefined) {
        errors.push({
          severity: 'error',
          message: `${token} requires a cookie argument.`,
          code: 'curl.missing_arg',
        });
        break;
      }
      cookieValue = value;
      i += 1;
      continue;
    }

    if (
      token === '-d' ||
      token === '--data' ||
      token === '--data-raw' ||
      token === '--data-binary'
    ) {
      const value = next();
      if (value === undefined) {
        errors.push({
          severity: 'error',
          message: `${token} requires a data argument.`,
          code: 'curl.missing_arg',
        });
        break;
      }
      if (token === '--data-binary') {
        dataKind = 'binary';
      } else if (dataKind === undefined) {
        dataKind = token === '--data-raw' ? 'raw' : 'urlencoded';
      }
      dataParts.push(stripLeadingAtFileHint(value, warnings));
      i += 1;
      continue;
    }

    if (token === '--data-urlencode') {
      const value = next();
      if (value === undefined) {
        errors.push({
          severity: 'error',
          message: `${token} requires an argument.`,
          code: 'curl.missing_arg',
        });
        break;
      }
      urlEncodeFields.push(parseDataUrlEncode(value));
      i += 1;
      continue;
    }

    if (token === '-F' || token === '--form') {
      const value = next();
      if (value === undefined) {
        errors.push({
          severity: 'error',
          message: `${token} requires a form field argument.`,
          code: 'curl.missing_arg',
        });
        break;
      }
      formFields.push(parseFormField(value, warnings));
      i += 1;
      continue;
    }

    if (token === '-A' || token === '--user-agent') {
      const value = next();
      if (value === undefined) {
        errors.push({
          severity: 'error',
          message: `${token} requires a User-Agent value.`,
          code: 'curl.missing_arg',
        });
        break;
      }
      headers.push({ name: 'User-Agent', value, enabled: true });
      i += 1;
      continue;
    }

    if (token === '-e' || token === '--referer') {
      const value = next();
      if (value === undefined) {
        errors.push({
          severity: 'error',
          message: `${token} requires a Referer value.`,
          code: 'curl.missing_arg',
        });
        break;
      }
      headers.push({ name: 'Referer', value, enabled: true });
      i += 1;
      continue;
    }

    if (token === '--url') {
      const value = next();
      if (value === undefined) {
        errors.push({
          severity: 'error',
          message: `${token} requires a URL argument.`,
          code: 'curl.missing_arg',
        });
        break;
      }
      urlRaw = value;
      i += 1;
      continue;
    }

    if (token === '--max-time') {
      const value = next();
      if (value === undefined) {
        errors.push({
          severity: 'error',
          message: `${token} requires a seconds argument.`,
          code: 'curl.missing_arg',
        });
        break;
      }
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds < 0) {
        warnings.push({
          severity: 'warning',
          message: `Ignoring invalid --max-time value.`,
          code: 'curl.bad_timeout',
        });
      } else {
        timeoutMs = Math.round(seconds * 1000);
      }
      i += 1;
      continue;
    }

    if (token.startsWith('-')) {
      const knownUnsupported = CURL_UNSUPPORTED_FLAGS.includes(token);
      const message = knownUnsupported
        ? `Unsupported flag ignored: ${token}`
        : `Unknown flag ignored: ${token}`;
      const code = knownUnsupported
        ? 'curl.unsupported_flag'
        : 'curl.unknown_flag';
      warnings.push({ severity: 'warning', message, code });
      if (inlineValue !== undefined) {
        i += 1;
        continue;
      }
      if (
        unsupportedFlagConsumesArg(token) &&
        i + 1 < tokens.length &&
        !tokens[i + 1]!.value.startsWith('-')
      ) {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    // Positional URL (first wins unless --url set later — later --url overwrites).
    if (urlRaw === undefined) {
      urlRaw = token;
    } else {
      warnings.push({
        severity: 'warning',
        message: formatExtraArgWarning(token),
        code: 'curl.extra_arg',
      });
    }
    i += 1;
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  if (urlRaw === undefined || urlRaw.trim().length === 0) {
    return {
      ok: false,
      errors: [
        {
          severity: 'error',
          message: 'cURL command is missing a URL.',
          code: 'curl.missing_url',
        },
      ],
      warnings,
    };
  }

  // Reject obvious non-URL shell metacharacter blobs used as "URL".
  const safeUrl = sanitizeUrlCandidate(urlRaw);
  if (safeUrl === undefined) {
    return {
      ok: false,
      errors: [
        {
          severity: 'error',
          message: 'URL is malformed or unsafe.',
          code: 'curl.bad_url',
        },
      ],
      warnings,
    };
  }

  const { baseUrl, queryParams: urlQuery } = splitUrlAndQuery(safeUrl);

  // Method resolution (curl defaults to POST when body is present).
  let resolvedMethod: RequestSourceMethod =
    method ??
    (headMethod
      ? 'HEAD'
      : forceGet
        ? 'GET'
        : dataParts.length > 0 ||
            urlEncodeFields.length > 0 ||
            formFields.length > 0
          ? 'POST'
          : 'GET');

  if (forceGet) {
    resolvedMethod = 'GET';
  }
  if (headMethod && method === undefined) {
    resolvedMethod = 'HEAD';
  }

  // Cookies → Cookie header
  if (cookieValue !== undefined) {
    headers.push({
      name: 'Cookie',
      value: placeholderForSensitiveName('Cookie'),
      enabled: true,
    });
    warnings.push({
      severity: 'warning',
      message: 'Cookie value replaced with {{cookie}} placeholder.',
      code: 'curl.cookie_placeholder',
    });
  }

  // Basic -u → Authorization header with placeholder (no new auth runtime).
  if (basicUser !== undefined) {
    const hasAuth = headers.some(
      (h) => h.name.trim().toLowerCase() === 'authorization',
    );
    if (!hasAuth) {
      headers.push({
        name: 'Authorization',
        value: 'Basic {{token}}',
        enabled: true,
      });
    }
    warnings.push({
      severity: 'warning',
      message:
        'Basic credentials from -u were not stored; Authorization uses Basic {{token}}.',
      code: 'curl.basic_placeholder',
    });
  }

  // Sanitize sensitive header values for the written document.
  const sanitizedHeaders = headers.map((header) => {
    if (isSensitiveName(header.name) || isSensitiveHttpHeaderName(header.name)) {
      const lower = header.name.trim().toLowerCase();
      const original = header.value;
      let placeholder = placeholderForSensitiveName(header.name);
      if (lower === 'authorization') {
        if (/^\s*bearer\s+/iu.test(original)) {
          placeholder = 'Bearer {{token}}';
          if (!authNotes.some((n) => /bearer/iu.test(n))) {
            authNotes.push('Bearer token from Authorization header');
          }
        } else if (/^\s*basic\s+/iu.test(original)) {
          placeholder = 'Basic {{token}}';
          if (!authNotes.some((n) => /basic/iu.test(n))) {
            authNotes.push('Basic credentials from Authorization header');
          }
        }
      }
      if (original !== placeholder) {
        warnings.push({
          severity: 'warning',
          message: `Sensitive header "${header.name}" value replaced with a placeholder.`,
          code: 'curl.header_placeholder',
        });
      }
      return { ...header, value: placeholder };
    }
    return header;
  });

  // Body construction
  let queryParams = [...urlQuery];
  let body: RequestSourceBody = { type: 'none' };

  if (formFields.length > 0) {
    body = { type: 'multipart', fields: formFields };
    if (dataParts.length > 0 || urlEncodeFields.length > 0) {
      warnings.push({
        severity: 'warning',
        message: 'Ignoring -d / --data-urlencode because -F / --form was used.',
        code: 'curl.form_precedence',
      });
    }
  } else if (forceGet) {
    // -G appends data as query string
    const fromData = [
      ...flattenDataAsQuery(dataParts),
      ...urlEncodeFields,
    ];
    queryParams = [...queryParams, ...fromData];
  } else if (dataParts.length > 0 || urlEncodeFields.length > 0) {
    body = buildBody(
      dataParts,
      urlEncodeFields,
      dataKind,
      sanitizedHeaders,
      warnings,
    );
  }

  const name = suggestRequestName(resolvedMethod, baseUrl);
  const document: RequestSourceDocument = Object.freeze({
    name,
    method: resolvedMethod,
    url: baseUrl,
    ...(queryParams.length > 0 ? { queryParams: Object.freeze(queryParams) } : {}),
    ...(sanitizedHeaders.length > 0
      ? { headers: Object.freeze(sanitizedHeaders) }
      : {}),
    ...(body.type !== 'none' ? { body } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    comments: Object.freeze(['Imported from cURL']),
  });

  // Prototype-pollution defense: never keep __proto__ keys in frozen structures
  // (headers/query already built from plain arrays).

  return {
    ok: true,
    document,
    warnings,
    authNotes,
  };
}

/**
 * Builds a masked preview summary for UI (secrets never shown in cleartext).
 */
export function buildCurlPreview(result: CurlParseSuccess): CurlPreviewSummary {
  const doc = result.document;
  const maskedHeaders = (doc.headers ?? []).map((header) => ({
    name: header.name,
    value:
      isSensitiveHttpHeaderName(header.name) || isSensitiveName(header.name)
        ? MASK
        : header.value,
  }));
  return {
    method: doc.method,
    url: maskUrlUserinfo(doc.url),
    headerCount: doc.headers?.length ?? 0,
    bodyKind: doc.body?.type ?? 'none',
    authNotes: result.authNotes,
    warnings: result.warnings.map((w) => w.message),
    maskedHeaders,
  };
}

/** True when selected/pasted text likely starts a curl command. */
export function looksLikeCurl(text: string): boolean {
  const sample = text.trim().slice(0, 200);
  return /(?:^|[\n$]\s*)(?:curl(?:\.exe)?|\/\S*\/curl)\b/imu.test(sample);
}

/** Suggests a filesystem-safe `.api` stem from method + URL path. */
export function suggestCurlFileName(document: RequestSourceDocument): string {
  const method = document.method.toLowerCase();
  let pathSeg = 'request';
  try {
    const parsed = new URL(document.url);
    const parts = parsed.pathname.split('/').filter((p) => p.length > 0);
    const last = parts[parts.length - 1];
    if (last !== undefined) {
      pathSeg = last.replace(/\.[a-z0-9]+$/iu, '');
    } else if (parsed.hostname.length > 0) {
      pathSeg = parsed.hostname.split('.')[0] ?? 'request';
    }
  } catch {
    const slash = document.url.replace(/^https?:\/\//iu, '').split(/[?#]/u)[0];
    const parts = slash?.split('/').filter((p) => p.length > 0) ?? [];
    pathSeg = parts[parts.length - 1] ?? 'request';
  }
  const slug = pathSeg
    .replace(/[^\w.-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 48);
  const stem = `${method}-${slug.length > 0 ? slug : 'request'}`;
  return `${stem}.api`;
}

function isCurlInvocation(token: string): boolean {
  const base = token.replace(/\\/gu, '/').split('/').pop() ?? token;
  return /^curl(\.exe)?$/iu.test(base);
}

function parseHeaderLine(raw: string): RequestSourceHeader | undefined {
  const trimmed = raw.trim();
  const colon = trimmed.indexOf(':');
  if (colon <= 0) {
    return undefined;
  }
  const name = trimmed.slice(0, colon).trim();
  const value = trimmed.slice(colon + 1).trim();
  if (name.length === 0 || name === '__proto__' || name === 'constructor') {
    return undefined;
  }
  return { name, value, enabled: true };
}

function parseDataUrlEncode(raw: string): { name: string; value: string } {
  const eq = raw.indexOf('=');
  if (eq < 0) {
    return { name: raw, value: '' };
  }
  return {
    name: raw.slice(0, eq),
    value: raw.slice(eq + 1),
  };
}

function parseFormField(
  raw: string,
  warnings: CurlParseDiagnostic[],
): { name: string; value: string } {
  const eq = raw.indexOf('=');
  if (eq < 0) {
    return { name: raw, value: '' };
  }
  const name = raw.slice(0, eq);
  let value = raw.slice(eq + 1);
  // type= / filename= suffixes: keep simple name=value; strip ;type=
  const semi = value.indexOf(';');
  if (semi >= 0) {
    value = value.slice(0, semi);
  }
  if (value.startsWith('@')) {
    warnings.push({
      severity: 'warning',
      message: `Form file reference for "${name}" is not uploaded; stored as a path note.`,
      code: 'curl.form_file',
    });
    return { name, value: value.slice(1) };
  }
  return { name, value };
}

function stripLeadingAtFileHint(
  value: string,
  warnings: CurlParseDiagnostic[],
): string {
  // curl -d @file reads a file; we cannot (and must not) read arbitrary paths.
  if (value.startsWith('@') && !value.startsWith('@{')) {
    warnings.push({
      severity: 'warning',
      message:
        'Data @file references are not read from disk; the literal path was kept as body text.',
      code: 'curl.data_file',
    });
    return value.slice(1);
  }
  return value;
}

function buildBody(
  dataParts: readonly string[],
  urlEncodeFields: readonly { name: string; value: string }[],
  dataKind: 'raw' | 'binary' | 'urlencoded' | undefined,
  headers: readonly RequestSourceHeader[],
  warnings: CurlParseDiagnostic[],
): RequestSourceBody {
  if (urlEncodeFields.length > 0 && dataParts.length === 0) {
    return { type: 'form', fields: [...urlEncodeFields] };
  }

  const joined =
    dataParts.length === 0
      ? ''
      : dataParts.length === 1
        ? dataParts[0]!
        : dataParts.join('&');

  if (urlEncodeFields.length > 0) {
    const extra = urlEncodeFields
      .map((f) => `${encodeURIComponent(f.name)}=${encodeURIComponent(f.value)}`)
      .join('&');
    const combined = joined.length > 0 ? `${joined}&${extra}` : extra;
    return { type: 'form', fields: parseFormUrlEncoded(combined) };
  }

  const contentType = findHeaderValue(headers, 'content-type');
  const looksJson =
    (contentType !== undefined && /json/iu.test(contentType)) ||
    isObviousJson(joined);

  if (looksJson) {
    return { type: 'json', text: joined };
  }

  if (
    dataKind === 'urlencoded' ||
    (contentType !== undefined &&
      /application\/x-www-form-urlencoded/iu.test(contentType)) ||
    looksLikeFormUrlEncoded(joined)
  ) {
    return { type: 'form', fields: parseFormUrlEncoded(joined) };
  }

  if (dataKind === 'binary') {
    warnings.push({
      severity: 'warning',
      message: 'Binary body imported as raw text (no file upload).',
      code: 'curl.binary_as_raw',
    });
    return {
      type: 'raw',
      text: joined,
      ...(contentType !== undefined ? { contentType } : {}),
    };
  }

  if (contentType !== undefined && !/json/iu.test(contentType)) {
    return { type: 'raw', text: joined, contentType };
  }

  return { type: 'text', text: joined };
}

function flattenDataAsQuery(
  dataParts: readonly string[],
): RequestSourceQueryParam[] {
  const params: RequestSourceQueryParam[] = [];
  for (const part of dataParts) {
    for (const field of parseFormUrlEncoded(part)) {
      params.push({ ...field, enabled: true });
    }
  }
  return params;
}

function parseFormUrlEncoded(
  raw: string,
): { name: string; value: string }[] {
  if (raw.length === 0) {
    return [];
  }
  const fields: { name: string; value: string }[] = [];
  for (const segment of raw.split('&')) {
    if (segment.length === 0) {
      continue;
    }
    const eq = segment.indexOf('=');
    const nameRaw = eq < 0 ? segment : segment.slice(0, eq);
    const valueRaw = eq < 0 ? '' : segment.slice(eq + 1);
    const name = safeDecode(nameRaw);
    if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
      continue;
    }
    fields.push({ name, value: safeDecode(valueRaw) });
  }
  return fields;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/gu, ' '));
  } catch {
    return value;
  }
}

function findHeaderValue(
  headers: readonly RequestSourceHeader[],
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  for (const header of headers) {
    if (header.name.trim().toLowerCase() === target) {
      return header.value;
    }
  }
  return undefined;
}

function isObviousJson(text: string): boolean {
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) {
    return false;
  }
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function looksLikeFormUrlEncoded(text: string): boolean {
  if (!text.includes('=') || text.trimStart().startsWith('{')) {
    return false;
  }
  return /^[^=&]+=/.test(text) && !/\s/.test(text.trim());
}

function splitUrlAndQuery(url: string): {
  baseUrl: string;
  queryParams: RequestSourceQueryParam[];
} {
  const hashIndex = url.indexOf('#');
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const q = withoutHash.indexOf('?');
  if (q < 0) {
    return { baseUrl: withoutHash, queryParams: [] };
  }
  const baseUrl = withoutHash.slice(0, q);
  const query = withoutHash.slice(q + 1);
  const queryParams: RequestSourceQueryParam[] = [];
  for (const field of parseFormUrlEncoded(query)) {
    queryParams.push({ ...field, enabled: true });
  }
  return { baseUrl, queryParams };
}

function sanitizeUrlCandidate(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 8_192) {
    return undefined;
  }
  // Reject NUL and obvious multi-command injection separators used as URL.
  if (trimmed.includes('\0')) {
    return undefined;
  }
  // Allow http(s), {{templates}}, and scheme-relative / path URLs.
  if (/^(https?:\/\/|\{\{|\/|\.)/iu.test(trimmed) || /^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) {
    return trimmed;
  }
  // Host without scheme (curl accepts these) — keep as-is if no shell metas.
  if (!/[\s;|&`$()<>]/.test(trimmed)) {
    return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
  }
  return undefined;
}

function suggestRequestName(method: string, url: string): string {
  const file = suggestCurlFileName({
    name: '',
    method: method as RequestSourceMethod,
    url,
  });
  return file.replace(/\.api$/iu, '');
}

function maskUrlUserinfo(url: string): string {
  return url.replace(/\/\/([^/@\s]+@)/u, '//***@');
}

/**
 * Splits `--flag=value`, `-XPOST`, and `-d=value` into flag + inline value.
 * Space-separated forms are unchanged (`inlineValue` undefined).
 */
function splitFlagValue(token: string): {
  readonly flag: string;
  readonly inlineValue?: string;
} {
  if (!token.startsWith('-') || token === '-') {
    return { flag: token };
  }
  if (token.startsWith('--')) {
    const eq = token.indexOf('=');
    if (eq > 2) {
      return { flag: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
    }
    return { flag: token };
  }
  // Glued short method: -XPOST / -XGET / …
  if (/^-X[A-Za-z][A-Za-z0-9+._-]*$/u.test(token)) {
    return { flag: '-X', inlineValue: token.slice(2) };
  }
  // Short option with equals: -H=…, -d=…, -u=…, -X=POST, …
  if (/^-[A-Za-z0-9]=/u.test(token)) {
    return { flag: token.slice(0, 2), inlineValue: token.slice(3) };
  }
  return { flag: token };
}

function looksSecretBearingPreviewArg(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (/\/\/[^/@\s]+@/u.test(trimmed)) {
    return true;
  }
  const nameGuess = trimmed.includes(':')
    ? trimmed.slice(0, trimmed.indexOf(':')).trim()
    : (trimmed.split(/\s+/u)[0] ?? '');
  if (
    isSensitiveHttpHeaderName(nameGuess) ||
    isSensitiveName(nameGuess) ||
    isSensitiveHttpHeaderName(trimmed)
  ) {
    return true;
  }
  return /\b(Bearer|Basic)\s+\S+/iu.test(trimmed);
}

function formatSkippedHeaderWarning(value: string): string {
  if (looksSecretBearingPreviewArg(value)) {
    return 'Skipping malformed header (sensitive value redacted).';
  }
  return `Skipping malformed header: ${maskPreviewText(value)}`;
}

function formatExtraArgWarning(token: string): string {
  // URLs with userinfo: show masked shape (***@), never the password.
  if (/\/\/[^/@\s]+@/u.test(token)) {
    return `Ignoring extra argument: ${maskPreviewText(token)}`;
  }
  if (looksSecretBearingPreviewArg(token)) {
    return 'Ignoring extra argument (sensitive value redacted).';
  }
  return `Ignoring extra argument: ${maskPreviewText(token)}`;
}

function maskPreviewText(value: string): string {
  let next = maskUrlUserinfo(value);
  for (const name of SENSITIVE_HTTP_HEADER_NAMES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    // `Name: value` form
    next = next.replace(
      new RegExp(`(${escaped}\\s*:\\s*)[^\\r\\n]*`, 'giu'),
      `$1${MASK}`,
    );
    // Sensitive header name without `:` (e.g. `Authorization Bearer …`)
    next = next.replace(
      new RegExp(`(^|[\\s,])(${escaped})(?=$|[\\s=])([^\\r\\n]*)`, 'giu'),
      (_match, pre: string, hdr: string, rest: string) => {
        if (String(rest).trim().length === 0) {
          return `${pre}${hdr}`;
        }
        return `${pre}${hdr} ${MASK}`;
      },
    );
  }
  next = next.replace(/(Bearer|Basic)\s+\S+/giu, `$1 ${MASK}`);
  return next.slice(0, 200);
}

function unsupportedFlagConsumesArg(flag: string): boolean {
  const withArg = new Set([
    '-o',
    '--output',
    '-x',
    '--proxy',
    '--cacert',
    '--capath',
    '--cert',
    '--key',
    '-E',
    '--resolve',
    '--retry',
    '-w',
    '--write-out',
    '-D',
    '--dump-header',
    '--trace',
    '--trace-ascii',
    '-T',
    '--upload-file',
    '--unix-socket',
    '--connect-timeout',
    '-C',
    '--continue-at',
    '--oauth2-bearer',
    '--cert-type',
  ]);
  return withArg.has(flag);
}

/** True when a header name should never keep a literal secret in `.api` output. */
function isSensitiveName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (SENSITIVE_HTTP_HEADER_NAMES.has(normalized)) {
    return true;
  }
  const compact = normalized.replace(/[_-]/gu, '');
  return (
    compact.includes('apikey') ||
    compact.includes('token') ||
    compact.includes('secret') ||
    compact.includes('password')
  );
}

/** Placeholder used instead of literal sensitive header values. */
function placeholderForSensitiveName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized === 'authorization' || normalized === 'proxy-authorization') {
    return '{{token}}';
  }
  if (normalized === 'cookie' || normalized === 'set-cookie') {
    return '{{cookie}}';
  }
  const slug = name
    .trim()
    .replace(/[^\w.-]+/gu, '_')
    .replace(/-/gu, '_');
  const varName = /^[A-Za-z_]/u.test(slug) ? slug : `secret_${slug}`;
  return `{{${varName}}}`;
}
