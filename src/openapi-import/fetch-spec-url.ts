/**
 * Fetches an OpenAPI specification document from an HTTP(S) URL.
 *
 * Security model (local VS Code extension):
 * - Only `http:` and `https:` schemes are allowed. Other protocols are rejected.
 * - Embedded URL credentials (username/password) are rejected and never sent.
 * - No Authorization or Cookie headers are attached.
 * - Localhost, private, and link-local addresses are intentionally allowed:
 *   API Hero is a local Git-first client; the Request Engine already permits
 *   loopback, and developers commonly serve Swagger/OpenAPI locally.
 * - Cloud-style SSRF blocking of private IP ranges is deliberately not
 *   implemented (would break legitimate local workflows and diverge from the
 *   Request Engine transport policy).
 * - Redirects use NodeHttpTransport defaults, which reject non-http(s) targets.
 *
 * This module does not parse OpenAPI — only URL validation, fetch, and UTF-8 decode.
 */

import {
  HttpTransportError,
  type HttpTransport,
} from '../execution';
import { DEFAULT_IMPORT_LIMITS } from './models';

const DEFAULT_MAX_REDIRECTS = 10;

export interface FetchOpenApiSpecUrlSuccess {
  readonly ok: true;
  readonly text: string;
  readonly fileName?: string;
  readonly sourceUrl: string;
  readonly contentType?: string;
}

export interface FetchOpenApiSpecUrlFailure {
  readonly ok: false;
  readonly message: string;
  readonly code?: string;
}

export type FetchOpenApiSpecUrlResult =
  | FetchOpenApiSpecUrlSuccess
  | FetchOpenApiSpecUrlFailure;

export interface FetchOpenApiSpecUrlOptions {
  readonly transport: HttpTransport;
  /** Matches import `maxFileBytes` / transport `maxResponseBytes`. */
  readonly maxResponseBytes?: number;
  readonly signal?: AbortSignal;
}

/**
 * Validates `url`, GETs the document via {@link HttpTransport}, and returns
 * UTF-8 text plus an optional `fileName` hint for format detection.
 */
export async function fetchOpenApiSpecUrl(
  url: string,
  options: FetchOpenApiSpecUrlOptions,
): Promise<FetchOpenApiSpecUrlResult> {
  const validated = validateOpenApiSpecUrl(url);
  if (!validated.ok) {
    return validated;
  }

  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_IMPORT_LIMITS.maxFileBytes;
  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort();
  };
  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  try {
    const response = await options.transport.execute(
      {
        method: 'GET',
        url: validated.href,
        headers: [],
        redirectPolicy: {
          mode: 'follow',
          maxRedirects: DEFAULT_MAX_REDIRECTS,
        },
        ssl: {
          verifyCertificates: true,
          extensions: {},
        },
      },
      {
        signal: controller.signal,
        maxResponseBytes,
      },
    );

    return mapTransportResponse(response, validated.href, maxResponseBytes);
  } catch (error) {
    return mapTransportError(error, maxResponseBytes);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Validates that `raw` is an http(s) URL without embedded credentials.
 * Does not fetch.
 */
export function validateOpenApiSpecUrl(
  raw: string,
):
  | { readonly ok: true; readonly href: string; readonly url: URL }
  | FetchOpenApiSpecUrlFailure {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      code: 'invalid-url',
      message: 'Invalid OpenAPI URL.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      code: 'invalid-url',
      message: 'Invalid OpenAPI URL.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      code: 'unsupported-protocol',
      message: 'Only HTTP and HTTPS URLs are supported.',
    };
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return {
      ok: false,
      code: 'credentials-unsupported',
      message:
        'Authenticated specification URLs are not supported. Remove username and password from the URL.',
    };
  }

  return { ok: true, href: parsed.href, url: parsed };
}

