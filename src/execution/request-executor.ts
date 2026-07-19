import type {
  RuntimeBody,
  RuntimeJsonValue,
  AuthenticatedRequest,
} from '../models/request';
import { freezeDetachedBytes, deepFreeze, redactUrlUserinfo } from '../shared';
import {
  HttpTransportError,
  HttpTransportInvariantError,
  type ExecutionContext,
  type ExecutionError,
  type ExecutionErrorCode,
  type ExecutionResult,
  type ExecutionTiming,
  type HttpTransport,
  type HttpTransportResponse,
  type RequestExecutor,
  type RuntimeResponse,
  type RuntimeResponseBody,
} from './contracts';

export interface ExecutionClock {
  now(): number;
}

const SYSTEM_CLOCK: ExecutionClock = Object.freeze({ now: () => Date.now() });
const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

type CancellationKind = 'cancelled' | 'timeout';

class ExecutionAborted {
  public constructor(public readonly kind: CancellationKind) {}
}

/** Default transport-independent implementation of the execution pipeline. */
export class DefaultRequestExecutor implements RequestExecutor {
  public constructor(
    private readonly transport: HttpTransport,
    private readonly clock: ExecutionClock = SYSTEM_CLOCK,
  ) {}

  public async execute(
    request: AuthenticatedRequest,
    context: ExecutionContext = {},
  ): Promise<ExecutionResult> {
    const started = this.clock.now();
    const timeoutMs = effectiveTimeout(request, context);
    const maxResponseBytes = effectiveMaxResponseBytes(context);

    if (context.signal?.aborted === true) {
      return failure(request, cancellationError('cancelled'), timing(started, this.clock.now()));
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(request.url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new TypeError(`Unsupported URL protocol: ${parsedUrl.protocol}`);
      }
    } catch (error) {
      return failure(
        request,
        executionError(
          'MALFORMED_URL',
          `The request URL is not a valid HTTP(S) URL: ${publicRequestUrl(request)}`,
          false,
          error,
        ),
        timing(started, this.clock.now()),
      );
    }

    const serializedBody = serializeBody(request.body);
    if (serializedBody.error !== undefined) {
      return failure(
        request,
        serializedBody.error,
        timing(started, this.clock.now()),
      );
    }

    const controller = new AbortController();
    let cancellationKind: CancellationKind | undefined;
    const abort = (kind: CancellationKind): void => {
      if (cancellationKind === undefined) {
        cancellationKind = kind;
        controller.abort(kind);
      }
    };
    const onCallerAbort = (): void => abort('cancelled');
    context.signal?.addEventListener('abort', onCallerAbort, { once: true });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined && timeoutMs > 0) {
      timeout = setTimeout(() => abort('timeout'), timeoutMs);
    }

    const transportPromise = Promise.resolve().then(() =>
      this.transport.execute(
        {
          method: request.method,
          url: request.url,
          headers: request.headers,
          ...(serializedBody.body === undefined
            ? {}
            : { body: serializedBody.body }),
          redirectPolicy: request.redirectPolicy,
          ssl: request.ssl,
          sensitiveHeaderNames: request.resolution.sensitiveHeaderNames,
        },
        {
          signal: controller.signal,
          ...(maxResponseBytes === undefined
            ? {}
            : { maxResponseBytes }),
        },
      ),
    );
    // A transport may ignore AbortSignal. Racing guarantees prompt completion;
    // this handler also prevents a late rejection from becoming unhandled.
    void transportPromise.catch(() => undefined);
    let onInternalAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      onInternalAbort = (): void =>
        reject(new ExecutionAborted(cancellationKind ?? 'cancelled'));
      if (controller.signal.aborted) {
        onInternalAbort();
      } else {
        controller.signal.addEventListener('abort', onInternalAbort, {
          once: true,
        });
      }
    });

    try {
      const raw = await Promise.race([transportPromise, abortPromise]);
      const responseTiming = timing(started, this.clock.now());
      const response = toRuntimeResponse(request, raw, responseTiming);
      return deepFreeze({
        success: true,
        requestId: request.id,
        request: requestSummary(request),
        response,
        timing: responseTiming,
      });
    } catch (error) {
      if (error instanceof HttpTransportInvariantError) {
        throw error;
      }
      const completedTiming = timing(started, this.clock.now());
      if (error instanceof ExecutionAborted) {
        return failure(request, cancellationError(error.kind), completedTiming);
      }
      return failure(request, classifyFailure(error), completedTiming);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (onInternalAbort !== undefined) {
        controller.signal.removeEventListener('abort', onInternalAbort);
      }
      context.signal?.removeEventListener('abort', onCallerAbort);
    }
  }
}

