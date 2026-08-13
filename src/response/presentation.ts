import type {
  ExecutionErrorCode,
  ExecutionResult,
  GraphqlEnvelopeSummary,
  RuntimeResponse,
  WebsocketSessionSummary,
} from '../execution';
import type { TestReport } from '../assertions';
import { maskAssertionText } from '../assertions';
import type { ExtractionReport } from '../extraction';
import {
  deepFreeze,
  isSensitiveHttpHeaderName,
  redactUrlUserinfo,
} from '../shared';
import { MASKED_VARIABLE_VALUE } from '../variables';
import {
  buildFailureExplanation,
  type FailureExplanation,
} from './failure-explanations';

export const RESPONSE_TEXT_PREVIEW_LIMIT = 256 * 1024;
export const RESPONSE_BINARY_PREVIEW_LIMIT = 4 * 1024;
export const MASKED_HEADER_VALUE = '••••••••';

export type ResponseBodyLanguage = 'json' | 'html' | 'xml' | 'text' | 'binary';

export interface PresentedHeader {
  readonly name: string;
  readonly value: string;
  readonly masked: boolean;
}

export interface PresentedCookie {
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
  readonly path?: string;
}

/**
 * Cookie jar data for the response viewer. Until a jar exists, presentation
 * always emits `{ available: false }` so the Cookies tab stays hidden.
 */
export type PresentedCookies =
  | {
      readonly available: false;
      readonly setCookieHeaderCount: number;
    }
  | {
      readonly available: true;
      readonly entries: readonly PresentedCookie[];
      readonly setCookieHeaderCount: number;
    };

export interface ResponseBodyPresentation {
  readonly language: ResponseBodyLanguage;
  readonly raw: string;
  readonly pretty: string;
  readonly prettyAvailable: boolean;
  readonly truncated: boolean;
  readonly displayedUnits: number;
  readonly totalUnits: number;
  readonly unit: 'characters' | 'bytes';
}

export interface ResponseStatistics {
  readonly durationMs: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly bodySizeBytes?: number;
  /** Estimated status line, header, and body bytes for display only. */
  readonly responseSizeBytes?: number;
  readonly headerCount: number;
  readonly contentType?: string;
  readonly encoding?: string;
  readonly redirected: boolean;
  readonly redirectCount: number;
  readonly finalUrl?: string;
}

export interface ResponseFailurePresentation {
  readonly code: ExecutionErrorCode;
  readonly title: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: {
    readonly name?: string;
    readonly code?: string;
    readonly message?: string;
  };
}

/**
 * Optional context for deterministic failure explanations (environment label,
 * configured timeout). Never carries secrets.
 */
export interface PresentExecutionOptions {
  readonly environmentLabel?: string;
  readonly timeoutMs?: number;
}

export interface PresentedAssertionFailure {
  readonly assertionText: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly reason: string;
  readonly context?: string;
}

export interface PresentedAssertion {
  readonly text: string;
  readonly outcome: 'passed' | 'failed' | 'skipped' | 'malformed';
  readonly failure?: PresentedAssertionFailure;
}

export interface PresentedAssertionSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly malformed: number;
  readonly passPercent: number;
  readonly durationMs: number;
}

export interface PresentedAssertions {
  readonly summary: PresentedAssertionSummary;
  readonly assertions: readonly PresentedAssertion[];
}

export interface PresentedExtractionOutcome {
  readonly variableName: string;
  readonly sourceLabel: string;
  readonly outcome: 'extracted' | 'failed' | 'skipped' | 'malformed';
  readonly maskedValue?: string;
  readonly reason?: string;
}

export interface PresentedExtractionSummary {
  readonly total: number;
  readonly extracted: number;
  readonly failed: number;
  readonly skipped: number;
  readonly malformed: number;
}

export interface PresentedExtraction {
  readonly summary: PresentedExtractionSummary;
  readonly outcomes: readonly PresentedExtractionOutcome[];
  /** Chip label, e.g. `Extracted 2` or `Extract 1 failed`. */
  readonly chipLabel: string;
}

