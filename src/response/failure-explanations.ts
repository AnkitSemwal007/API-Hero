/**
 * Deterministic, non-AI failure explanations for HTTP status and transport
 * outcomes. Speculative text is always labeled as "Possible causes" — never
 * stated as proven fact.
 */
import { redactUrlUserinfo } from '../shared';

/** Factual inputs already known from execution / presentation. */
export interface FailureExplanationInput {
  readonly statusCode?: number;
  readonly statusText?: string;
  readonly url?: string;
  readonly elapsedMs?: number;
  readonly timeoutMs?: number;
  readonly transportCode?: string;
  readonly transportMessage?: string;
  readonly environmentLabel?: string;
  readonly requestId?: string;
  readonly contentType?: string;
  readonly bodySizeBytes?: number;
  readonly graphqlErrorMessages?: readonly string[];
  readonly graphqlValidEnvelope?: boolean;
}

/**
 * Secret-free explanation projection. `possibleCauses` are speculative and
 * must be rendered under a "Possible causes" heading by every surface.
 */
export interface FailureExplanation {
  readonly title: string;
  readonly facts: readonly string[];
  readonly possibleCauses: readonly string[];
}

const STATUS_GUIDANCE: Readonly<
  Record<number, { readonly title: string; readonly causes: readonly string[] }>
> = Object.freeze({
  401: {
    title: '401 Unauthorized',
    causes: Object.freeze([
      'Authorization header missing',
      'Token unresolved',
      'Token invalid or expired',
    ]),
  },
  403: {
    title: '403 Forbidden',
    causes: Object.freeze([
      'Insufficient permissions',
      'Authorization policy rejected request',
    ]),
  },
  404: {
    title: '404 Not Found',
    causes: Object.freeze([
      'Incorrect URL/path',
      'Wrong environment',
      'Resource does not exist',
    ]),
  },
  422: {
    title: '422 Unprocessable Entity',
    causes: Object.freeze([
      'Request validation failed',
      'Missing required field',
      'Invalid request body',
    ]),
  },
  429: {
    title: '429 Too Many Requests',
    causes: Object.freeze(['Rate limit exceeded']),
  },
});

const SERVER_ERROR_CAUSES: readonly string[] = Object.freeze([
  'Upstream service error',
  'Temporary server outage',
  'Unhandled exception on the server',
]);

const TRANSPORT_CAUSES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    TIMEOUT: Object.freeze([
      'Server slow to respond',
      'Client timeout too low',
      'Network congestion',
    ]),
    DNS: Object.freeze([
      'Hostname incorrect',
      'DNS lookup unavailable',
    ]),
    SSL_TLS: Object.freeze([
      'Certificate validation failed',
      'TLS protocol mismatch',
    ]),
    CONNECTION_REFUSED: Object.freeze([
      'Server not listening',
      'Wrong host or port',
    ]),
    NETWORK: Object.freeze([
      'Connectivity interrupted',
      'Firewall or proxy blocked the request',
    ]),
    REDIRECT: Object.freeze([
      'Redirect limit exceeded',
      'Redirect target rejected by policy',
    ]),
    RESPONSE_TOO_LARGE: Object.freeze([
      'Response exceeded the configured size limit',
    ]),
    MALFORMED_URL: Object.freeze(['Request URL is invalid']),
    UNSUPPORTED_BODY: Object.freeze([
      'Request body type is not supported',
    ]),
    CANCELLED: Object.freeze(['Request was cancelled before completion']),
    UNEXPECTED: Object.freeze(['Unexpected transport failure']),
  });

/**
 * Builds a deterministic explanation from known execution facts.
 * Returns `undefined` when there is nothing actionable to explain
 * (e.g. successful 2xx/3xx with no transport error).
 */
export function buildFailureExplanation(
  input: FailureExplanationInput,
): FailureExplanation | undefined {
  const graphqlFacts = graphqlErrorFacts(input);
  let explanation: FailureExplanation | undefined;
  if (
    input.statusCode !== undefined &&
    Number.isFinite(input.statusCode) &&
    input.statusCode >= 400
  ) {
    explanation = explainHttpStatus(input);
  } else if (
    input.transportCode !== undefined ||
    (input.transportMessage !== undefined &&
      input.transportMessage.trim().length > 0)
  ) {
    explanation = explainTransport(input);
  } else if (graphqlFacts.length > 0) {
    explanation = {
      title:
        input.graphqlValidEnvelope === false
          ? 'Invalid GraphQL response'
          : 'GraphQL Errors',
      facts: graphqlFacts,
      possibleCauses: [],
    };
  }
  if (explanation === undefined) {
    return undefined;
  }
  if (
    graphqlFacts.length === 0 ||
    explanation.title === 'GraphQL Errors' ||
    explanation.title === 'Invalid GraphQL response'
  ) {
    return explanation;
  }
  return {
    ...explanation,
    facts: [...explanation.facts, ...graphqlFacts],
  };
}

/** Formats explanation for plain-text surfaces (messages, MCP summaries). */
export function formatFailureExplanationText(
  explanation: FailureExplanation,
): string {
  const lines: string[] = [explanation.title];
  for (const fact of explanation.facts) {
    lines.push(fact);
  }
  if (explanation.possibleCauses.length > 0) {
    lines.push('Possible causes:');
    for (const cause of explanation.possibleCauses) {
      lines.push(`• ${cause}`);
    }
  }
  return lines.join('\n');
}

