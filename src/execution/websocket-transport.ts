import WsClient from 'ws';

import type { RuntimeHeader, RuntimeSslOptions } from '../models/request';

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;

export type WebSocketTransportErrorKind =
  | 'dns'
  | 'ssl-tls'
  | 'connection-refused'
  | 'network'
  | 'connect'
  | 'send'
  | 'receive'
  | 'response-too-large'
  | 'unsupported-frame';

export class WebSocketTransportError extends Error {
  public constructor(
    public readonly kind: WebSocketTransportErrorKind,
    message: string,
    public readonly causeCode?: string,
  ) {
    super(message);
    this.name = 'WebSocketTransportError';
  }
}

export interface WebSocketTransportRequest {
  readonly url: string;
  readonly headers: readonly RuntimeHeader[];
  /** UTF-8 text to send after connect. Omitted to skip send. */
  readonly message?: string;
  readonly ssl: RuntimeSslOptions;
}

export interface WebSocketTransportContext {
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export interface WebSocketTransportResult {
  readonly message: string;
  readonly sent: boolean;
  readonly closeCode?: number;
  readonly closeReason?: string;
}

/**
 * Bounded WebSocket session: connect, optional send, receive one text frame,
 * close. Implementations must close the socket on every path.
 */
export interface WebSocketTransport {
  execute(
    request: WebSocketTransportRequest,
    context: WebSocketTransportContext,
  ): Promise<WebSocketTransportResult>;
}

const CLOSE_WAIT_MS = 250;

/** Node `ws` client for a single bounded request/response session. */
export class NodeWebSocketTransport implements WebSocketTransport {
  public execute(
    request: WebSocketTransportRequest,
    context: WebSocketTransportContext,
  ): Promise<WebSocketTransportResult> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let opened = false;
      let sent = false;
      let received: string | undefined;
      let closeCode: number | undefined;
      let closeReason: string | undefined;
      let closeWait: ReturnType<typeof setTimeout> | undefined;

      const handshakeHeaders = headersObject(request.headers);
      const options: {
        readonly headers?: Record<string, string>;
        readonly rejectUnauthorized?: boolean;
        readonly handshakeTimeout?: number;
      } = {
        ...(Object.keys(handshakeHeaders).length > 0
          ? { headers: handshakeHeaders }
          : {}),
        ...(request.url.startsWith('wss:')
          ? { rejectUnauthorized: request.ssl.verifyCertificates }
          : {}),
        ...(context.timeoutMs !== undefined && context.timeoutMs > 0
          ? { handshakeTimeout: context.timeoutMs }
          : {}),
      };
      let socket: WsClient;
      try {
        socket = new WsClient(request.url, undefined, options);
      } catch (error) {
        reject(classifyWebsocketError(error, false));
        return;
      }

      const finish = (error?: WebSocketTransportError): void => {
        if (settled) {
          return;
        }
        settled = true;
        context.signal.removeEventListener('abort', onAbort);
        if (closeWait !== undefined) {
          clearTimeout(closeWait);
        }
        socket.removeAllListeners();
        socket.on('error', () => undefined);
        closeQuietly(socket);
        if (error !== undefined) {
          reject(error);
          return;
        }
        if (received === undefined) {
          reject(
            new WebSocketTransportError(
              'receive',
              'The WebSocket closed before a text message was received.',
            ),
          );
          return;
        }
        resolve({
          message: received,
          sent,
          ...(closeCode === undefined ? {} : { closeCode }),
          ...(closeReason === undefined || closeReason.length === 0
            ? {}
            : { closeReason }),
        });
      };

      const onAbort = (): void => {
        finish(
          new WebSocketTransportError(
            'network',
            'The WebSocket session was aborted.',
            'ABORTED',
          ),
        );
      };

      if (context.signal.aborted) {
        onAbort();
        return;
      }
      context.signal.addEventListener('abort', onAbort, { once: true });

