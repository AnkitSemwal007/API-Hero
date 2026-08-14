/**
 * Stock protocol URLs shared by New Request, Request Editor, and serialize
 * placeholders. Custom URLs must never be rewritten to these values.
 */

/** Default URL for new REST / HTTP requests and placeholders. */
export const DEFAULT_HTTP_REQUEST_URL = 'https://httpbin.org/get';

/** Default URL for new GraphQL requests. */
export const DEFAULT_GRAPHQL_REQUEST_URL = 'https://api.example.com/graphql';

/** Default URL for new WebSocket requests and the Request Editor placeholder. */
export const DEFAULT_WEBSOCKET_REQUEST_URL = 'ws://localhost:8080/socket';

/**
 * True when the URL is empty or still a stock protocol default and is therefore
 * safe to replace when the user switches protocol.
 */
export function isStockProtocolDefaultUrl(url: string): boolean {
  const trimmed = url.trim();
  return (
    trimmed.length === 0 ||
    trimmed === DEFAULT_HTTP_REQUEST_URL ||
    trimmed === DEFAULT_GRAPHQL_REQUEST_URL ||
    trimmed === DEFAULT_WEBSOCKET_REQUEST_URL
  );
}
