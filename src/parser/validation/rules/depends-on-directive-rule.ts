import {
  AstNodeType,
  type ApiDocument,
  type DirectiveNode,
  type RequestNode,
} from '../../ast';
import { parseDependsOnDirective } from '../../../dependencies/parse-depends-on';
import type { ValidationContext, ValidationRule } from '../types';
import { VALIDATION_DIAGNOSTIC_CODES } from './diagnostic-codes';

/**
 * Semantic validation for `@depends-on` directive values.
 *
 * This rule validates at file scope only — it has no knowledge of sibling
 * `.api` files in the owning collection. `unknown-target` is therefore
 * reported as a warning here; plan-time enrichment (Phase 2 PR4+) applies the
 * fail-closed error policy once the full collection membership is known.
 */
export const dependsOnDirectiveValidationRule: ValidationRule = Object.freeze({
  id: 'depends-on-directive',
  validate(document: ApiDocument, context: ValidationContext): void {
    const nameIndex = buildRequestNameIndex(document, context.requests);

    for (const directive of context.directives) {
      if (directive.knownName !== 'depends-on') {
        continue;
      }

      const value = directive.value.trim();
      if (value.length === 0) {
        // Empty values are owned by the generic directive rule.
        continue;
      }

      const parsed = parseDependsOnDirective(directive.value);
      if (!parsed.ok) {
        context.report({
          code: VALIDATION_DIAGNOSTIC_CODES.dependsOnInvalid,
          message: 'Malformed @depends-on directive value.',
          severity: 'error',
          range: directive.range,
        });
        continue;
      }

      const ownRequest = owningRequest(directive, nameIndex.requestByBlock);
      const ownName = ownRequest === undefined
        ? undefined
        : nameIndex.ownName.get(ownRequest);

      const seen = new Set<string>();
      for (const name of parsed.names) {
        if (seen.has(name)) {
          context.report({
            code: VALIDATION_DIAGNOSTIC_CODES.dependsOnDuplicateName,
            message: `Duplicate name "${name}" in @depends-on list.`,
            severity: 'warning',
            range: directive.range,
          });
          continue;
        }
        seen.add(name);

        if (ownName !== undefined && name === ownName) {
          context.report({
            code: VALIDATION_DIAGNOSTIC_CODES.dependsOnSelfDepends,
            message: `Request "${name}" cannot depend on itself.`,
            severity: 'error',
            range: directive.range,
          });
          continue;
        }

        const matches = nameIndex.byName.get(name) ?? [];
        if (matches.length === 0) {
          context.report({
            code: VALIDATION_DIAGNOSTIC_CODES.dependsOnUnknownTarget,
            message: `No request named "${name}" was found in this file. ` +
              'If it lives in another file within the collection, this is expected here.',
            severity: 'warning',
            range: directive.range,
          });
        } else if (matches.length > 1) {
          context.report({
            code: VALIDATION_DIAGNOSTIC_CODES.dependsOnAmbiguousTarget,
            message: `Multiple requests in this file are named "${name}"; @depends-on target is ambiguous.`,
            severity: 'error',
            range: directive.range,
          });
        }
      }
    }
  },
});

interface RequestNameIndex {
  readonly ownName: ReadonlyMap<RequestNode, string>;
  readonly byName: ReadonlyMap<string, readonly RequestNode[]>;
  /** Maps the parser's `requestBlock` ordinal (`###`-delimited) to its request. */
  readonly requestByBlock: ReadonlyMap<number, RequestNode>;
}

function buildRequestNameIndex(
  document: ApiDocument,
  requests: readonly RequestNode[],
): RequestNameIndex {
  const ownName = new Map<RequestNode, string>();
  const byName = new Map<string, RequestNode[]>();
  const requestByBlock = new Map<number, RequestNode>();

  for (const request of requests) {
    const block = requestBlockOf(request);
    if (block !== undefined && !requestByBlock.has(block)) {
      requestByBlock.set(block, request);
    }
  }

  for (const request of requests) {
    const name = requestDisplayName(document, request);
    if (name === undefined) {
      continue;
    }
    ownName.set(request, name);
    const bucket = byName.get(name);
    if (bucket === undefined) {
      byName.set(name, [request]);
    } else {
      bucket.push(request);
    }
  }

  return { ownName, byName, requestByBlock };
}

/**
 * Resolves a request's effective `@name` label: request-scoped directives and
 * document-level directives sharing the request's `requestBlock` ordinal are
 * both candidates (single-request files put `@name` before the method line,
 * i.e. at document scope); the one with the latest source position wins,
 * matching directive "last wins" semantics.
 */
function requestDisplayName(
  document: ApiDocument,
  request: RequestNode,
): string | undefined {
  const block = requestBlockOf(request);
  const candidates: DirectiveNode[] = request.directives.filter(isNameDirective);
  for (const directive of document.directives) {
    if (isNameDirective(directive) && sameBlock(directive, block)) {
      candidates.push(directive);
    }
  }
  if (candidates.length === 0) {
    return undefined;
  }
  const last = candidates.reduce((latest, candidate) =>
    candidate.range.start.offset > latest.range.start.offset ? candidate : latest,
  );
  const value = last.value.trim();
  return value.length > 0 ? value : undefined;
}

function isNameDirective(directive: DirectiveNode): boolean {
  return (
    (directive.knownName ?? directive.name.replace(/^@/u, '').toLowerCase()) ===
    'name'
  );
}

function sameBlock(
  directive: DirectiveNode,
  block: number | undefined,
): boolean {
  if (block === undefined) {
    return false;
  }
  return directiveBlockOf(directive) === block;
}

/**
 * A `@depends-on` directive belongs to whichever request shares its parser
 * `requestBlock` ordinal — this covers both request-scoped directives and
 * document-level directives authored before a single request's method line
 * (the common single-request-file shape). Falls back to the immediate parent
 * request node when `requestBlock` metadata is absent (e.g. hand-built ASTs
 * in tests that bypass the canonical parser).
 */
function owningRequest(
  directive: DirectiveNode,
  requestByBlock: ReadonlyMap<number, RequestNode>,
): RequestNode | undefined {
  const block = directiveBlockOf(directive);
  if (block !== undefined) {
    const byBlock = requestByBlock.get(block);
    if (byBlock !== undefined) {
      return byBlock;
    }
  }
  return directive.parent?.type === AstNodeType.Request
    ? directive.parent
    : undefined;
}

function requestBlockOf(request: RequestNode): number | undefined {
  const block = request.metadata.requestBlock;
  return typeof block === 'number' && Number.isSafeInteger(block)
    ? block
    : undefined;
}

function directiveBlockOf(directive: DirectiveNode): number | undefined {
  const block = directive.metadata.requestBlock;
  return typeof block === 'number' && Number.isSafeInteger(block)
    ? block
    : undefined;
}
