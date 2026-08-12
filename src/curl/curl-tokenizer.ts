/**
 * Framework-free tokenizer for cURL command strings.
 * Never invokes a shell — quotes, escapes, and line continuations are handled here.
 */

/** Maximum accepted cURL paste size (256 KiB). */
export const CURL_MAX_INPUT_BYTES = 256 * 1024;

export interface CurlToken {
  readonly value: string;
  /** 0-based character offset in the joined (continuation-stripped) input. */
  readonly offset: number;
}

export interface CurlTokenizeSuccess {
  readonly ok: true;
  readonly tokens: readonly CurlToken[];
  /** Input after line-continuation joining (used for offsets). */
  readonly joined: string;
}

export interface CurlTokenizeFailure {
  readonly ok: false;
  readonly message: string;
  readonly code: string;
}

export type CurlTokenizeResult = CurlTokenizeSuccess | CurlTokenizeFailure;

/**
 * Joins POSIX line continuations (`\` before newline) and tokenizes like a
 * minimal shell word splitter (single/double quotes, adjacent-quote join).
 * Does not expand variables, run substitutions, or execute anything.
 */
export function tokenizeCurlCommand(input: string): CurlTokenizeResult {
  if (input.length > CURL_MAX_INPUT_BYTES) {
    return {
      ok: false,
      message: `cURL input exceeds ${CURL_MAX_INPUT_BYTES} bytes.`,
      code: 'curl.input_too_large',
    };
  }

  const joined = joinLineContinuations(input);
  const tokens: CurlToken[] = [];
  let i = 0;
  const length = joined.length;

  while (i < length) {
    const ch = joined[i]!;
    if (isWhitespace(ch)) {
      i += 1;
      continue;
    }
    // Skip shell-style full-line comments after whitespace (inert; never executed).
    if (ch === '#' && (i === 0 || isWhitespace(joined[i - 1]!))) {
      while (i < length && joined[i] !== '\n') {
        i += 1;
      }
      continue;
    }

    const start = i;
    let value = '';

    while (i < length) {
      const c = joined[i]!;
      if (isWhitespace(c)) {
        break;
      }
      if (c === "'") {
        i += 1;
        let closed = false;
        while (i < length) {
          const q = joined[i]!;
          if (q === "'") {
            i += 1;
            closed = true;
            break;
          }
          value += q;
          i += 1;
        }
        if (!closed) {
          return {
            ok: false,
            message: 'Unclosed single quote in cURL input.',
            code: 'curl.unclosed_quote',
          };
        }
        continue;
      }
      if (c === '"') {
        i += 1;
        let closed = false;
        while (i < length) {
          const q = joined[i]!;
          if (q === '"') {
            i += 1;
            closed = true;
            break;
          }
          if (q === '\\' && i + 1 < length) {
            const next = joined[i + 1]!;
            if (
              next === '"' ||
              next === '\\' ||
              next === '$' ||
              next === '`' ||
              next === '\n'
            ) {
              value += next === '\n' ? '' : next;
              i += 2;
              continue;
            }
          }
          value += q;
          i += 1;
        }
        if (!closed) {
          return {
            ok: false,
            message: 'Unclosed double quote in cURL input.',
            code: 'curl.unclosed_quote',
          };
        }
        continue;
      }
      if (c === '\\' && i + 1 < length) {
        value += joined[i + 1]!;
        i += 2;
        continue;
      }
      value += c;
      i += 1;
    }

    tokens.push({ value, offset: start });
  }

  return { ok: true, tokens, joined };
}

/** Removes `\` + newline continuations (including CRLF). */
export function joinLineContinuations(input: string): string {
  return input.replace(/\\\r?\n/gu, '');
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}