      socket.once('open', () => {
        opened = true;
        if (request.message === undefined) {
          return;
        }
        try {
          // `ws` / Node error-first: `null` and `undefined` mean the frame was queued.
          socket.send(request.message, (sendError) => {
            try {
              if (sendError == null || received !== undefined) {
                return;
              }
              finish(
                new WebSocketTransportError(
                  'send',
                  websocketSendFailureMessage(sendError),
                  nodeErrorCode(sendError),
                ),
              );
            } catch (error) {
              finish(
                new WebSocketTransportError(
                  'send',
                  'The WebSocket message could not be sent.',
                  nodeErrorCode(error),
                ),
              );
            }
          });
          sent = true;
        } catch (error) {
          finish(
            new WebSocketTransportError(
              'send',
              'The WebSocket message could not be sent.',
              nodeErrorCode(error),
            ),
          );
        }
      });

      socket.on('message', (data, isBinary) => {
        if (settled || received !== undefined) {
          return;
        }
        try {
          if (isBinary) {
            finish(
              new WebSocketTransportError(
                'unsupported-frame',
                'WebSocket Phase 1 supports text frames only.',
              ),
            );
            return;
          }
          const text = bufferToText(data);
          if (
            context.maxResponseBytes !== undefined &&
            context.maxResponseBytes > 0 &&
            Buffer.byteLength(text, 'utf8') > context.maxResponseBytes
          ) {
            finish(
              new WebSocketTransportError(
                'response-too-large',
                'The WebSocket message exceeded the configured maximum size.',
              ),
            );
            return;
          }
          received = text;
          closeWait = setTimeout(() => {
            finish();
          }, CLOSE_WAIT_MS);
          closeQuietly(socket);
        } catch (error) {
          finish(
            new WebSocketTransportError(
              'network',
              error instanceof Error && error.message.trim().length > 0
                ? error.message
                : 'The WebSocket session failed.',
              nodeErrorCode(error),
            ),
          );
        }
      });

      socket.once('error', (error) => {
        finish(classifyWebsocketError(error, opened));
      });

      socket.once('close', (code, reason) => {
        closeCode = code;
        closeReason = reason.toString();
        if (received !== undefined) {
          finish();
          return;
        }
        if (!opened) {
          finish(
            new WebSocketTransportError(
              'connect',
              'The WebSocket connection could not be established.',
            ),
          );
          return;
        }
        finish(
          new WebSocketTransportError(
            'receive',
            'The WebSocket closed before a text message was received.',
          ),
        );
      });
    });
  }
}

function headersObject(
  headers: readonly RuntimeHeader[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of headers) {
    out[header.name] = header.value;
  }
  return out;
}

function bufferToText(
  data: string | Buffer | ArrayBuffer | ArrayBufferView | Buffer[],
): string {
  if (typeof data === 'string') {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      'utf8',
    );
  }
  return Buffer.from(new Uint8Array(data)).toString('utf8');
}

function websocketSendFailureMessage(sendError: unknown): string {
  if (sendError instanceof Error && sendError.message.trim().length > 0) {
    return `The WebSocket message could not be sent. ${sendError.message}`;
  }
  return 'The WebSocket message could not be sent.';
}

function closeQuietly(socket: WsClient): void {
  try {
    if (socket.readyState === WS_CONNECTING) {
      socket.terminate();
      return;
    }
    if (
      socket.readyState === WS_OPEN ||
      socket.readyState === WS_CLOSING
    ) {
      socket.close();
    }
  } catch {
    try {
      socket.terminate();
    } catch {
      // Socket is already gone.
    }
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function classifyWebsocketError(
  error: unknown,
  opened: boolean,
): WebSocketTransportError {
  const code = nodeErrorCode(error);
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'The WebSocket session failed.';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new WebSocketTransportError(
      'dns',
      'The WebSocket host could not be resolved.',
      code,
    );
  }
  if (code === 'ECONNREFUSED') {
    return new WebSocketTransportError(
      'connection-refused',
      'The WebSocket connection could not be established.',
      code,
    );
  }
  if (
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    /certificate|ssl|tls/iu.test(message)
  ) {
    return new WebSocketTransportError('ssl-tls', message, code);
  }
  if (!opened) {
    return new WebSocketTransportError('connect', message, code);
  }
  return new WebSocketTransportError('network', message, code);
}