function mapTransportResponse(
  response: {
    readonly statusCode: number;
    readonly headers: readonly { readonly name: string; readonly value: string }[];
    readonly body: Uint8Array;
    readonly finalUrl: string;
  },
  requestedUrl: string,
  maxResponseBytes: number,
): FetchOpenApiSpecUrlResult {
  const status = response.statusCode;
  if (status === 401 || status === 403) {
    return {
      ok: false,
      code: 'auth-unsupported',
      message:
        'Authenticated OpenAPI URLs are not supported. Use a publicly reachable specification URL or import a local file.',
    };
  }
  if (status === 404) {
    return {
      ok: false,
      code: 'http-404',
      message: 'OpenAPI document returned HTTP 404.',
    };
  }
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      code: `http-${status}`,
      message: `OpenAPI document returned HTTP ${status}.`,
    };
  }

  if (response.body.byteLength > maxResponseBytes) {
    return {
      ok: false,
      code: 'response-too-large',
      message: `Specification exceeds the maximum size of ${maxResponseBytes} bytes (got ${response.body.byteLength}).`,
    };
  }

  const text = Buffer.from(response.body).toString('utf8');
  if (text.trim().length === 0) {
    return {
      ok: false,
      code: 'empty-body',
      message: 'OpenAPI document is empty.',
    };
  }

  const sourceUrl = response.finalUrl || requestedUrl;
  // Re-check the final URL after redirects — transport may land on
  // a Location that embeds credentials even when the request URL did not.
  const finalValidated = validateOpenApiSpecUrl(sourceUrl);
  if (!finalValidated.ok) {
    return finalValidated;
  }

  const contentType = findHeader(response.headers, 'content-type');
  const fileName = deriveFileNameHint(finalValidated.href, contentType);

  return {
    ok: true,
    text,
    sourceUrl: finalValidated.href,
    ...(contentType === undefined ? {} : { contentType }),
    ...(fileName === undefined ? {} : { fileName }),
  };
}

function mapTransportError(
  error: unknown,
  maxResponseBytes: number,
): FetchOpenApiSpecUrlFailure {
  if (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: unknown }).name === 'AbortError')
  ) {
    return {
      ok: false,
      code: 'cancelled',
      message: 'OpenAPI URL fetch was cancelled.',
    };
  }
  if (error instanceof HttpTransportError) {
    if (error.kind === 'response-too-large') {
      return {
        ok: false,
        code: 'response-too-large',
        message: `Specification exceeds the maximum size of ${maxResponseBytes} bytes.`,
      };
    }
    return {
      ok: false,
      code: error.kind,
      message: 'Unable to fetch OpenAPI document from the provided URL.',
    };
  }
  return {
    ok: false,
    code: 'network',
    message: 'Unable to fetch OpenAPI document from the provided URL.',
  };
}

function findHeader(
  headers: readonly { readonly name: string; readonly value: string }[],
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const header of headers) {
    if (header.name.toLowerCase() === lower) {
      return header.value;
    }
  }
  return undefined;
}

/**
 * Preference: Content-Type → URL pathname extension → omit (content sniff).
 */
export function deriveFileNameHint(
  sourceUrl: string,
  contentType: string | undefined,
): string | undefined {
  const fromType = extensionFromContentType(contentType);
  let pathname: string;
  try {
    pathname = new URL(sourceUrl).pathname;
  } catch {
    pathname = sourceUrl;
  }
  const base = pathname.split('/').filter(Boolean).pop() ?? '';
  const decoded = (() => {
    try {
      return decodeURIComponent(base);
    } catch {
      return base;
    }
  })();

  if (fromType !== undefined) {
    const stem = stripKnownSpecExtension(decoded) || 'openapi';
    return `${stem}${fromType}`;
  }

  const lower = decoded.toLowerCase();
  if (
    lower.endsWith('.json') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml')
  ) {
    return decoded;
  }

  return undefined;
}

function extensionFromContentType(
  contentType: string | undefined,
): '.json' | '.yaml' | undefined {
  if (contentType === undefined || contentType.trim().length === 0) {
    return undefined;
  }
  const media = contentType.split(';')[0]!.trim().toLowerCase();
  if (
    media === 'application/json' ||
    media.endsWith('+json') ||
    media === 'text/json'
  ) {
    return '.json';
  }
  if (
    media === 'application/yaml' ||
    media === 'application/x-yaml' ||
    media === 'text/yaml' ||
    media === 'text/x-yaml' ||
    media.endsWith('+yaml')
  ) {
    return '.yaml';
  }
  return undefined;
}

function stripKnownSpecExtension(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of ['.json', '.yaml', '.yml'] as const) {
    if (lower.endsWith(ext)) {
      return name.slice(0, -ext.length);
    }
  }
  return name;
}
