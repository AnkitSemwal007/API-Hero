import { scrubSecretTokensInText } from './secret-scrub';

export interface RequestHoverInput {
  readonly method: string;
  readonly url: string;
  readonly name: string;
  readonly protocol?: string;
  readonly sourceRef?: string;
}

export interface RequestHoverContent {
  readonly title: string;
  readonly body: string;
}

const PROTOCOL_LABELS: Readonly<Record<string, string>> = {
  http: 'HTTP',
  graphql: 'GraphQL',
  websocket: 'WebSocket',
};

/**
 * Protocol-agnostic hover text. Never includes headers, tokens, or query values.
 */
export function formatRequestHover(request: RequestHoverInput): RequestHoverContent {
  const protocol = formatProtocol(request.protocol);
  const url = sanitizeHoverLabel(request.url);
  const lines = [
    'API Hero',
    `Name: ${sanitizeHoverLabel(request.name)}`,
    `Protocol: ${protocol}`,
  ];
  if (request.sourceRef !== undefined && request.sourceRef.length > 0) {
    lines.push(`Source: ${request.sourceRef}`);
  }
  return {
    title: `${request.method} ${url}`.trim(),
    body: lines.join('\n'),
  };
}

export function formatProtocol(protocol: string | undefined): string {
  const key = (protocol ?? 'http').trim().toLowerCase();
  if (key.length === 0) {
    return 'HTTP';
  }
  return PROTOCOL_LABELS[key] ?? protocol!.trim();
}

/** Strips query strings, fragments, userinfo, and known secret tokens from display labels. */
export function sanitizeHoverLabel(value: string): string {
  const withoutQueryOrFragment = value.replace(/[?#][^\s]*/gu, '');
  const withoutUserinfo = withoutQueryOrFragment.replace(/\/\/([^/@\s]+)@/gu, '//***@');
  return scrubSecretTokensInText(withoutUserinfo);
}
