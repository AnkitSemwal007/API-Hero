import type {
  ExecutionErrorCode,
  ExecutionResult,
  RuntimeResponse,
} from '../execution';
import type { TestReport } from '../assertions';
import { maskAssertionText } from '../assertions';
import { deepFreeze, redactUrlUserinfo } from '../shared';

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
  readonly assertions?: PresentedAssertions;
  readonly summary: string;
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
]);

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
): ResponsePresentation {
  const method = result.request?.method ?? 'Unknown method';
  const requestUrl = result.request === undefined
    ? 'Unknown URL'
    : redactUrlUserinfo(result.request.url);
  const presentedAssertions = presentAssertions(assertions);
  if (!result.success) {
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
      ...(presentedAssertions === undefined
        ? {}
        : { assertions: presentedAssertions }),
      summary: `${ERROR_TITLES[result.error.code]} after ${formatDuration(result.timing.durationMs)}`,
    });
  }

  const response = result.response;
  const headers = response.headers.map((header) => {
    const masked = SENSITIVE_HEADERS.has(header.name.toLowerCase());
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
  return deepFreeze({
    success: true,
    requestId: result.requestId,
    method,
    requestUrl,
    status: { code: response.statusCode, text: response.statusText },
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
    ...(presentedAssertions === undefined
      ? {}
      : { assertions: presentedAssertions }),
    summary: `${response.statusCode} ${response.statusText} · ${formatDuration(result.timing.durationMs)} · ${formatBytes(response.bodySizeBytes)}${assertionSuffix}`,
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
