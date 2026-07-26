import {
  AstNodeType,
  type ApiDocument,
  type DirectiveNode,
  type RequestNode,
} from '../../ast';
import {
  nameContainsPathSeparator,
  parseDependRef,
} from '../../../dependencies/depend-ref';
import { parseDependsOnDirective } from '../../../dependencies/parse-depends-on';
import type { ValidationContext, ValidationRule } from '../types';
import { VALIDATION_DIAGNOSTIC_CODES } from './diagnostic-codes';

/**
 * Semantic validation for `@depends-on` and `@name` dependency rules (ADR 0002).
 *
 * File-scope: bare / qualified human refs; ambiguous bare names list candidates;
 * `/` forbidden in `@name`; same-file duplicate `@name` fail closed.
 * Unknown targets outside this file are warnings; plan enrich fails closed.
 */
export const dependsOnDirectiveValidationRule: ValidationRule = Object.freeze({
  id: 'depends-on-directive',
  validate(document: ApiDocument, context: ValidationContext): void {
    const index = buildRequestResolveIndex(document, context.requests);
    validateNameDirectives(context, index);

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

      const ownRequest = owningRequest(directive, index.requestByBlock);
      const ownName =
        ownRequest === undefined ? undefined : index.ownName.get(ownRequest);

      const seen = new Set<string>();
      for (const token of parsed.names) {
        if (seen.has(token)) {
          context.report({
            code: VALIDATION_DIAGNOSTIC_CODES.dependsOnDuplicateName,
            message: `Duplicate dependency "${token}" in @depends-on list.`,
            severity: 'warning',
            range: directive.range,
          });
          continue;
        }
        seen.add(token);

        const ref = parseDependRef(token);
        if (ref === undefined) {
          context.report({
            code: VALIDATION_DIAGNOSTIC_CODES.dependsOnInvalid,
            message: `Invalid @depends-on token "${token}".`,
            severity: 'error',
            range: directive.range,
          });
          continue;
        }

        if (
          ownName !== undefined &&
          ((ref.kind === 'bare' && ref.name === ownName) ||
            (ref.kind === 'qualified' && ref.name === ownName))
        ) {
          // Self-depend via bare name or any qualified ending in own name when
          // this is the only match in-file for that spelling.
          const selfMatches =
            ref.kind === 'bare'
              ? (index.byName.get(ref.name) ?? [])
              : (index.byQualified.get(`${ref.folderPath}/${ref.name}`) ?? []);
          if (
            ownRequest !== undefined &&
            selfMatches.length === 1 &&
            selfMatches[0] === ownRequest
          ) {
            context.report({
              code: VALIDATION_DIAGNOSTIC_CODES.dependsOnSelfDepends,
              message: `Request cannot depend on itself ("${token}").`,
              severity: 'error',
              range: directive.range,
            });
            continue;
          }
        }

        if (ref.kind === 'bare') {
          const matches = index.byName.get(ref.name) ?? [];
          if (matches.length === 0) {
            context.report({
              code: VALIDATION_DIAGNOSTIC_CODES.dependsOnUnknownTarget,
              message:
                `No request named "${ref.name}" was found in this file. ` +
                'If it lives in another file within the collection, this is expected here.',
              severity: 'warning',
              range: directive.range,
            });
          } else if (matches.length > 1) {
            const candidates = matches
              .map((request) => {
                // File-scope has no folder path — suggest @name only; enrich
                // / collection tooling use Folder/Name.
                const name = index.ownName.get(request) ?? ref.name;
                return `"${name}"`;
              })
              .join(', ');
            context.report({
              code: VALIDATION_DIAGNOSTIC_CODES.dependsOnAmbiguousTarget,
              message:
                `Multiple requests in this file are named "${ref.name}"; ` +
                `@depends-on target is ambiguous. Prefer a qualified Folder/Name ref. ` +
                `Candidates: ${candidates}.`,
              severity: 'error',
              range: directive.range,
            });
          }
          continue;
        }

        const qualifiedKey = `${ref.folderPath}/${ref.name}`;
        const qualifiedMatches = index.byQualified.get(qualifiedKey) ?? [];
        // File-scope cannot resolve folder paths; treat qualified as name lookup
        // when folder metadata is unavailable, and warn on unknown bare-equivalent.
        const nameMatches = index.byName.get(ref.name) ?? [];
        if (qualifiedMatches.length === 0 && nameMatches.length === 0) {
          context.report({
            code: VALIDATION_DIAGNOSTIC_CODES.dependsOnUnknownTarget,
            message:
              `No request matching "${token}" was found in this file. ` +
              'If it lives in another file within the collection, this is expected here.',
            severity: 'warning',
            range: directive.range,
          });
        }
      }
    }
  },
});

