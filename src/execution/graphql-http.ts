import type {
  AuthenticatedRequest,
  RuntimeBody,
  RuntimeHeader,
  RuntimeJsonValue,
} from '../models/request';
import {
  deepFreeze,
  isSensitiveSecretKey,
  scrubTextWithKnownSecrets,
} from '../shared';
import type { ExecutionError, GraphqlEnvelopeSummary } from './contracts';

const TEXT_ENCODER = new TextEncoder();
const GRAPHQL_ERROR_MESSAGE_LIMIT = 10;
const GRAPHQL_ERROR_MESSAGE_MAX_CHARS = 200;

export type GraphqlHttpPrepareResult =
  | {
      readonly ok: true;
      readonly headers: readonly RuntimeHeader[];
      readonly body: Uint8Array;
    }
  | {
      readonly ok: false;
      readonly error: ExecutionError;
    };

/**
 * Canonicalizes a GraphQL-over-HTTP JSON body and ensures Content-Type.
 * Does not send the request. Callers pass the result to HttpTransport.execute.
 */
export function prepareGraphqlHttpRequest(
  request: AuthenticatedRequest,
): GraphqlHttpPrepareResult {
  const parsed = parseGraphqlPayload(request.body);
  if (!parsed.ok) {
    return parsed;
  }

  const canonical: {
    readonly query: string;
    readonly variables?: { readonly [key: string]: RuntimeJsonValue };
    readonly operationName?: string;
  } = {
    query: parsed.query,
    ...(parsed.variables === undefined ? {} : { variables: parsed.variables }),
    ...(parsed.operationName === undefined
      ? {}
      : { operationName: parsed.operationName }),
  };

  return {
    ok: true,
    headers: ensureJsonContentType(request.headers),
    body: TEXT_ENCODER.encode(JSON.stringify(canonical)),
  };
}

/**
 * Projects a GraphQL-over-HTTP response JSON into the additive envelope summary.
 * `errors[].message` values are scrubbed with the shared secret-masking helpers
 * before they leave execution (Run Report, diagnostics, CLI, MCP).
 */
export function graphqlEnvelopeFromJson(
  json: RuntimeJsonValue | undefined,
  sensitiveValues: readonly string[] = [],
): GraphqlEnvelopeSummary {
  if (!isJsonObject(json)) {
    return deepFreeze({
      validEnvelope: false,
      hasData: false,
      hasErrors: false,
      errorCount: 0,
      errorMessages: [],
    });
  }

  const hasOwnData = Object.prototype.hasOwnProperty.call(json, 'data');
  const hasOwnErrors = Object.prototype.hasOwnProperty.call(json, 'errors');
  const data = hasOwnData ? json.data : undefined;
  const hasData = hasOwnData && data !== null && data !== undefined;
  const errors = hasOwnErrors ? json.errors : undefined;
  if (hasOwnErrors && !Array.isArray(errors)) {
    return deepFreeze({
      validEnvelope: false,
      hasData,
      hasErrors: false,
      errorCount: 0,
      errorMessages: [],
    });
  }
  const errorList = Array.isArray(errors) ? errors : [];
  const hasErrors = errorList.length > 0;
  const errorMessages = collectGraphqlErrorMessages(errorList, sensitiveValues);

  return deepFreeze({
    validEnvelope: hasOwnData || hasOwnErrors,
    hasData,
    hasErrors,
    errorCount: hasErrors ? errorList.length : 0,
    errorMessages,
  });
}

/**
 * Envelope projection that also replaces known secrets from the request
 * (sensitive headers and GraphQL variable values).
 */
export function graphqlEnvelopeFromRequest(
  json: RuntimeJsonValue | undefined,
  request: AuthenticatedRequest,
): GraphqlEnvelopeSummary {
  return graphqlEnvelopeFromJson(json, collectGraphqlSensitiveValues(request));
}

function parseGraphqlPayload(body: RuntimeBody | undefined):
  | {
      readonly ok: true;
      readonly query: string;
      readonly variables?: { readonly [key: string]: RuntimeJsonValue };
      readonly operationName?: string;
    }
  | { readonly ok: false; readonly error: ExecutionError } {
  const raw = readGraphqlJson(body);
  if (raw === undefined) {
    return {
      ok: false,
      error: unsupportedGraphqlBody(
        'GraphQL request body must be a JSON object with a non-empty query string.',
      ),
    };
  }
  if (!isJsonObject(raw)) {
    return {
      ok: false,
      error: unsupportedGraphqlBody(
        'GraphQL request body must be a JSON object with a non-empty query string.',
      ),
    };
  }

  const query = raw.query;
  if (typeof query !== 'string' || query.trim().length === 0) {
    return {
      ok: false,
      error: unsupportedGraphqlBody(
        'GraphQL request body must include a non-empty query string.',
      ),
    };
  }

  let variables: { readonly [key: string]: RuntimeJsonValue } | undefined;
  if (Object.prototype.hasOwnProperty.call(raw, 'variables')) {
    const value = raw.variables;
    if (!isJsonObject(value)) {
      return {
        ok: false,
        error: unsupportedGraphqlBody(
          'GraphQL variables must be a JSON object when present.',
        ),
      };
    }
    variables = value;
  }

  let operationName: string | undefined;
  if (Object.prototype.hasOwnProperty.call(raw, 'operationName')) {
    const value = raw.operationName;
    if (typeof value !== 'string') {
      return {
        ok: false,
        error: unsupportedGraphqlBody(
          'GraphQL operationName must be a string when present.',
        ),
      };
    }
    if (value.trim().length > 0) {
      operationName = value;
    }
  }

  return {
    ok: true,
    query,
    ...(variables === undefined ? {} : { variables }),
    ...(operationName === undefined ? {} : { operationName }),
  };
}