function explainHttpStatus(
  input: FailureExplanationInput,
): FailureExplanation {
  const code = input.statusCode!;
  const guided = STATUS_GUIDANCE[code];
  if (guided !== undefined) {
    return {
      title: guided.title,
      facts: httpFacts(input, { includeSafeResponse: false }),
      possibleCauses: guided.causes,
    };
  }
  if (code >= 500 && code <= 599) {
    const statusText =
      input.statusText !== undefined && input.statusText.trim().length > 0
        ? input.statusText.trim()
        : 'Server Error';
    return {
      title: `${code} ${statusText}`,
      facts: httpFacts(input, { includeSafeResponse: true }),
      possibleCauses: SERVER_ERROR_CAUSES,
    };
  }
  const statusText =
    input.statusText !== undefined && input.statusText.trim().length > 0
      ? input.statusText.trim()
      : 'Client Error';
  return {
    title: `${code} ${statusText}`,
    facts: httpFacts(input, { includeSafeResponse: false }),
    possibleCauses: Object.freeze([
      'Client request rejected by the server',
      'Check request URL, headers, and body',
    ]),
  };
}

function explainTransport(
  input: FailureExplanationInput,
): FailureExplanation {
  const code = input.transportCode;
  const websocketMessage =
    input.transportMessage !== undefined &&
    input.transportMessage.includes('WebSocket')
      ? input.transportMessage.trim()
      : undefined;
  const title =
    websocketMessage !== undefined
      ? websocketMessage
      : code === 'TIMEOUT'
      ? 'Request timed out'
      : code === 'DNS'
        ? 'DNS lookup failed'
        : code === 'SSL_TLS'
          ? 'SSL/TLS failure'
          : code === 'CONNECTION_REFUSED'
            ? 'Connection refused'
            : code === 'NETWORK'
              ? 'Network failure'
              : code === 'REDIRECT'
                ? 'Redirect failure'
                : code === 'RESPONSE_TOO_LARGE'
                  ? 'Response too large'
                  : code === 'CANCELLED'
                    ? 'Request cancelled'
                    : code === 'MALFORMED_URL'
                      ? 'Malformed URL'
                      : code === 'UNSUPPORTED_BODY'
                        ? 'Unsupported request body'
                        : 'Transport failure';
  const facts: string[] = [];
  const safeUrl = safeUrlFact(input.url);
  if (safeUrl !== undefined) {
    facts.push(`URL: ${safeUrl}`);
  }
  if (input.elapsedMs !== undefined && Number.isFinite(input.elapsedMs)) {
    facts.push(`Elapsed time: ${formatDurationMs(input.elapsedMs)}`);
  }
  if (input.timeoutMs !== undefined && Number.isFinite(input.timeoutMs)) {
    facts.push(`Timeout: ${formatDurationMs(input.timeoutMs)}`);
  } else if (code === 'TIMEOUT') {
    facts.push('Timeout: exceeded');
  }
  if (
    input.transportMessage !== undefined &&
    input.transportMessage.trim().length > 0
  ) {
    facts.push(`Transport error: ${input.transportMessage.trim()}`);
  } else if (code !== undefined && code.trim().length > 0) {
    facts.push(`Transport error: ${code}`);
  }
  const causes =
    code !== undefined && TRANSPORT_CAUSES[code] !== undefined
      ? TRANSPORT_CAUSES[code]!
      : Object.freeze([
          'Network path unavailable',
          'Remote server did not complete the response',
        ]);
  return {
    title,
    facts,
    possibleCauses: causes,
  };
}

function httpFacts(
  input: FailureExplanationInput,
  options: { readonly includeSafeResponse: boolean },
): string[] {
  const facts: string[] = [];
  const safeUrl = safeUrlFact(input.url);
  if (safeUrl !== undefined) {
    facts.push(`Endpoint: ${safeUrl}`);
  }
  if (
    input.environmentLabel !== undefined &&
    input.environmentLabel.trim().length > 0
  ) {
    facts.push(`Environment: ${input.environmentLabel.trim()}`);
  }
  if (input.elapsedMs !== undefined && Number.isFinite(input.elapsedMs)) {
    facts.push(`Duration: ${formatDurationMs(input.elapsedMs)}`);
  }
  if (
    input.requestId !== undefined &&
    input.requestId.trim().length > 0
  ) {
    facts.push(`Request ID: ${input.requestId.trim()}`);
  }
  if (options.includeSafeResponse) {
    if (
      input.contentType !== undefined &&
      input.contentType.trim().length > 0
    ) {
      facts.push(`Content-Type: ${input.contentType.trim()}`);
    }
    if (
      input.bodySizeBytes !== undefined &&
      Number.isFinite(input.bodySizeBytes)
    ) {
      facts.push(`Response size: ${input.bodySizeBytes} bytes`);
    }
  }
  return facts;
}

function safeUrlFact(url: string | undefined): string | undefined {
  if (url === undefined || url.trim().length === 0) {
    return undefined;
  }
  return redactUrlUserinfo(url.trim());
}

function formatDurationMs(ms: number): string {
  if (ms < 1_000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1_000).toFixed(2)} s`;
}

function graphqlErrorFacts(input: FailureExplanationInput): string[] {
  const facts: string[] = [];
  if (input.graphqlValidEnvelope === false) {
    facts.push('The GraphQL response is not a valid envelope.');
  }
  for (const message of input.graphqlErrorMessages ?? []) {
    const trimmed = message.trim();
    if (trimmed.length > 0) {
      facts.push(`GraphQL error: ${trimmed}`);
    }
  }
  return facts;
}
