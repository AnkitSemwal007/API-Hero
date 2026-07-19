/**
 * Internal `$ref` resolver for OpenAPI 3 documents.
 *
 * Supports local JSON Pointer refs (`#/components/...`) with caching, depth
 * caps, and cycle detection. External file/URL refs are rejected with a
 * diagnostic (import stays local and never fetches remote content).
 */

import type { ImportDiagnostic, ImportLimits } from '../models';
import { DEFAULT_IMPORT_LIMITS } from '../models';
import { maskImportSecretText } from '../sanitize';
import { isReference } from './types';

export interface RefResolverOptions {
  readonly limits?: Partial<ImportLimits>;
}

export interface ResolveResult<T> {
  readonly value?: T;
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly circular: boolean;
}

/**
 * Resolves local `$ref` values against a document root object.
 * Caches successful resolutions; cycles fail gracefully.
 */
export class OpenApiRefResolver {
  private readonly cache = new Map<string, unknown>();
  private readonly limits: ImportLimits;
  private readonly diagnostics: ImportDiagnostic[] = [];

  public constructor(
    private readonly root: unknown,
    options: RefResolverOptions = {},
  ) {
    this.limits = { ...DEFAULT_IMPORT_LIMITS, ...options.limits };
  }

  public getDiagnostics(): readonly ImportDiagnostic[] {
    return this.diagnostics;
  }

  /**
   * If `value` is a `$ref`, resolve it; otherwise return `value`.
   * Tracks the chase stack to detect cycles.
   */
  public resolve<T>(
    value: T | { readonly $ref: string },
    stack: readonly string[] = [],
  ): ResolveResult<T> {
    if (!isReference(value)) {
      return { value: value as T, diagnostics: [], circular: false };
    }
    return this.resolveRef<T>(value.$ref, stack);
  }

  public resolveRef<T>(
    ref: string,
    stack: readonly string[] = [],
  ): ResolveResult<T> {
    const diagnostics: ImportDiagnostic[] = [];

    if (!ref.startsWith('#/')) {
      const message = maskImportSecretText(
        `External or unsupported $ref is not resolved during import: ${ref}`,
      );
      const diagnostic: ImportDiagnostic = {
        code: 'external-ref',
        severity: 'warning',
        path: ref,
        message,
      };
      this.diagnostics.push(diagnostic);
      diagnostics.push(diagnostic);
      return { diagnostics, circular: false };
    }

    if (stack.includes(ref)) {
      const diagnostic: ImportDiagnostic = {
        code: 'circular-ref',
        severity: 'warning',
        path: ref,
        message: maskImportSecretText(
          `Circular $ref detected at ${ref}; using null placeholder.`,
        ),
      };
      this.diagnostics.push(diagnostic);
      diagnostics.push(diagnostic);
      return { diagnostics, circular: true };
    }

    if (stack.length >= this.limits.maxRefDepth) {
      const diagnostic: ImportDiagnostic = {
        code: 'ref-depth-exceeded',
        severity: 'error',
        path: ref,
        message: `Maximum $ref depth of ${this.limits.maxRefDepth} exceeded at ${ref}.`,
      };
      this.diagnostics.push(diagnostic);
      diagnostics.push(diagnostic);
      return { diagnostics, circular: false };
    }

    if (this.cache.has(ref)) {
      return {
        value: this.cache.get(ref) as T,
        diagnostics: [],
        circular: false,
      };
    }

    const pointerResult = evaluateJsonPointer(this.root, ref);
    if (!pointerResult.ok) {
      const diagnostic: ImportDiagnostic = {
        code: 'missing-ref',
        severity: 'error',
        path: ref,
        message: maskImportSecretText(
          `Could not resolve $ref "${ref}": ${pointerResult.reason}`,
        ),
      };
      this.diagnostics.push(diagnostic);
      diagnostics.push(diagnostic);
      return { diagnostics, circular: false };
    }

    const nextStack = [...stack, ref];
    let resolved = pointerResult.value;

    // Follow chained refs (A → B → C) with cycle/depth protection.
    let hops = 0;
    while (isReference(resolved) && hops < this.limits.maxRefDepth) {
      if (nextStack.includes(resolved.$ref)) {
        const diagnostic: ImportDiagnostic = {
          code: 'circular-ref',
          severity: 'warning',
          path: resolved.$ref,
          message: maskImportSecretText(
            `Circular $ref chain detected involving ${resolved.$ref}.`,
          ),
        };
        this.diagnostics.push(diagnostic);
        diagnostics.push(diagnostic);
        return { diagnostics, circular: true };
      }
      const hop = this.resolveRef<unknown>(resolved.$ref, nextStack);
      diagnostics.push(...hop.diagnostics);
      if (hop.circular || hop.value === undefined) {
        return { diagnostics, circular: hop.circular };
      }
      resolved = hop.value;
      hops += 1;
    }

    this.cache.set(ref, resolved);
    return { value: resolved as T, diagnostics, circular: false };
  }
}

interface PointerOk {
  readonly ok: true;
  readonly value: unknown;
}

interface PointerFail {
  readonly ok: false;
  readonly reason: string;
}

function evaluateJsonPointer(
  root: unknown,
  ref: string,
): PointerOk | PointerFail {
  // `#/components/schemas/Pet` → ['components', 'schemas', 'Pet']
  const raw = ref.slice(1); // drop '#'
  if (!raw.startsWith('/')) {
    return { ok: false, reason: 'pointer must start with #/' };
  }
  const parts = raw
    .split('/')
    .slice(1)
    .map(decodePointerToken);

  let current: unknown = root;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return { ok: false, reason: `non-object at segment "${part}"` };
    }
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { ok: false, reason: `array index "${part}" out of range` };
      }
      current = current[index];
      continue;
    }
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, part)) {
      return { ok: false, reason: `missing key "${part}"` };
    }
    current = record[part];
  }
  return { ok: true, value: current };
}

function decodePointerToken(token: string): string {
  return token.replace(/~1/gu, '/').replace(/~0/gu, '~');
}
