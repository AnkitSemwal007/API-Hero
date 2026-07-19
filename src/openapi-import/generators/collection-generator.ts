/**
 * Groups OpenAPI operations into folder / file artifacts for Collections.
 *
 * Folder rule:
 * - Prefer the first operation tag when present (sanitized segment).
 * - Otherwise use the first path segment (e.g. `/users/{id}` → `users`).
 * - Fallback folder name: `_root`.
 *
 * File rule: one `.api` file per operation under its tag/path folder
 * (`{method}-{operationId|path-slug}.api`) for clear Collections tree nodes.
 */

import type {
  GeneratedApiFile,
  ImportDiagnostic,
  ImportLimits,
} from '../models';
import type { OpenApiRefResolver } from '../openapi/resolve';
import type {
  OpenApiDocument,
  OpenApiHttpMethod,
  OpenApiPathItem,
} from '../openapi/types';
import { OPENAPI_HTTP_METHODS, isReference } from '../openapi/types';
import {
  safeJoinRelative,
  sanitizePathSegment,
  slugifyIdentifier,
} from '../sanitize';
import { generateRequestSource } from './request-generator';

export interface CollectionGenerationResult {
  readonly files: readonly GeneratedApiFile[];
  readonly folderCount: number;
  readonly requestCount: number;
  readonly diagnostics: readonly ImportDiagnostic[];
}

export function generateCollectionFiles(
  document: OpenApiDocument,
  resolver: OpenApiRefResolver,
  schemeToProfileId: ReadonlyMap<string, string>,
  limits?: Partial<ImportLimits>,
): CollectionGenerationResult {
  const diagnostics: ImportDiagnostic[] = [];
  const files: GeneratedApiFile[] = [];
  const folders = new Set<string>();
  const usedPaths = new Set<string>();
  const paths = document.paths ?? {};

  for (const [pathKey, pathItemOrUndef] of Object.entries(paths)) {
    if (pathItemOrUndef === undefined) {
      continue;
    }

    let pathItem: OpenApiPathItem = pathItemOrUndef;
    if (isReference(pathItemOrUndef)) {
      const resolved = resolver.resolveRef<OpenApiPathItem>(
        pathItemOrUndef.$ref,
      );
      diagnostics.push(...resolved.diagnostics);
      if (resolved.value === undefined) {
        continue;
      }
      pathItem = resolved.value;
    }

    for (const method of OPENAPI_HTTP_METHODS) {
      const operation = pathItem[method];
      if (operation === undefined) {
        continue;
      }

      const folder = folderForOperation(operation.tags, pathKey);
      folders.add(folder);

      const generated = generateRequestSource({
        document,
        resolver,
        pathKey,
        method,
        pathItem,
        operation,
        schemeToProfileId,
        limits,
      });
      diagnostics.push(...generated.diagnostics);

      const fileName = fileNameForOperation(method, operation.operationId, pathKey);
      const relativePath = safeJoinRelative(folder, fileName);
      if (relativePath === undefined) {
        diagnostics.push({
          code: 'unsafe-relative-path',
          severity: 'error',
          message: `Refusing unsafe relative path for ${method.toUpperCase()} ${pathKey}.`,
        });
        continue;
      }

      files.push({
        relativePath: uniqueRelativePath(relativePath, usedPaths),
        content: generated.content,
      });
    }
  }

  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath));

  return {
    files,
    folderCount: folders.size,
    requestCount: files.length,
    diagnostics,
  };
}

function folderForOperation(
  tags: readonly string[] | undefined,
  pathKey: string,
): string {
  const tag = tags?.find(
    (item) => typeof item === 'string' && item.trim().length > 0,
  );
  if (tag !== undefined) {
    return sanitizePathSegment(tag, '_root');
  }
  const segments = pathKey.split('/').filter((part) => part.length > 0);
  const first = segments[0];
  if (first === undefined) {
    return '_root';
  }
  const withoutTemplate = first.replace(/\{[^}]+\}/gu, '').replace(/^:/u, '');
  return sanitizePathSegment(
    withoutTemplate.length > 0 ? withoutTemplate : first,
    '_root',
  );
}

function fileNameForOperation(
  method: OpenApiHttpMethod,
  operationId: string | undefined,
  pathKey: string,
): string {
  const base =
    operationId !== undefined && operationId.trim().length > 0
      ? slugifyIdentifier(operationId, 'operation')
      : slugifyIdentifier(
          `${method}-${pathKey.replace(/[^\w]+/gu, '-')}`,
          'operation',
        );
  return `${method}-${base}.api`;
}

function uniqueRelativePath(
  preferred: string,
  used: Set<string>,
): string {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  const extensionIndex = preferred.toLowerCase().endsWith('.api')
    ? preferred.length - 4
    : preferred.length;
  const stem = preferred.slice(0, extensionIndex);
  const extension = preferred.slice(extensionIndex);
  let index = 2;
  let candidate = `${stem}-${index}${extension}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${stem}-${index}${extension}`;
  }
  used.add(candidate);
  return candidate;
}
