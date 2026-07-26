/**
 * Analyzes a parsed `.api` document to determine what one request produces
 * (enabled `@extract` / `@sensitive-extract` variable names) and consumes
 * (`{{name}}` references in its URL, headers, body, and directive values).
 * Framework-free — no `vscode` imports (§6.1–6.2).
 */

import { extractExtractionRulesForDocument } from '../extraction';
import {
  AstNodeType,
  type ApiDocument,
  type BodyNode,
  type DirectiveNode,
  type LiteralNode,
  type RequestNode,
} from '../parser';
import { extractDocumentVariables } from '../variables';
import { parseDependsOnDirective, uniqueDependsOnNames } from './parse-depends-on';
import type { RequestDependencyAnalysis } from './models';

const REFERENCE = /\{\{(\$?[A-Za-z_][A-Za-z0-9_.-]*)\}\}/gu;
const BUILT_INS = new Set(['$timestamp', '$uuid']);

/**
 * Analyzes the request located at `offset` within `document` / `sourceText`.
 * Returns an empty analysis when no request is found at `offset`.
 */
export function analyzeProducesConsumesForDocument(
  document: ApiDocument,
  sourceText: string,
  offset: number,
  requestId: string,
): RequestDependencyAnalysis {
  const requestIndex = findRequestIndexAtOffset(document, offset);
  if (requestIndex === undefined) {
    return emptyAnalysis(requestId);
  }
  const request = document.requests[requestIndex]!;

  const allRules = extractExtractionRulesForDocument(document, sourceText);
  const produces = [
    ...new Set(
      (allRules[requestIndex]?.rules ?? [])
        .filter((rule) => rule.enabled)
        .map((rule) => rule.variableName),
    ),
  ];

  const documentVariableNames = new Set(
    extractDocumentVariables(document).definitions.map((definition) => definition.name),
  );

  const referenced = new Set<string>();
  collectReferences(request.url, referenced);
  for (const header of request.headers) {
    collectReferences(header.name, referenced);
    collectReferences(header.value, referenced);
  }
  for (const directive of request.directives) {
    if (isVariableDefinitionDirective(directive)) {
      continue;
    }
    collectReferences(directive.value, referenced);
  }
  if (request.body !== undefined) {
    collectBodyReferences(request.body, referenced);
  }

  // Built-ins never gate dependency ordering; document `@variable` defaults
  // satisfy the reference locally, so neither creates a graph edge (§6.4).
  const consumes = [...referenced]
    .filter((name) => !BUILT_INS.has(name) && !documentVariableNames.has(name))
    .sort();

  return {
    requestId,
    produces,
    consumes,
    dependsOnNames: collectDependsOnNames(document, request, requestIndex),
  };
}

function emptyAnalysis(requestId: string): RequestDependencyAnalysis {
  return { requestId, produces: [], consumes: [], dependsOnNames: [] };
}

function isVariableDefinitionDirective(directive: DirectiveNode): boolean {
  return (
    directive.knownName === 'variable' ||
    directive.knownName === 'sensitive-variable'
  );
}

function collectReferences(source: string, into: Set<string>): void {
  for (const match of source.matchAll(REFERENCE)) {
    into.add(match[1]!);
  }
}

function collectBodyReferences(body: BodyNode, into: Set<string>): void {
  if (body.type === AstNodeType.JsonBody) {
    collectLiteralReferences(body.value, into);
    return;
  }
  if ('content' in body) {
    collectReferences(body.content, into);
  }
}

function collectLiteralReferences(node: LiteralNode, into: Set<string>): void {
  switch (node.type) {
    case AstNodeType.StringLiteral:
      collectReferences(node.value, into);
      return;
    case AstNodeType.ArrayLiteral:
      for (const element of node.elements) {
        collectLiteralReferences(element, into);
      }
      return;
    case AstNodeType.ObjectLiteral:
      for (const property of node.properties) {
        collectReferences(property.key.value, into);
        collectLiteralReferences(property.value, into);
      }
      return;
    default:
      return;
  }
}

function collectDependsOnNames(
  document: ApiDocument,
  request: RequestNode,
  requestIndex: number,
): readonly string[] {
  const block = readRequestBlock(request.metadata.requestBlock, requestIndex);
  const candidates: DirectiveNode[] = request.directives.filter(
    (directive) => directive.knownName === 'depends-on',
  );
  for (const directive of document.directives) {
    if (
      directive.knownName === 'depends-on' &&
      readRequestBlock(directive.metadata.requestBlock, -1) === block
    ) {
      candidates.push(directive);
    }
  }
  if (candidates.length === 0) {
    return [];
  }
  const last = candidates.reduce((latest, candidate) =>
    candidate.range.start.offset > latest.range.start.offset ? candidate : latest,
  );
  const parsed = parseDependsOnDirective(last.value);
  return parsed.ok ? uniqueDependsOnNames(parsed.names) : [];
}

/**
 * Finds the request whose block contains `offset`, mirroring
 * `extractExtractionRulesForOffset`'s association rule so produces/consumes
 * analysis stays consistent with extraction-rule attribution.
 */
function findRequestIndexAtOffset(
  document: ApiDocument,
  offset: number,
): number | undefined {
  for (let index = 0; index < document.requests.length; index += 1) {
    const request = document.requests[index]!;
    const nextStart =
      index + 1 < document.requests.length
        ? document.requests[index + 1]!.range.start.offset
        : Number.POSITIVE_INFINITY;
    if (offset >= request.range.start.offset && offset < nextStart) {
      return index;
    }
  }
  if (document.requests.length > 0 && offset < document.requests[0]!.range.start.offset) {
    return 0;
  }
  return undefined;
}

function readRequestBlock(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}