function effectiveTimeout(
  request: AuthenticatedRequest,
  context: ExecutionContext,
): number | undefined {
  const timeoutMs = context.timeoutMs ?? request.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0)
  ) {
    throw new TypeError('Execution timeout must be a non-negative safe integer.');
  }
  return timeoutMs;
}

function effectiveMaxResponseBytes(
  context: ExecutionContext,
): number | undefined {
  const maxResponseBytes = context.maxResponseBytes;
  if (
    maxResponseBytes !== undefined &&
    (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0)
  ) {
    throw new TypeError(
      'Execution maxResponseBytes must be a non-negative safe integer.',
    );
  }
  return maxResponseBytes;
}

function serializeBody(
  body: RuntimeBody | undefined,
): { readonly body?: Uint8Array; readonly error?: ExecutionError } {
  if (body === undefined) {
    return {};
  }
  if (body.type === 'binary') {
    return {
      error: executionError(
        'UNSUPPORTED_BODY',
        'Binary request bodies require a future file-loading layer.',
        false,
      ),
    };
  }
  if (body.type === 'multipart') {
    if (body.parts.length > 0 || body.content.length > 0) {
      return {
        error: executionError(
          'UNSUPPORTED_BODY',
          'Non-empty multipart request bodies are not supported.',
          false,
        ),
      };
    }
    return { body: new Uint8Array(0) };
  }
  // Original content is authoritative for JSON, text, raw, and form bodies.
  return { body: TEXT_ENCODER.encode(body.content) };
}

function toRuntimeResponse(
  request: AuthenticatedRequest,
  response: HttpTransportResponse,
  responseTiming: ExecutionTiming,
): RuntimeResponse {
  assertTransportResponse(response);
  const contentType = findLastHeader(response.headers, 'content-type');
  const textAndJson = isTextLike(contentType)
    ? responseTextAndJson(response.body, contentType)
    : {};
  const bytes = freezeDetachedBytes(response.body);
  const responseBody: RuntimeResponseBody = {
    bytes,
    ...textAndJson,
  };
  return deepFreeze({
    requestId: request.id,
    statusCode: response.statusCode,
    statusText: response.statusText,
    headers: response.headers.map((header) => ({
      name: header.name,
      value: header.value,
    })),
    body: responseBody,
    bodySizeBytes: bytes.byteLength,
    ...(contentType === undefined ? {} : { contentType }),
    url: request.resolution.presentationUrl === request.url
      ? response.finalUrl
      : request.resolution.presentationUrl,
    redirected: response.redirected,
    redirectCount: response.redirectCount,
    timing: responseTiming,
  });
}

function assertTransportResponse(response: HttpTransportResponse): void {
  if (
    !Number.isInteger(response.statusCode) ||
    response.statusCode < 100 ||
    response.statusCode > 999 ||
    !Number.isSafeInteger(response.redirectCount) ||
    response.redirectCount < 0 ||
    !(response.body instanceof Uint8Array)
  ) {
    throw new HttpTransportInvariantError(
      'HTTP transport returned an invalid response.',
    );
  }
}

function responseTextAndJson(
  body: Uint8Array,
  contentType: string | undefined,
): Pick<RuntimeResponseBody, 'text' | 'json'> {
  const text = TEXT_DECODER.decode(body);
  if (!isJsonMediaType(contentType) || text.length === 0) {
    return { text };
  }
  try {
    return { text, json: JSON.parse(text) as RuntimeJsonValue };
  } catch {
    return { text };
  }
}

function isTextLike(contentType: string | undefined): boolean {
  if (contentType === undefined) {
    return false;
  }
  const type = contentType.split(';', 1)[0]!.trim().toLowerCase();
  return (
    type.startsWith('text/') ||
    isJsonMediaType(type) ||
    type.endsWith('+xml') ||
    type === 'application/xml' ||
    type === 'application/x-www-form-urlencoded' ||
    type === 'application/javascript'
  );
}

