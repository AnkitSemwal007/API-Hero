import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';

import type { RuntimeHeader } from '../models/request';
import {
  HttpTransportError,
  HttpTransportInvariantError,
  type HttpTransport,
  type HttpTransportContext,
  type HttpTransportRequest,
  type HttpTransportResponse,
} from './contracts';

const DEFAULT_MAX_REDIRECTS = 20;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
]);
const ENTITY_HEADERS: ReadonlySet<string> = new Set([
  'content-length',
  'content-type',
  'transfer-encoding',
]);

/** Node.js HTTP/HTTPS adapter. It performs no runtime-domain resolution. */
export class NodeHttpTransport implements HttpTransport {
  public execute(
    request: HttpTransportRequest,
    context: HttpTransportContext,
  ): Promise<HttpTransportResponse> {
    const maxRedirects =
      request.redirectPolicy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
      throw new HttpTransportInvariantError(
        'Redirect maxRedirects must be a non-negative safe integer.',
      );
    }
    return this.send(request, context, 0, maxRedirects);
  }

  private send(
    request: HttpTransportRequest,
    context: HttpTransportContext,
    redirectCount: number,
    maxRedirects: number,
  ): Promise<HttpTransportResponse> {
    return new Promise((resolve, reject) => {
      const url = new URL(request.url);
      const client = url.protocol === 'https:' ? https : http;
      const outgoingHeaders = request.headers.flatMap((header) => [
        header.name,
        header.value,
      ]);
      if (!request.headers.some((header) => header.name.toLowerCase() === 'host')) {
        outgoingHeaders.push('Host', url.host);
      }
      const nodeRequest = client.request(
        url,
        {
          method: request.method,
          headers: outgoingHeaders,
          signal: context.signal,
          ...(url.protocol === 'https:'
            ? { rejectUnauthorized: request.ssl.verifyCertificates }
            : {}),
        },
        (response) => {
          void this.handleResponse(
            request,
            context,
            response,
            redirectCount,
            maxRedirects,
          ).then(resolve, reject);
        },
      );
      nodeRequest.on('error', (error) => reject(classifyNodeError(error)));
      if (request.body !== undefined && request.body.byteLength > 0) {
        nodeRequest.write(Buffer.from(request.body));
      }
      nodeRequest.end();
    });
  }

  private async handleResponse(
    request: HttpTransportRequest,
    context: HttpTransportContext,
    response: IncomingMessage,
    redirectCount: number,
    maxRedirects: number,
  ): Promise<HttpTransportResponse> {
    const statusCode = response.statusCode;
    if (statusCode === undefined) {
      response.resume();
      throw new HttpTransportInvariantError(
        'Node HTTP transport received a response without a status code.',
      );
    }

    const location = response.headers.location;
    if (REDIRECT_STATUSES.has(statusCode) && location !== undefined) {
      if (request.redirectPolicy.mode === 'error') {
        response.resume();
        throw new HttpTransportError(
          'redirect',
          `Redirect response ${statusCode} was rejected by policy.`,
        );
      }
      if (request.redirectPolicy.mode === 'follow') {
        if (redirectCount >= maxRedirects) {
          response.resume();
          throw new HttpTransportError(
            'redirect',
            `The request exceeded the maximum of ${maxRedirects} redirects.`,
          );
        }
        let redirectUrl: URL;
        try {
          redirectUrl = new URL(location, request.url);
        } catch (error) {
          response.resume();
          throw new HttpTransportError(
            'redirect',
            `The server returned an invalid redirect URL: ${String(error)}`,
          );
        }
        if (redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:') {
          response.resume();
          throw new HttpTransportError(
            'redirect',
            `The server redirected to unsupported protocol ${redirectUrl.protocol}.`,
          );
        }
        response.resume();
        const redirectedRequest = redirectRequest(
          request,
          statusCode,
          redirectUrl.href,
        );
        return this.send(
          redirectedRequest,
          context,
          redirectCount + 1,
          maxRedirects,
        );
      }
    }

    const body = await readBody(response, context.maxResponseBytes);
    return {
      statusCode,
      statusText: response.statusMessage ?? '',
      headers: rawHeaders(response),
      body,
      finalUrl: request.url,
      redirected: redirectCount > 0,
      redirectCount,
    };
  }
}