interface RequestResolveIndex {
  readonly ownName: ReadonlyMap<RequestNode, string>;
  readonly byName: ReadonlyMap<string, readonly RequestNode[]>;
  /** Qualified key `folder/name` — file-scope uses name-only keys when unknown. */
  readonly byQualified: ReadonlyMap<string, readonly RequestNode[]>;
  /** Maps the parser's `requestBlock` ordinal (`###`-delimited) to its request. */
  readonly requestByBlock: ReadonlyMap<number, RequestNode>;
}

function validateNameDirectives(
  context: ValidationContext,
  index: RequestResolveIndex,
): void {
  for (const directive of context.directives) {
    if (directive.knownName !== 'name') {
      continue;
    }
    const value = directive.value.trim();
    if (value.length === 0) {
      continue;
    }
    if (nameContainsPathSeparator(value)) {
      context.report({
        code: VALIDATION_DIAGNOSTIC_CODES.nameContainsPathSeparator,
        message:
          'Request @name cannot contain "/". Use a display label; ' +
          'qualify dependencies as Folder/Name in @depends-on instead.',
        severity: 'error',
        range: directive.range,
      });
    }
  }

  for (const [name, requests] of index.byName) {
    if (requests.length < 2) {
      continue;
    }
    // Same-file duplicate @name — fail closed (same-folder for multi-request files).
    for (let i = 1; i < requests.length; i += 1) {
      const request = requests[i]!;
      const nameDirective = findNameDirectiveFor(request, context);
      if (nameDirective === undefined) {
        continue;
      }
      context.report({
        code: VALIDATION_DIAGNOSTIC_CODES.duplicateNameInFolder,
        message:
          `Duplicate @name "${name}" in this file. ` +
          'Same-folder duplicate names are not allowed; rename one request.',
        severity: 'error',
        range: nameDirective.range,
      });
    }
  }
}

function findNameDirectiveFor(
  request: RequestNode,
  context: ValidationContext,
): DirectiveNode | undefined {
  const block = requestBlockOf(request);
  let latest: DirectiveNode | undefined;
  for (const directive of context.directives) {
    if (directive.knownName !== 'name') {
      continue;
    }
    if (block !== undefined && directiveBlockOf(directive) !== block) {
      continue;
    }
    if (
      latest === undefined ||
      directive.range.start.offset > latest.range.start.offset
    ) {
      latest = directive;
    }
  }
  for (const directive of request.directives) {
    if (directive.knownName !== 'name') {
      continue;
    }
    if (
      latest === undefined ||
      directive.range.start.offset > latest.range.start.offset
    ) {
      latest = directive;
    }
  }
  return latest;
}

function buildRequestResolveIndex(
  document: ApiDocument,
  requests: readonly RequestNode[],
): RequestResolveIndex {
  const ownName = new Map<RequestNode, string>();
  const byName = new Map<string, RequestNode[]>();
  const byQualified = new Map<string, RequestNode[]>();
  const requestByBlock = new Map<number, RequestNode>();

  for (const request of requests) {
    const block = requestBlockOf(request);
    if (block !== undefined && !requestByBlock.has(block)) {
      requestByBlock.set(block, request);
    }
  }

  for (const request of requests) {
    const name = requestDisplayName(document, request);
    if (name !== undefined) {
      ownName.set(request, name);
      const bucket = byName.get(name);
      if (bucket === undefined) {
        byName.set(name, [request]);
      } else {
        bucket.push(request);
      }
      // File-scope has no folder path; qualified lookups fall back to name.
      const qKey = `/${name}`;
      const qBucket = byQualified.get(qKey);
      if (qBucket === undefined) {
        byQualified.set(qKey, [request]);
      } else {
        qBucket.push(request);
      }
    }
  }

  return { ownName, byName, byQualified, requestByBlock };
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

