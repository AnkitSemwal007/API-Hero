import type {
  AuthenticatedRequest,
  RuntimeBody,
  RuntimeHeader,
  VariableValue,
} from '../models';
import { MASKED_HEADER_VALUE } from '../response/presentation';
import {
  isSensitiveHttpHeaderName,
  redactUrlUserinfo,
} from '../shared';
import { MASKED_VARIABLE_VALUE } from '../variables';
import { posixSingleQuote } from './shell-escape';

/**
 * Secrets redacted by default when generating cURL:
 * - URL uses `resolution.presentationUrl` (sensitive query / path vars masked)
 *   plus `redactUrlUserinfo` defense-in-depth
 * - Headers listed in `resolution.sensitiveHeaderNames`, well-known auth/API-key/
 *   cookie headers (see `SENSITIVE_HTTP_HEADER_NAMES`), or whose values equal
 *   a sensitive variable value → mask
 * - Body content: occurrences of sensitive variable values → mask
 * - Basic auth (`-u`) uses masked user:password when scheme is `basic`
 *
 * The request is never executed; only the authenticated/resolved shape is used.
 */
export interface CurlGenerationOptions {
  /**
   * When true (default), secrets are masked using resolution metadata and
   * sensitive variable values. Set false only for trusted local debugging.
   */
  readonly redactSecrets?: boolean;
  /**
   * Variable values from {@link ExecutionOrchestrator.resolveAtSourceLocation}.
   * Required when `redactSecrets` is enabled (the default). Pass an empty Map
   * when no variables were resolved so body/header value masking cannot fail open.
   */
  readonly values?: ReadonlyMap<string, VariableValue>;
}

/**
 * Framework-neutral cURL generator. No VS Code imports.
 * Accepts an authenticated request (headers/query already applied by auth).
 *
 * When secret redaction is enabled (default), {@link CurlGenerationOptions.values}
 * must be supplied (use an empty Map when nothing was resolved) so body and
 * header value masking cannot fail open.
 */
export function generateCurl(
  request: AuthenticatedRequest,
  options: CurlGenerationOptions = {},
): string {
  const redact = options.redactSecrets !== false;
  if (redact && options.values === undefined) {
    throw new Error(
      'generateCurl: options.values is required when redactSecrets is enabled. Pass an empty Map when no variables were resolved.',
    );
  }
  const sensitiveValues = collectSensitiveValues(options.values);
  const parts: string[] = ['curl'];

  const method = request.method.toUpperCase();
  if (method !== 'GET') {
    parts.push('-X', posixSingleQuote(method));
  }

  const useBasicUser = redact && request.authentication.scheme === 'basic';
  if (useBasicUser) {
    parts.push(
      '-u',
      posixSingleQuote(`${MASKED_VARIABLE_VALUE}:${MASKED_VARIABLE_VALUE}`),
    );
  }

  const url = redact
    ? redactUrlUserinfo(request.resolution.presentationUrl)
    : request.url;
  parts.push(posixSingleQuote(url));

  for (const header of request.headers) {
    if (
      useBasicUser &&
      header.name.toLowerCase() === 'authorization'
    ) {
      continue;
    }
    const value = redact
      ? redactHeaderValue(header, request, sensitiveValues)
      : header.value;
    parts.push(
      '-H',
      posixSingleQuote(`${header.name}: ${value}`),
    );
  }

  const bodyContent = serializeCurlBody(request.body);
  if (bodyContent !== undefined) {
    const data = redact
      ? redactBodyContent(bodyContent, sensitiveValues)
      : bodyContent;
    parts.push('--data-raw', posixSingleQuote(data));
  }

  return parts.join(' ');
}

/**
 * Body serialization aligned with request-executor `serializeBody` semantics:
 * JSON/text/form/raw use authoritative `content`; empty multipart is an empty
 * body; non-empty multipart and binary are skipped (unsupported).
 */
function serializeCurlBody(body: RuntimeBody | undefined): string | undefined {
  if (body === undefined) {
    return undefined;
  }
  if (body.type === 'binary') {
    return undefined;
  }
  if (body.type === 'multipart') {
    if (body.parts.length > 0 || body.content.length > 0) {
      return undefined;
    }
    return '';
  }
  return body.content;
}

/** Well-known sensitive headers — shared with MCP / UI presentation. */
function redactHeaderValue(
  header: RuntimeHeader,
  request: AuthenticatedRequest,
  sensitiveValues: readonly string[],
): string {
  const lower = header.name.toLowerCase();
  if (
    request.resolution.sensitiveHeaderNames.includes(lower) ||
    isSensitiveHttpHeaderName(header.name)
  ) {
    return MASKED_HEADER_VALUE;
  }
  if (containsSensitiveValue(header.value, sensitiveValues)) {
    return MASKED_HEADER_VALUE;
  }
  return header.value;
}

function redactBodyContent(
  content: string,
  sensitiveValues: readonly string[],
): string {
  let next = content;
  // Longest-first so overlapping secrets redact completely.
  const ordered = [...sensitiveValues].sort((a, b) => b.length - a.length);
  for (const secret of ordered) {
    if (secret.length === 0) {
      continue;
    }
    next = next.split(secret).join(MASKED_VARIABLE_VALUE);
  }
  return next;
}

function collectSensitiveValues(
  values: ReadonlyMap<string, VariableValue> | undefined,
): readonly string[] {
  if (values === undefined) {
    return [];
  }
  const secrets: string[] = [];
  for (const value of values.values()) {
    if (value.sensitive && value.value.length > 0) {
      secrets.push(value.value);
    }
  }
  return secrets;
}

function containsSensitiveValue(
  text: string,
  sensitiveValues: readonly string[],
): boolean {
  return sensitiveValues.some(
    (secret) => secret.length > 0 && text.includes(secret),
  );
}
