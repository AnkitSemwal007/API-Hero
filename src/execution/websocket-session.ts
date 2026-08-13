import type {
  AuthenticatedRequest,
  RuntimeBody,
  RuntimeJsonValue,
} from '../models/request';
import { freezeDetachedBytes, deepFreeze, redactUrlUserinfo } from '../shared';
import type {
  ExecutionError,
  ExecutionTiming,
  RuntimeResponse,
  WebsocketSessionSummary,
} from './contracts';

const TEXT_ENCODER = new TextEncoder();

export type WebsocketPrepareResult =
  | {
      readonly ok: true;
      readonly url: string;
      readonly message?: string;
    }
  | {
      readonly ok: false;
      readonly error: ExecutionError;
    };

/**
 * Validates a WebSocket URL and projects the existing request body to one
 * UTF-8 text frame. Does not open a socket.
 */
export function prepareWebsocketSession(
  request: AuthenticatedRequest,
): WebsocketPrepareResult {
  let parsed: URL;
  try {
    parsed = new URL(request.url);
  } catch {
    return {
      ok: false,
      error: malformedWebsocketUrl(request.resolution.presentationUrl),
    };
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return {
      ok: false,
      error: malformedWebsocketUrl(request.resolution.presentationUrl),
    };
  }

  const message = readTextMessage(request.body);
  if (message !== undefined && typeof message !== 'string') {
    return { ok: false, error: message };
  }

  return {
    ok: true,
    url: request.url,
    ...(message === undefined || message.length === 0 ? {} : { message }),
  };
}

export function websocketResponseFromMessage(
  request: AuthenticatedRequest,
  message: string,
  responseTiming: ExecutionTiming,
): RuntimeResponse {
  const bytes = freezeDetachedBytes(TEXT_ENCODER.encode(message));
  const json = tryParseJson(message);
  const contentType =
    json === undefined ? 'text/plain; charset=utf-8' : 'application/json';
  return deepFreeze({
    requestId: request.id,
    // Internal adapter sentinel so assertions/extraction can reuse
    // RuntimeResponse. HTTP-facing reports must omit this via `websocket`.
    statusCode: 0,
    statusText: 'received',
    headers: [{ name: 'Content-Type', value: contentType }],
    body: {
      bytes,
      text: message,
      ...(json === undefined ? {} : { json }),
    },
    bodySizeBytes: bytes.byteLength,
    contentType,
    url: request.url,
    redirected: false,
    redirectCount: 0,
    timing: responseTiming,
  });
}

export function websocketSessionSummary(input: {
  readonly sent: boolean;
  readonly closeCode?: number;
  readonly closeReason?: string;
}): WebsocketSessionSummary {
  return deepFreeze({
    connected: true,
    sent: input.sent,
    received: true,
    closed: true,
    ...(input.closeCode === undefined ? {} : { closeCode: input.closeCode }),
    ...(input.closeReason === undefined || input.closeReason.length === 0
      ? {}
      : { closeReason: input.closeReason }),
  });
}

function readTextMessage(
  body: RuntimeBody | undefined,
): string | ExecutionError | undefined {
  if (body === undefined) {
    return undefined;
  }
  if (body.type === 'binary') {
    return unsupportedWebsocketBody(
      'WebSocket Phase 1 supports text messages only.',
    );
  }
  if (body.type === 'multipart') {
    if (body.parts.length > 0 || body.content.length > 0) {
      return unsupportedWebsocketBody(
        'WebSocket Phase 1 supports text messages only.',
      );
    }
    return undefined;
  }
  return body.content;
}

function tryParseJson(text: string): RuntimeJsonValue | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return undefined;
  }
  try {
    return JSON.parse(text) as RuntimeJsonValue;
  } catch {
    return undefined;
  }
}

function malformedWebsocketUrl(url: string): ExecutionError {
  return deepFreeze({
    code: 'MALFORMED_URL',
    message: `The request URL is not a valid WebSocket URL: ${redactUrlUserinfo(url)}`,
    retryable: false,
  });
}

function unsupportedWebsocketBody(message: string): ExecutionError {
  return deepFreeze({
    code: 'UNSUPPORTED_BODY',
    message,
    retryable: false,
  });
}