export interface ResponsePresentation {
  readonly success: boolean;
  readonly requestId: string;
  readonly method: string;
  readonly requestUrl: string;
  readonly status?: {
    readonly code: number;
    readonly text: string;
  };
  readonly headers: readonly PresentedHeader[];
  /**
   * Cookie jar projection. When `available` is false the viewer hides the
   * Cookies tab entirely — Set-Cookie values remain masked in headers only.
   */
  readonly cookies: PresentedCookies;
  readonly statistics: ResponseStatistics;
  readonly body?: ResponseBodyPresentation;
  readonly failure?: ResponseFailurePresentation;
  /**
   * Deterministic status/transport guidance (including successful transport
   * with 4xx/5xx). Speculative lines live under `possibleCauses`.
   */
  readonly explanation?: FailureExplanation;
  readonly assertions?: PresentedAssertions;
  readonly extraction?: PresentedExtraction;
  /**
   * Additive GraphQL envelope summary. Present only for `@protocol graphql`
   * successful HTTP responses. REST results omit this field.
   */
  readonly graphql?: GraphqlEnvelopeSummary;
  /**
   * Bounded WebSocket session summary. Present only for `@protocol websocket`.
   */
  readonly websocket?: WebsocketSessionSummary;
  readonly summary: string;
}

const ERROR_TITLES: Readonly<Record<ExecutionErrorCode, string>> = {
  MALFORMED_URL: 'Malformed URL',
  UNSUPPORTED_BODY: 'Unsupported request body',
  TIMEOUT: 'Request timed out',
  CANCELLED: 'Request cancelled',
  DNS: 'DNS lookup failed',
  SSL_TLS: 'SSL/TLS failure',
  CONNECTION_REFUSED: 'Connection refused',
  NETWORK: 'Network failure',
  REDIRECT: 'Redirect failure',
  RESPONSE_TOO_LARGE: 'Response too large',
  UNEXPECTED: 'Unexpected execution failure',
};

/** Converts an immutable execution result into a detached, immutable UI model. */
export function presentExecutionResult(
  result: ExecutionResult,
  assertions?: TestReport,
  extraction?: ExtractionReport,
  options?: PresentExecutionOptions,
): ResponsePresentation {
  const method = result.request?.method ?? 'Unknown method';
  const requestUrl = result.request === undefined
    ? 'Unknown URL'
    : redactUrlUserinfo(result.request.url);
  const presentedAssertions = presentAssertions(assertions);
  const presentedExtraction = presentExtraction(extraction);
  if (!result.success) {
    const explanation = buildFailureExplanation({
      url: requestUrl === 'Unknown URL' ? undefined : requestUrl,
      elapsedMs: result.timing.durationMs,
      ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      transportCode: result.error.code,
      transportMessage: result.error.message,
      ...(options?.environmentLabel === undefined
        ? {}
        : { environmentLabel: options.environmentLabel }),
      requestId: result.requestId,
    });
    return deepFreeze({
      success: false,
      requestId: result.requestId,
      method,
      requestUrl,
      headers: [],
      cookies: { available: false, setCookieHeaderCount: 0 },
      statistics: {
        durationMs: result.timing.durationMs,
        startedAt: result.timing.startedAt,
        completedAt: result.timing.completedAt,
        headerCount: 0,
        redirected: false,
        redirectCount: 0,
      },
      failure: {
        code: result.error.code,
        title: ERROR_TITLES[result.error.code],
        message: result.error.message,
        retryable: result.error.retryable,
        ...(result.error.cause === undefined
          ? {}
          : { cause: { ...result.error.cause } }),
      },
      ...(explanation === undefined ? {} : { explanation }),
      ...(presentedAssertions === undefined
        ? {}
        : { assertions: presentedAssertions }),
      ...(presentedExtraction === undefined
        ? {}
        : { extraction: presentedExtraction }),
      summary: `${ERROR_TITLES[result.error.code]} after ${formatDuration(result.timing.durationMs)}`,
    });
  }

  const response = result.response;
  const headers = response.headers.map((header) => {
    const masked = isSensitiveHttpHeaderName(header.name);
    return {
      name: header.name,
      value: masked ? MASKED_HEADER_VALUE : header.value,
      masked,
    };
  });
  const setCookieHeaderCount = response.headers.filter(
    (header) => header.name.toLowerCase() === 'set-cookie',
  ).length;
  const body = presentBody(response);
  const encoding = contentEncoding(response.contentType, body.language);
  const assertionSuffix =
    presentedAssertions === undefined
      ? ''
      : ` · Assertions ${presentedAssertions.summary.passed}/${presentedAssertions.summary.total}`;
  const extractionSuffix =
    presentedExtraction === undefined
      ? ''
      : ` · ${presentedExtraction.chipLabel}`;
  const explanation = buildFailureExplanation({
    statusCode: response.statusCode,
    statusText: response.statusText,
    url: requestUrl === 'Unknown URL' ? undefined : requestUrl,
    elapsedMs: result.timing.durationMs,
    ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options?.environmentLabel === undefined
      ? {}
      : { environmentLabel: options.environmentLabel }),
    requestId: result.requestId,
    ...(response.contentType === undefined
      ? {}
      : { contentType: response.contentType }),
    bodySizeBytes: response.bodySizeBytes,
    ...(result.graphql === undefined
      ? {}
      : {
          graphqlErrorMessages: result.graphql.errorMessages,
          graphqlValidEnvelope: result.graphql.validEnvelope,
        }),
  });
  return deepFreeze({
    success: true,
    requestId: result.requestId,
    method,
    requestUrl,
    headers,
    cookies: { available: false, setCookieHeaderCount },
    statistics: {
      durationMs: result.timing.durationMs,
      startedAt: result.timing.startedAt,
      completedAt: result.timing.completedAt,
      bodySizeBytes: response.bodySizeBytes,
      responseSizeBytes: estimatedResponseSize(response),
      headerCount: response.headers.length,
      ...(response.contentType === undefined
        ? {}
        : { contentType: response.contentType }),
      ...(encoding === undefined ? {} : { encoding }),
      redirected: response.redirected,
      redirectCount: response.redirectCount,
      finalUrl: redactUrlUserinfo(response.url),
    },
    body,
    ...(explanation === undefined ? {} : { explanation }),
    ...(presentedAssertions === undefined
      ? {}
      : { assertions: presentedAssertions }),
    ...(presentedExtraction === undefined
      ? {}
      : { extraction: presentedExtraction }),
    ...(result.graphql === undefined ? {} : { graphql: result.graphql }),
    ...(result.websocket === undefined ? {} : { websocket: result.websocket }),
    ...(result.websocket === undefined
      ? { status: { code: response.statusCode, text: response.statusText } }
      : {}),
    summary:
      result.websocket === undefined
        ? `${response.statusCode} ${response.statusText} · ${formatDuration(result.timing.durationMs)} · ${formatBytes(response.bodySizeBytes)}${assertionSuffix}${extractionSuffix}`
        : `WebSocket received · ${formatDuration(result.timing.durationMs)} · ${formatBytes(response.bodySizeBytes)}${assertionSuffix}${extractionSuffix}`,
  });
}