function readGraphqlJson(body: RuntimeBody | undefined): unknown {
  if (body === undefined) {
    return undefined;
  }
  if (body.content.trim().length > 0) {
    try {
      return JSON.parse(body.content) as unknown;
    } catch {
      return undefined;
    }
  }
  if (body.type === 'json') {
    return body.value;
  }
  return undefined;
}

function ensureJsonContentType(
  headers: readonly RuntimeHeader[],
): readonly RuntimeHeader[] {
  const contentType = findLastHeader(headers, 'content-type');
  if (contentType === undefined) {
    return [
      ...headers,
      { name: 'Content-Type', value: 'application/json' },
    ];
  }
  return headers;
}

function findLastHeader(
  headers: readonly RuntimeHeader[],
  name: string,
): string | undefined {
  for (let index = headers.length - 1; index >= 0; index -= 1) {
    const header = headers[index];
    if (header?.name.toLowerCase() === name) {
      return header.value;
    }
  }
  return undefined;
}

function collectGraphqlErrorMessages(
  errors: readonly RuntimeJsonValue[],
  sensitiveValues: readonly string[],
): readonly string[] {
  const messages: string[] = [];
  for (const entry of errors) {
    if (messages.length >= GRAPHQL_ERROR_MESSAGE_LIMIT) {
      break;
    }
    if (!isJsonObject(entry) || typeof entry.message !== 'string') {
      continue;
    }
    const trimmed = entry.message.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const redacted = scrubTextWithKnownSecrets(trimmed, sensitiveValues);
    messages.push(
      redacted.length <= GRAPHQL_ERROR_MESSAGE_MAX_CHARS
        ? redacted
        : `${redacted.slice(0, GRAPHQL_ERROR_MESSAGE_MAX_CHARS)}…`,
    );
  }
  return messages;
}

function collectGraphqlSensitiveValues(
  request: AuthenticatedRequest,
): readonly string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  const add = (value: string): void => {
    if (value.length === 0 || seen.has(value)) {
      return;
    }
    seen.add(value);
    values.push(value);
  };

  const sensitiveHeaders = new Set(
    request.resolution.sensitiveHeaderNames.map((name) => name.toLowerCase()),
  );
  for (const header of request.headers) {
    if (!sensitiveHeaders.has(header.name.toLowerCase())) {
      continue;
    }
    add(header.value);
    const scheme = /^(Bearer|Basic)\s+(\S+)/iu.exec(header.value);
    if (scheme?.[2] !== undefined) {
      add(scheme[2]);
    }
  }

  const sensitiveVariableNames = new Set(
    request.resolution.sensitiveVariableNames.map((name) => name.toLowerCase()),
  );
  const payload = readGraphqlJson(request.body);
  if (isJsonObject(payload) && isJsonObject(payload.variables)) {
    collectSensitiveJsonStrings(
      payload.variables,
      undefined,
      sensitiveVariableNames,
      add,
    );
  }
  return values;
}

function collectSensitiveJsonStrings(
  value: RuntimeJsonValue,
  keyHint: string | undefined,
  sensitiveVariableNames: ReadonlySet<string>,
  add: (value: string) => void,
): void {
  const keySensitive =
    keyHint !== undefined &&
    (sensitiveVariableNames.has(keyHint.toLowerCase()) ||
      isSensitiveSecretKey(keyHint));
  if (typeof value === 'string') {
    if (keySensitive) {
      add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSensitiveJsonStrings(
        entry,
        keyHint,
        sensitiveVariableNames,
        add,
      );
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      collectSensitiveJsonStrings(
        child,
        key,
        sensitiveVariableNames,
        add,
      );
    }
  }
}

function isJsonObject(
  value: unknown,
): value is { readonly [key: string]: RuntimeJsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unsupportedGraphqlBody(message: string): ExecutionError {
  return deepFreeze({
    code: 'UNSUPPORTED_BODY',
    message,
    retryable: false,
  });
}