function isJsonMediaType(contentType: string | undefined): boolean {
  const type = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  return type === 'application/json' || type?.endsWith('+json') === true;
}

function findLastHeader(
  headers: readonly { readonly name: string; readonly value: string }[],
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

function classifyFailure(error: unknown): ExecutionError {
  if (error instanceof HttpTransportError) {
    const mapping: Readonly<
      Record<
        typeof error.kind,
        { readonly code: ExecutionErrorCode; readonly retryable: boolean }
      >
    > = {
      // Transient name resolution and socket connect failures may succeed on retry.
      dns: { code: 'DNS', retryable: true },
      'connection-refused': { code: 'CONNECTION_REFUSED', retryable: true },
      network: { code: 'NETWORK', retryable: true },
      // Certificate and redirect-policy/target failures are deterministic.
      'ssl-tls': { code: 'SSL_TLS', retryable: false },
      redirect: { code: 'REDIRECT', retryable: false },
      'response-too-large': { code: 'RESPONSE_TOO_LARGE', retryable: false },
    };
    const classified = mapping[error.kind];
    return executionError(
      classified.code,
      safeTransportMessage(classified.code),
      classified.retryable,
      error,
      error.causeCode,
    );
  }
  return executionError(
    'UNEXPECTED',
    'An unexpected runtime error occurred while executing the request.',
    false,
    error,
  );
}

function cancellationError(kind: CancellationKind): ExecutionError {
  return executionError(
    kind === 'timeout' ? 'TIMEOUT' : 'CANCELLED',
    kind === 'timeout'
      ? 'The request exceeded its configured timeout.'
      : 'The request was cancelled by the caller.',
    kind === 'timeout',
  );
}

function executionError(
  code: ExecutionErrorCode,
  message: string,
  retryable: boolean,
  cause?: unknown,
  causeCode?: string,
): ExecutionError {
  const metadata = causeMetadata(cause, causeCode);
  return deepFreeze({
    code,
    message,
    retryable,
    ...(metadata === undefined ? {} : { cause: metadata }),
  });
}

function causeMetadata(
  cause: unknown,
  causeCode?: string,
): ExecutionError['cause'] | undefined {
  if (!(cause instanceof Error) && causeCode === undefined) {
    return undefined;
  }
  return {
    ...(cause instanceof Error ? { name: cause.name } : {}),
    ...(causeCode === undefined ? {} : { code: causeCode }),
  };
}

function safeTransportMessage(code: ExecutionErrorCode): string {
  switch (code) {
    case 'DNS': return 'The request host could not be resolved.';
    case 'SSL_TLS': return 'The secure connection could not be established.';
    case 'CONNECTION_REFUSED': return 'The remote host refused the connection.';
    case 'REDIRECT': return 'The request could not follow the server redirect.';
    case 'RESPONSE_TOO_LARGE':
      return 'The response exceeded the configured maximum size.';
    default: return 'The request failed because of a network error.';
  }
}

function timing(started: number, completed: number): ExecutionTiming {
  const safeCompleted = Math.max(started, completed);
  return deepFreeze({
    startedAt: new Date(started).toISOString(),
    completedAt: new Date(safeCompleted).toISOString(),
    durationMs: safeCompleted - started,
  });
}

function failure(
  request: AuthenticatedRequest,
  error: ExecutionError,
  executionTiming: ExecutionTiming,
): ExecutionResult {
  return deepFreeze({
    success: false,
    requestId: request.id,
    request: requestSummary(request),
    error,
    timing: executionTiming,
  });
}

function requestSummary(
  request: AuthenticatedRequest,
): { readonly method: AuthenticatedRequest['method']; readonly url: string } {
  return {
    method: request.method,
    url: publicRequestUrl(request),
  };
}

function publicRequestUrl(request: AuthenticatedRequest): string {
  // The masked presentation URL is required on an authenticated request. A
  // missing value means an invariant-bypassed object; fail rather than fall
  // back to request.url, which could expose an API key placed in the query.
  const presentationUrl = request.resolution?.presentationUrl;
  if (typeof presentationUrl !== 'string') {
    throw new HttpTransportInvariantError(
      'An authenticated request is missing its masked presentation URL.',
    );
  }
  return redactUrlUserinfo(presentationUrl);
}