function presentAssertions(
  report: TestReport | undefined,
): PresentedAssertions | undefined {
  if (report === undefined || report.summary.total === 0) {
    return undefined;
  }
  return {
    summary: {
      total: report.summary.total,
      passed: report.summary.passed,
      failed: report.summary.failed,
      skipped: report.summary.skipped,
      malformed: report.summary.malformed,
      passPercent: report.summary.passPercent,
      durationMs: report.summary.durationMs,
    },
    assertions: report.results.map((result) => {
      const rawText =
        result.assertion?.text ?? result.failure?.assertionText ?? 'expect';
      // Always mask display text — passed/skipped lines can embed Bearer tokens.
      const text = maskAssertionText(rawText);
      return {
        text,
        outcome: result.outcome,
        ...(result.failure === undefined
          ? {}
          : {
              failure: {
                assertionText: maskAssertionText(result.failure.assertionText),
                ...(result.failure.expected === undefined
                  ? {}
                  : { expected: result.failure.expected }),
                ...(result.failure.actual === undefined
                  ? {}
                  : { actual: result.failure.actual }),
                reason: maskAssertionText(result.failure.reason),
                ...(result.failure.context === undefined
                  ? {}
                  : { context: result.failure.context }),
              },
            }),
      };
    }),
  };
}

function presentExtraction(
  report: ExtractionReport | undefined,
): PresentedExtraction | undefined {
  if (report === undefined) {
    return undefined;
  }
  const total =
    report.extractedCount +
    report.failedCount +
    report.skippedCount +
    report.malformedCount;
  if (total === 0 && report.outcomes.length === 0) {
    return undefined;
  }
  const summary: PresentedExtractionSummary = {
    total: report.outcomes.length > 0 ? report.outcomes.length : total,
    extracted: report.extractedCount,
    failed: report.failedCount,
    skipped: report.skippedCount,
    malformed: report.malformedCount,
  };
  const failed = summary.failed + summary.malformed;
  const chipLabel =
    failed > 0
      ? `Extract ${failed} failed`
      : `Extracted ${summary.extracted}`;
  return {
    summary,
    chipLabel,
    outcomes: report.outcomes.map((outcome) => {
      const sensitive = outcome.rule.sensitive === true;
      const maskedValue =
        outcome.maskedValue !== undefined
          ? sensitive
            ? MASKED_VARIABLE_VALUE
            : outcome.maskedValue
          : undefined;
      return {
        variableName: outcome.rule.variableName,
        sourceLabel: formatExtractionSourceLabel(outcome.rule),
        outcome: outcome.kind,
        ...(maskedValue === undefined ? {} : { maskedValue }),
        ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
      };
    }),
  };
}

