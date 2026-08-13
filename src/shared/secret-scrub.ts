/**
 * Shared secret-scrubbing heuristics for display surfaces (response diff, MCP).
 * Patterns align with `src/mcp/redact.ts` — keep both in sync when extending.
 */

/** Same mask glyph as `MASKED_VARIABLE_VALUE` / presentation header mask. */
export const SECRET_SCRUB_MASK = '••••••••';

const SENSITIVE_NAME =
  /(token|secret|password|passwd|api[_-]?key|authorization|auth|bearer|refresh|credential|cookie|session)/iu;

const BEARER_IN_TEXT = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gu;
const BASIC_IN_TEXT = /\bBasic\s+[A-Za-z0-9+/=]{8,}/gu;
const JWT_IN_TEXT =
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const JSON_SENSITIVE_STRING_PROP =
  /"(accessToken|refreshToken|idToken|access_token|refresh_token|id_token|password|passwd|client_secret|clientSecret|apiKey|api_key|authorization|token)"\s*:\s*"(?:\\.|[^"\\])*"/giu;

/** True when a JSON/object key name looks secret-bearing. */
export function isSensitiveSecretKey(name: string): boolean {
  return SENSITIVE_NAME.test(name);
}

/**
 * Masks bearer/basic/JWT tokens and known sensitive JSON string properties
 * inside free-form text (including body.raw / body.pretty).
 */
export function scrubSecretTokensInText(text: string): string {
  let next = text.replace(BEARER_IN_TEXT, `Bearer ${SECRET_SCRUB_MASK}`);
  next = next.replace(BASIC_IN_TEXT, `Basic ${SECRET_SCRUB_MASK}`);
  next = next.replace(JWT_IN_TEXT, SECRET_SCRUB_MASK);
  next = next.replace(
    JSON_SENSITIVE_STRING_PROP,
    (_match, prop: string) => `"${prop}":"${SECRET_SCRUB_MASK}"`,
  );
  return next;
}

/**
 * Replaces known secret substrings (longest first), matching curl / presentation
 * exact-value masking. Empty strings are ignored.
 */
export function replaceKnownSecretValues(
  text: string,
  secrets: readonly string[],
): string {
  let next = text;
  const ordered = [...secrets]
    .filter((secret) => secret.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const secret of ordered) {
    next = next.split(secret).join(SECRET_SCRUB_MASK);
  }
  return next;
}

/**
 * Heuristic token/JSON-property scrub plus exact replacement of known secrets
 * from the request (sensitive headers and variable values).
 */
export function scrubTextWithKnownSecrets(
  text: string,
  secrets: readonly string[] = [],
): string {
  return replaceKnownSecretValues(scrubSecretTokensInText(text), secrets);
}

/**
 * Deep-clones JSON-compatible values and masks secret-like keys / tokens.
 * Non-JSON inputs fall through to {@link scrubSecretTokensInText}.
 */
export function scrubJsonSecrets(value: unknown, keyHint?: string): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    if (keyHint !== undefined && isSensitiveSecretKey(keyHint)) {
      return SECRET_SCRUB_MASK;
    }
    return scrubSecretTokensInText(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrubJsonSecrets(entry, keyHint));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveSecretKey(key)) {
        if (typeof child === 'string') {
          out[key] = SECRET_SCRUB_MASK;
        } else if (child !== null && typeof child === 'object') {
          out[key] = scrubJsonSecrets(child, key);
        } else {
          out[key] = SECRET_SCRUB_MASK;
        }
        continue;
      }
      out[key] = scrubJsonSecrets(child, key);
    }
    return out;
  }
  return value;
}

/**
 * Scrubs a response body text for safe display/diff. Parses JSON when possible
 * so nested secret keys are masked; otherwise applies token heuristics.
 */
export function scrubBodyTextForDisplay(
  text: string,
  pretty = false,
): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const redacted = scrubJsonSecrets(parsed);
      return pretty
        ? JSON.stringify(redacted, null, 2)
        : JSON.stringify(redacted);
    } catch {
      // Fall through to string heuristics for truncated / non-JSON bodies.
    }
  }
  return scrubSecretTokensInText(text);
}
