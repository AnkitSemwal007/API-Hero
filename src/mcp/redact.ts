/**
 * Defense-in-depth secret redaction for MCP tool JSON payloads.
 * Reuses presentation / variable mask constants where possible.
 */

import { MASKED_HEADER_VALUE } from '../response/presentation';
import {
  isSensitiveHttpHeaderName,
  redactUrlUserinfo,
} from '../shared';
import { MASKED_VARIABLE_VALUE } from '../variables';

/** Same mask glyph used by response presentation and variable UI. */
export const MCP_SECRET_MASK = MASKED_VARIABLE_VALUE;

const SENSITIVE_NAME =
  /(token|secret|password|passwd|api[_-]?key|authorization|auth|bearer|refresh|credential|cookie|session)/iu;

const BEARER_IN_TEXT = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gu;
const BASIC_IN_TEXT = /\bBasic\s+[A-Za-z0-9+/=]{8,}/gu;
/** Compact JWT / JWS (header.payload.signature) — common in DummyJSON login bodies. */
const JWT_IN_TEXT =
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
/**
 * JSON string properties whose values must never leave MCP as cleartext
 * (even when embedded inside `body.raw` / `body.pretty` strings).
 */
const JSON_SENSITIVE_STRING_PROP =
  /"(accessToken|refreshToken|idToken|access_token|refresh_token|id_token|password|passwd|client_secret|clientSecret|apiKey|api_key|authorization|token)"\s*:\s*"(?:\\.|[^"\\])*"/giu;

/**
 * Deep-clones JSON-compatible values and masks secrets in headers, bodies,
 * URLs, and auth-like fields. Never returns SecretStore contents.
 */
export function redactForMcp<T>(value: T): T {
  return redactValue(value, undefined) as T;
}

function redactValue(value: unknown, keyHint: string | undefined): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return redactString(value, keyHint);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, keyHint));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      if (isSensitiveKey(key)) {
        if (typeof child === 'string') {
          out[key] = MCP_SECRET_MASK;
        } else if (child !== null && typeof child === 'object') {
          out[key] = redactValue(child, key);
        } else {
          out[key] = MCP_SECRET_MASK;
        }
        continue;
      }
      if (
        key.toLowerCase() === 'headers' &&
        Array.isArray(child)
      ) {
        out[key] = child.map((header) => redactHeaderEntry(header));
        continue;
      }
      if (
        (key.toLowerCase() === 'url' ||
          key.toLowerCase() === 'finalurl' ||
          key.toLowerCase() === 'final_url') &&
        typeof child === 'string'
      ) {
        out[key] = redactUrlUserinfo(child);
        continue;
      }
      out[key] = redactValue(child, key);
    }
    return out;
  }
  return value;
}

function redactHeaderEntry(header: unknown): unknown {
  if (header === null || typeof header !== 'object') {
    return header;
  }
  const entry = header as Record<string, unknown>;
  const name = typeof entry.name === 'string' ? entry.name : '';
  if (isSensitiveHttpHeaderName(name) || isSensitiveKey(name)) {
    return {
      ...entry,
      value: MASKED_HEADER_VALUE,
      masked: true,
    };
  }
  if (typeof entry.value === 'string') {
    return {
      ...entry,
      value: redactString(entry.value, name),
    };
  }
  return redactValue(entry, name);
}

function redactString(text: string, keyHint: string | undefined): string {
  if (keyHint !== undefined && isSensitiveKey(keyHint)) {
    return MCP_SECRET_MASK;
  }
  const assertionValueKey =
    keyHint !== undefined &&
    (keyHint.toLowerCase() === 'expected' ||
      keyHint.toLowerCase() === 'actual');
  // Parse JSON bodies so object keys like accessToken/password are masked
  // recursively — string-level regex alone misses nested cleartext tokens.
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
    (keyHint === undefined ||
      keyHint === 'raw' ||
      keyHint === 'pretty' ||
      keyHint === 'body' ||
      keyHint === 'text')
  ) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const redacted = redactValue(parsed, keyHint);
      if (keyHint === 'pretty') {
        return JSON.stringify(redacted, null, 2);
      }
      return JSON.stringify(redacted);
    } catch {
      // Fall through to string heuristics for non-JSON / truncated bodies.
    }
  }
  let next = redactUrlUserinfo(text);
  next = next.replace(BEARER_IN_TEXT, `Bearer ${MCP_SECRET_MASK}`);
  next = next.replace(BASIC_IN_TEXT, `Basic ${MCP_SECRET_MASK}`);
  next = next.replace(JWT_IN_TEXT, MCP_SECRET_MASK);
  next = next.replace(
    JSON_SENSITIVE_STRING_PROP,
    (_match, prop: string) => `"${prop}":"${MCP_SECRET_MASK}"`,
  );
  // Assertion expected/actual: mask remaining token-like cleartext that the
  // engine did not already replace with ••••••••.
  if (assertionValueKey && looksLikeSecretValue(next)) {
    return MCP_SECRET_MASK;
  }
  return next;
}

function looksLikeSecretValue(value: string): boolean {
  if (value === MCP_SECRET_MASK || value.length === 0) {
    return false;
  }
  if (/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value)) {
    return true;
  }
  if (/^(Bearer|Basic)\s+\S+/iu.test(value)) {
    return true;
  }
  // Long opaque tokens (API keys, session ids) without whitespace.
  if (value.length >= 24 && /^[A-Za-z0-9._\-+/=]+$/u.test(value)) {
    return true;
  }
  return false;
}

export function isSensitiveKey(name: string): boolean {
  return SENSITIVE_NAME.test(name);
}

/** Masks a variable value when the definition is marked sensitive. */
export function maskVariableIfSensitive(
  name: string,
  value: string,
  sensitive: boolean | undefined,
): string {
  if (sensitive === true || isSensitiveKey(name)) {
    return MCP_SECRET_MASK;
  }
  return value;
}

/** Redacts userinfo from a request URL for agent-facing listings. */
export function redactRequestUrl(url: string): string {
  return redactUrlUserinfo(url);
}
