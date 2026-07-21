import { escapeAttribute } from './html-escape';

export interface NonceOnlyCspOptions {
  /** When true, allows `img-src data:` (otherwise `img-src 'none'`). */
  readonly allowDataImages?: boolean;
}

/**
 * Builds a nonce-only CSP content string for API Hero webviews.
 * Preserves the two historical directive orderings used by existing panels.
 */
export function buildNonceOnlyCsp(
  nonce: string,
  options?: NonceOnlyCspOptions,
): string {
  const safeNonce = escapeAttribute(nonce);
  if (options?.allowDataImages === true) {
    return (
      `default-src 'none'; img-src data:; style-src 'nonce-${safeNonce}'; ` +
      `script-src 'nonce-${safeNonce}'; font-src 'none'; connect-src 'none'; ` +
      `frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
    );
  }
  return (
    `default-src 'none'; style-src 'nonce-${safeNonce}'; ` +
    `script-src 'nonce-${safeNonce}'; font-src 'none'; connect-src 'none'; ` +
    `img-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; ` +
    `form-action 'none'`
  );
}
