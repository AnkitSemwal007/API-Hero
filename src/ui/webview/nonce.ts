import { randomBytes } from 'node:crypto';

/** Creates a cryptographically random nonce for webview CSP. */
export function createWebviewNonce(): string {
  return randomBytes(18).toString('base64url');
}