function formatExtractionSourceLabel(
  rule: ExtractionReport['outcomes'][number]['rule'],
): string {
  const source = rule.source;
  switch (source.kind) {
    case 'json-path':
      return source.path;
    case 'header':
      return `header ${source.name}`;
    case 'status':
      return 'status';
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

function presentBody(response: RuntimeResponse): ResponseBodyPresentation {
  const language = detectLanguage(response);
  if (response.body.text === undefined) {
    const bytes = response.body.bytes;
    const displayedLength = Math.min(bytes.byteLength, RESPONSE_BINARY_PREVIEW_LIMIT);
    const parts: string[] = [];
    for (let index = 0; index < displayedLength; index += 1) {
      const value = bytes.at(index);
      if (value === undefined) {
        break;
      }
      parts.push(
        `${index > 0 && index % 16 === 0 ? '\n' : ''}${value.toString(16).padStart(2, '0')}`,
      );
    }
    const raw = parts.join(' ');
    return {
      language: 'binary',
      raw,
      pretty: raw,
      prettyAvailable: false,
      truncated: displayedLength < bytes.byteLength,
      displayedUnits: displayedLength,
      totalUnits: bytes.byteLength,
      unit: 'bytes',
    };
  }

  const source = response.body.text;
  const truncated = source.length > RESPONSE_TEXT_PREVIEW_LIMIT;
  const raw = source.slice(0, RESPONSE_TEXT_PREVIEW_LIMIT);
  if (language === 'json' && !truncated) {
    try {
      const parsed = response.body.json ?? JSON.parse(source) as unknown;
      const pretty = JSON.stringify(parsed, undefined, 2);
      if (pretty.length > RESPONSE_TEXT_PREVIEW_LIMIT) {
        return {
          language,
          raw,
          pretty: pretty.slice(0, RESPONSE_TEXT_PREVIEW_LIMIT),
          prettyAvailable: false,
          truncated: true,
          displayedUnits: RESPONSE_TEXT_PREVIEW_LIMIT,
          totalUnits: pretty.length,
          unit: 'characters',
        };
      }
      return {
        language,
        raw,
        pretty,
        prettyAvailable: pretty !== raw,
        truncated: false,
        displayedUnits: raw.length,
        totalUnits: source.length,
        unit: 'characters',
      };
    } catch {
      // Malformed JSON remains safely available as source text.
    }
  }
  return {
    language,
    raw,
    pretty: raw,
    prettyAvailable: false,
    truncated,
    displayedUnits: raw.length,
    totalUnits: source.length,
    unit: 'characters',
  };
}

function detectLanguage(response: RuntimeResponse): ResponseBodyLanguage {
  const type = response.contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (type === 'application/json' || type?.endsWith('+json') === true) {
    return 'json';
  }
  if (type === 'text/html') {
    return 'html';
  }
  if (
    type === 'application/xml' ||
    type === 'text/xml' ||
    type?.endsWith('+xml') === true
  ) {
    return 'xml';
  }
  if (type?.startsWith('text/') === true || response.body.text !== undefined) {
    const trimmed = response.body.text?.trimStart() ?? '';
    if (/^<!doctype\s+html|^<html[\s>]/iu.test(trimmed)) {
      return 'html';
    }
    if (/^<\?xml[\s>]|^<[A-Za-z_][^>]*>/u.test(trimmed)) {
      return 'xml';
    }
    if (/^[{[]/u.test(trimmed)) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {
        return 'text';
      }
    }
    return 'text';
  }
  return 'binary';
}

function contentEncoding(
  contentType: string | undefined,
  language: ResponseBodyLanguage,
): string | undefined {
  const match = /(?:^|;)\s*charset\s*=\s*"?([^";\s]+)"?/iu.exec(contentType ?? '');
  if (match?.[1] !== undefined) {
    return match[1];
  }
  // Only renderable text-like bodies imply a UTF-8 default; binary/unknown
  // content without an explicit charset has no meaningful text encoding.
  return language === 'binary' ? undefined : 'UTF-8';
}

function estimatedResponseSize(response: RuntimeResponse): number {
  const encoder = new TextEncoder();
  const statusLine = encoder.encode(
    `HTTP/1.1 ${response.statusCode} ${response.statusText}\r\n`,
  ).byteLength;
  const headers = response.headers.reduce(
    (total, header) =>
      total + encoder.encode(`${header.name}: ${header.value}\r\n`).byteLength,
    2,
  );
  return statusLine + headers + response.bodySizeBytes;
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000
    ? `${durationMs} ms`
    : `${(durationMs / 1_000).toFixed(2)} s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes} B`;
  }
  if (bytes < 1_024 * 1_024) {
    return `${(bytes / 1_024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`;
}
