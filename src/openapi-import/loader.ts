/**
 * Loads OpenAPI specification text and detects JSON vs YAML.
 *
 * JSON uses `JSON.parse`. YAML uses the `yaml` package (YAML 1.2), chosen as a
 * well-maintained, focused runtime dependency without pulling an OpenAPI SDK.
 */

import { parse as parseYaml } from 'yaml';

import type { ImportDiagnostic, ImportLimits } from './models';
import { DEFAULT_IMPORT_LIMITS } from './models';
import { maskImportSecretText } from './sanitize';

export type SpecFormat = 'json' | 'yaml';

export interface LoadedSpecification {
  readonly text: string;
  readonly format: SpecFormat;
  readonly byteLength: number;
  readonly sourcePath?: string;
}

export interface LoadResult {
  readonly loaded?: LoadedSpecification;
  readonly root?: unknown;
  readonly diagnostics: readonly ImportDiagnostic[];
}

export type ImportSourceSizeCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostic: ImportDiagnostic };

/**
 * Framework-free size gate used before reading a file (VS Code `stat`) and
 * again after decoding text in {@link loadSpecification}.
 */
export function evaluateImportSourceSize(
  byteLength: number,
  maxFileBytes: number,
): ImportSourceSizeCheck {
  if (
    typeof byteLength !== 'number' ||
    !Number.isFinite(byteLength) ||
    byteLength < 0
  ) {
    return {
      ok: false,
      diagnostic: {
        code: 'file-too-large',
        severity: 'error',
        message: 'Could not determine specification file size.',
      },
    };
  }
  if (byteLength > maxFileBytes) {
    return {
      ok: false,
      diagnostic: {
        code: 'file-too-large',
        severity: 'error',
        message: maskImportSecretText(
          `Specification exceeds the maximum size of ${maxFileBytes} bytes (got ${byteLength}).`,
        ),
      },
    };
  }
  return { ok: true };
}

/**
 * Detects format from file extension when present, otherwise from content.
 * Leading BOM is ignored. JSON is preferred when the text clearly starts with
 * `{` or `[` after optional whitespace.
 */
export function detectSpecFormat(
  text: string,
  fileName?: string,
): SpecFormat {
  const lower = (fileName ?? '').toLowerCase();
  if (lower.endsWith('.json')) {
    return 'json';
  }
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    return 'yaml';
  }
  const trimmed = text.replace(/^\uFEFF/u, '').trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'json';
  }
  return 'yaml';
}

/**
 * Validates size, detects format, and parses the root value.
 * Never throws for malformed content — returns diagnostics instead.
 */
export function loadSpecification(
  text: string,
  options: {
    readonly sourcePath?: string;
    readonly fileName?: string;
    readonly limits?: Partial<ImportLimits>;
  } = {},
): LoadResult {
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...options.limits };
  const byteLength = Buffer.byteLength(text, 'utf8');
  const sizeCheck = evaluateImportSourceSize(byteLength, limits.maxFileBytes);
  if (!sizeCheck.ok) {
    return { diagnostics: [sizeCheck.diagnostic] };
  }

  if (text.trim().length === 0) {
    return {
      diagnostics: [
        {
          code: 'empty-specification',
          severity: 'error',
          message: 'Specification file is empty.',
        },
      ],
    };
  }

  const format = detectSpecFormat(text, options.fileName ?? options.sourcePath);
  const loaded: LoadedSpecification = {
    text,
    format,
    byteLength,
    ...(options.sourcePath === undefined
      ? {}
      : { sourcePath: options.sourcePath }),
  };

  try {
    const root =
      format === 'json'
        ? JSON.parse(text) as unknown
        : parseYaml(text, { maxAliasCount: 100, prettyErrors: true });
    if (root === null || typeof root !== 'object' || Array.isArray(root)) {
      return {
        loaded,
        diagnostics: [
          {
            code: 'invalid-root',
            severity: 'error',
            message: 'Specification root must be a JSON/YAML object.',
          },
        ],
      };
    }
    return { loaded, root, diagnostics: [] };
  } catch (error) {
    const raw =
      error instanceof Error ? error.message : String(error);
    return {
      loaded,
      diagnostics: [
        {
          code: format === 'json' ? 'malformed-json' : 'malformed-yaml',
          severity: 'error',
          message: maskImportSecretText(
            `Failed to parse ${format.toUpperCase()}: ${raw}`,
          ),
        },
      ],
    };
  }
}
