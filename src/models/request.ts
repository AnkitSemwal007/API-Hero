import type { HttpMethod, RequestId } from '../types';

export type { HttpMethod } from '../types';

/** A case-preserving, ordered HTTP header. Duplicate names remain distinct. */
export interface RuntimeHeader {
  readonly name: string;
  readonly value: string;
}

/**
 * An ordered URL parameter whose name and value remain encoded exactly as
 * written. A missing value differs from an explicitly empty value.
 */
export interface RuntimeQueryParameter {
  readonly name: string;
  readonly value?: string;
}

/** An unresolved template occurrence retained for a later resolution layer. */
export interface RuntimeVariablePlaceholder {
  readonly name: string;
  readonly originalText: string;
}

/** An unresolved template occurrence found in the URL path. */
export type RuntimePathParameter = RuntimeVariablePlaceholder;

export type RuntimeBodyType =
  | 'none'
  | 'json'
  | 'text'
  | 'form'
  | 'raw'
  | 'multipart'
  | 'binary';

export type RuntimeJsonPrimitive = string | number | boolean | null;
export type RuntimeJsonValue =
  | RuntimeJsonPrimitive
  | { readonly [key: string]: RuntimeJsonValue }
  | readonly RuntimeJsonValue[];

interface RuntimeBodyBase {
  readonly type: Exclude<RuntimeBodyType, 'none'>;
  /** Original parser-produced content. It is not variable-resolved. */
  readonly content: string;
}

export interface RuntimeJsonBody extends RuntimeBodyBase {
  readonly type: 'json';
  /**
   * A detached immutable projection for consumers that need structured JSON.
   * `content` remains authoritative and preserves duplicate object keys.
   */
  readonly value: RuntimeJsonValue;
}

export interface RuntimeTextBody extends RuntimeBodyBase {
  readonly type: 'text';
}

export interface RuntimeFormBody extends RuntimeBodyBase {
  readonly type: 'form';
  /** Ordered, encoded fields. Duplicate names and empty fields are preserved. */
  readonly fields: readonly RuntimeQueryParameter[];
}

export interface RuntimeRawBody extends RuntimeBodyBase {
  readonly type: 'raw';
}

/** Stable multipart extension shape; the builder does not parse parts yet. */
export interface RuntimeMultipartPart {
  readonly name?: string;
  readonly headers: readonly RuntimeHeader[];
  readonly content?: string;
  readonly sourceReference?: string;
  readonly extensions: Readonly<Record<string, unknown>>;
}

export interface RuntimeMultipartBody extends RuntimeBodyBase {
  readonly type: 'multipart';
  readonly parts: readonly RuntimeMultipartPart[];
}

/** Reserved runtime shape; binary loading belongs to a later resolution layer. */
export interface RuntimeBinaryBody extends RuntimeBodyBase {
  readonly type: 'binary';
}

export type RuntimeBody =
  | RuntimeJsonBody
  | RuntimeTextBody
  | RuntimeFormBody
  | RuntimeRawBody
  | RuntimeMultipartBody
  | RuntimeBinaryBody;

export interface AuthenticationPlaceholder {
  readonly kind: 'none' | 'unresolved';
  /** Unresolved value of the effective `@auth` directive. */
  readonly reference?: string;
  readonly extensions: Readonly<Record<string, unknown>>;
}

/**
 * Future authentication resolvers replace a placeholder with this
 * transport-neutral shape while producing a new immutable RuntimeRequest.
 */
export interface ResolvedRuntimeAuthentication {
  readonly kind: 'resolved';
  readonly scheme: string;
  readonly material: Readonly<Record<string, unknown>>;
  readonly extensions: Readonly<Record<string, unknown>>;
}

export type RuntimeAuthentication =
  | AuthenticationPlaceholder
  | ResolvedRuntimeAuthentication;

export interface RuntimeEnvironmentPlaceholder {
  readonly kind: 'none' | 'unresolved';
  readonly reference?: string;
  readonly extensions: Readonly<Record<string, unknown>>;
}

export interface RuntimeCookie {
  readonly name: string;
  readonly value?: string;
  readonly domain?: string;
  readonly path?: string;
  readonly extensions: Readonly<Record<string, unknown>>;
}

export interface RuntimeRedirectPolicy {
  readonly mode: 'follow' | 'manual' | 'error';
  readonly maxRedirects?: number;
}

export interface RuntimeSslOptions {
  readonly verifyCertificates: boolean;
  /** Future secret/certificate lookup reference; never resolved by the builder. */
  readonly clientCertificateReference?: string;
  readonly extensions: Readonly<Record<string, unknown>>;
}

/** Parser-independent representation of a directive relevant at runtime. */
export interface RuntimeDirective {
  readonly name: string;
  readonly value: string;
}