/**
 * Origins differ when scheme, hostname, or effective port change (`URL.origin`).
 * Cross-origin redirects strip Authorization, Cookie, and Proxy-Authorization.
 * An explicit Host header is stripped whenever the redirect host (name:port)
 * changes so Node recomputes it for the next hop.
 */
function redirectRequest(
  request: HttpTransportRequest,
  statusCode: number,
  url: string,
): HttpTransportRequest {
  const previous = new URL(request.url);
  const next = new URL(url);
  const crossOrigin = previous.origin !== next.origin;
  const hostChanged = previous.host !== next.host;
  const becomesGet =
    statusCode === 303 ||
    ((statusCode === 301 || statusCode === 302) && request.method === 'POST');

  let headers = request.headers;
  if (becomesGet) {
    headers = headers.filter(
      (header) => !ENTITY_HEADERS.has(header.name.toLowerCase()),
    );
  }
  if (crossOrigin) {
    const sensitiveHeaders = new Set([
      ...SENSITIVE_HEADERS,
      ...(request.sensitiveHeaderNames ?? []),
    ]);
    headers = headers.filter(
      (header) => !sensitiveHeaders.has(header.name.toLowerCase()),
    );
  }
  if (hostChanged) {
    headers = headers.filter(
      (header) => header.name.toLowerCase() !== 'host',
    );
  }

  if (!becomesGet) {
    return { ...request, url, headers };
  }
  return {
    ...request,
    method: 'GET',
    url,
    headers,
    body: undefined,
  };
}

function rawHeaders(response: IncomingMessage): readonly RuntimeHeader[] {
  const headers: RuntimeHeader[] = [];
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    headers.push({
      name: response.rawHeaders[index]!,
      value: response.rawHeaders[index + 1] ?? '',
    });
  }
  return headers;
}

function readBody(
  response: IncomingMessage,
  maxResponseBytes?: number,
): Promise<Uint8Array> {
  const limit =
    maxResponseBytes !== undefined && maxResponseBytes > 0
      ? maxResponseBytes
      : undefined;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let rejected = false;
    response.on('data', (chunk: Buffer | string) => {
      if (rejected) {
        return;
      }
      const buffer = Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (limit !== undefined && totalBytes > limit) {
        rejected = true;
        chunks.length = 0;
        totalBytes = 0;
        response.destroy();
        reject(
          new HttpTransportError(
            'response-too-large',
            `The response exceeded the maximum of ${limit} bytes.`,
            'RESPONSE_TOO_LARGE',
          ),
        );
        return;
      }
      chunks.push(buffer);
    });
    response.on('end', () => {
      if (rejected) {
        return;
      }
      // Concatenate into one owned buffer and transfer it. Public sealing
      // performs the single detach copy via freezeDetachedBytes.
      const owned = Buffer.concat(chunks);
      chunks.length = 0;
      totalBytes = 0;
      resolve(owned);
    });
    response.on('aborted', () => {
      if (rejected) {
        return;
      }
      reject(new HttpTransportError('network', 'The response stream was aborted.'));
    });
    response.on('error', (error) => {
      if (rejected) {
        return;
      }
      reject(classifyNodeError(error));
    });
  });
}

function classifyNodeError(error: Error & { readonly code?: string }): Error {
  if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
    return error;
  }
  const code = error.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new HttpTransportError('dns', error.message, code);
  }
  if (code === 'ECONNREFUSED') {
    return new HttpTransportError('connection-refused', error.message, code);
  }
  if (
    code?.startsWith('CERT_') === true ||
    code?.startsWith('ERR_TLS_') === true ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  ) {
    return new HttpTransportError('ssl-tls', error.message, code);
  }
  return new HttpTransportError('network', error.message, code);
}
