import type {
  HttpMethod,
  AuthenticatedRequest,
  RuntimeHeader,
  RuntimeJsonValue,
  RuntimeRedirectPolicy,
  RuntimeSslOptions,
} from '../models/request';
import type { RequestId } from '../types';

/** Per-call execution controls. Request-owned defaults remain on the request. */
export interface ExecutionContext {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /**
   * Maximum response body size in bytes. `0` or `undefined` means unlimited.
   * When exceeded during transport buffering, execution fails with
   * `RESPONSE_TOO_LARGE`.
   */
  readonly maxResponseBytes?: number;
}

/** Compatibility name for the call-owned execution context. */
export type RequestExecutionOptions = ExecutionContext;

export interface ExecutionTiming {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

/** Ordered, case-preserving response header. Duplicate names remain distinct. */
export type RuntimeResponseHeader = RuntimeHeader;

import type { ImmutableBytes } from '../shared';

export interface RuntimeResponseBody {
  /**
   * Detached, sealed response bytes. Ownership is sealed at the execution
   * boundary: consumers must not mutate published bytes. Prefer `length` /
   * `byteLength`, `at`, and copy-out (`slice` / `copyOut`) over retaining
   * transport-owned memory.
   *
   * Streaming transports may later expose an alternate delivery path without
   * changing this buffered-body representation.
   */
  readonly bytes: ImmutableBytes;
  /** Present for text-like media types. */
  readonly text?: string;
  /** Present when a JSON media type contains valid JSON. */
  readonly json?: RuntimeJsonValue;
}

export interface RuntimeResponse {
  readonly requestId: RequestId;
  readonly statusCode: number;
  readonly statusText: string;
  readonly headers: readonly RuntimeResponseHeader[];
  readonly body: RuntimeResponseBody;
  readonly bodySizeBytes: number;
  readonly contentType?: string;
  readonly url: string;
  readonly redirected: boolean;
  readonly redirectCount: number;
  readonly timing: ExecutionTiming;
}

export type ExecutionErrorCode =
  | 'MALFORMED_URL'
  | 'UNSUPPORTED_BODY'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'DNS'
  | 'SSL_TLS'
  | 'CONNECTION_REFUSED'
  | 'NETWORK'
  | 'REDIRECT'
  | 'RESPONSE_TOO_LARGE'
  | 'UNEXPECTED';

export interface ExecutionErrorCause {
  readonly name?: string;
  readonly code?: string;
  readonly message?: string;
}

export interface ExecutionError {
  readonly code: ExecutionErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: ExecutionErrorCause;
}

/** Minimal, detached request context needed by result presentation consumers. */
export interface ExecutionRequestSummary {
  readonly method: HttpMethod;
  readonly url: string;
}

export interface SuccessfulExecutionResult {
  readonly success: true;
  readonly requestId: RequestId;
  /** Additive context; optional for compatibility with existing result producers. */
  readonly request?: ExecutionRequestSummary;
  readonly response: RuntimeResponse;
  readonly timing: ExecutionTiming;
}

export interface FailedExecutionResult {
  readonly success: false;
  readonly requestId: RequestId;
  /** Additive context; optional for compatibility with existing result producers. */
  readonly request?: ExecutionRequestSummary;
  readonly error: ExecutionError;
  readonly timing: ExecutionTiming;
}

export type ExecutionResult =
  | SuccessfulExecutionResult
  | FailedExecutionResult;

/** Parser-free public request execution boundary. */
export interface RequestExecutor {
  execute(
    request: AuthenticatedRequest,
    context?: ExecutionContext,
  ): Promise<ExecutionResult>;
}

/** Serialized request supplied to an HTTP transport implementation. */
export interface HttpTransportRequest {
  readonly method: HttpMethod;
  /** Authoritative URL, including its already-serialized query string. */
  readonly url: string;
  readonly headers: readonly RuntimeHeader[];
  readonly body?: Uint8Array;
  readonly redirectPolicy: RuntimeRedirectPolicy;
  readonly ssl: RuntimeSslOptions;
  /** Lower-case credential-bearing headers stripped on cross-origin redirect. */
  readonly sensitiveHeaderNames?: readonly string[];
}

export interface HttpTransportContext {
  readonly signal: AbortSignal;
  /**
   * Maximum buffered response body size in bytes. `0` or `undefined` means
   * unlimited. Future streaming methods can reuse this limit without changing
   * the buffered `HttpTransportResponse.body` contract.
   */
  readonly maxResponseBytes?: number;
}

/** Raw response returned within the execution boundary by a transport. */
export interface HttpTransportResponse {
  readonly statusCode: number;
  readonly statusText: string;
  readonly headers: readonly RuntimeHeader[];
  readonly body: Uint8Array;
  readonly finalUrl: string;
  readonly redirected: boolean;
  readonly redirectCount: number;
}

export type HttpTransportErrorKind =
  | 'dns'
  | 'ssl-tls'
  | 'connection-refused'
  | 'network'
  /** Non-retryable redirect policy, limit, or target failures. */
  | 'redirect'
  /** Response body exceeded the configured maximum while buffering. */
  | 'response-too-large';

/**
 * A classified operational transport failure. Executors convert this to an
 * immutable ExecutionError rather than exposing the Error instance.
 */
export class HttpTransportError extends Error {
  public constructor(
    public readonly kind: HttpTransportErrorKind,
    message: string,
    public readonly causeCode?: string,
  ) {
    super(message);
    this.name = 'HttpTransportError';
  }
}

/** A transport implementation violated its programming contract. */
export class HttpTransportInvariantError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'HttpTransportInvariantError';
  }
}

/**
 * Buffered HTTP transport boundary. Implementations fully buffer the response
 * body today. A future streaming variant can add an alternate method (or a
 * parallel streaming response type) without redesigning `RuntimeResponseBody`.
 */
export interface HttpTransport {
  execute(
    request: HttpTransportRequest,
    context: HttpTransportContext,
  ): Promise<HttpTransportResponse>;
}