export interface RuntimeConfiguration {
  readonly connectionReference?: string;
  readonly directives: readonly RuntimeDirective[];
  readonly extensions: Readonly<Record<string, unknown>>;
}

export interface RuntimeMetadata {
  readonly sourceId?: string;
  readonly declarationIndex: number;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly extensions: Readonly<Record<string, unknown>>;
}

/** Reserved proxy configuration; no proxy behavior is implemented. */
export interface RuntimeProxyOptions {
  readonly reference?: string;
  readonly extensions: Readonly<Record<string, unknown>>;
}

/** Reserved retry configuration; no retry behavior is implemented. */
export interface RuntimeRetryOptions {
  readonly maxAttempts?: number;
  readonly extensions: Readonly<Record<string, unknown>>;
}

/** Reserved streaming configuration; no streaming behavior is implemented. */
export interface RuntimeStreamingOptions {
  readonly mode?: 'buffered' | 'stream';
  readonly extensions: Readonly<Record<string, unknown>>;
}

/** Transport-independent options carried by every runtime request. */
export interface RuntimeExecutionOptions {
  readonly timeoutMs?: number;
  readonly redirectPolicy: RuntimeRedirectPolicy;
  readonly ssl: RuntimeSslOptions;
  readonly proxy?: RuntimeProxyOptions;
  readonly retry?: RuntimeRetryOptions;
  readonly streaming?: RuntimeStreamingOptions;
  readonly executionExtensions: Readonly<Record<string, unknown>>;
}

/** Safe presentation metadata attached only after variable resolution. */
export interface RuntimeVariableResolution {
  readonly kind: 'resolved';
  readonly presentationUrl: string;
  readonly sensitiveVariableNames: readonly string[];
  /** Lower-case names added by authentication and stripped cross-origin. */
  readonly sensitiveHeaderNames: readonly string[];
  /** Decoded query names whose values are masked in presentationUrl. */
  readonly sensitiveQueryParameterNames: readonly string[];
}

/**
 * Immutable executable request contract and sole input to future execution
 * engines. Instances produced by the request builder are deeply frozen.
 */
export interface RuntimeRequest extends RuntimeExecutionOptions {
  readonly id: RequestId;
  readonly name?: string;
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: readonly RuntimeHeader[];
  readonly queryParameters: readonly RuntimeQueryParameter[];
  readonly pathParameters: readonly RuntimePathParameter[];
  readonly cookies: readonly RuntimeCookie[];
  readonly body?: RuntimeBody;
  readonly bodyType: RuntimeBodyType;
  readonly authentication: RuntimeAuthentication;
  readonly variables: readonly RuntimeVariablePlaceholder[];
  readonly environment: RuntimeEnvironmentPlaceholder;
  readonly metadata: RuntimeMetadata;
  readonly configuration: RuntimeConfiguration;
  readonly resolution?: RuntimeVariableResolution;
}

/**
 * Additive post-variable stage. The required resolution member prevents a
 * parser-built request from crossing a resolved-only boundary.
 */
export type ResolvedRequest = RuntimeRequest & {
  readonly resolution: RuntimeVariableResolution;
};

/** Authentication has run exactly once, including the explicit none case. */
export type AuthenticatedRequest = Omit<
  ResolvedRequest,
  'authentication' | 'resolution'
> & {
  readonly authentication: ResolvedRuntimeAuthentication;
  readonly resolution: RuntimeVariableResolution;
  readonly authenticationStage: 'authenticated';
};

/*
 * Compatibility aliases. Runtime* names own the structures above; legacy
 * Request-facing imports remain source-compatible without parallel models.
 */
export type Header = RuntimeHeader;
export type RequestParameter = RuntimeQueryParameter;
export type VariablePlaceholder = RuntimeVariablePlaceholder;
export type RequestBodyType = RuntimeBodyType;
export type RequestJsonPrimitive = RuntimeJsonPrimitive;
export type RequestJsonValue = RuntimeJsonValue;
export type JsonRequestBody = RuntimeJsonBody;
export type TextRequestBody = RuntimeTextBody;
export type FormRequestBody = RuntimeFormBody;
export type RawRequestBody = RuntimeRawBody;
export type MultipartRequestBody = RuntimeMultipartBody;
export type BinaryRequestBody = RuntimeBinaryBody;
export type RequestBody = RuntimeBody;
export type RequestRedirectPolicy = RuntimeRedirectPolicy;
export type RequestSslOptions = RuntimeSslOptions;
export type RequestRuntimeConfiguration = RuntimeConfiguration;
export type RequestMetadata = RuntimeMetadata;
export type Request = RuntimeRequest;
