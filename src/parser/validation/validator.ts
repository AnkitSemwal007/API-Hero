import {
  AstBuilder,
  AstNodeType,
  walkAst,
  type ApiDocument,
  type AstDiagnostic,
  type AstNode,
  type DirectiveNode,
  type HeaderNode,
  type RequestNode,
  type VariableNode,
} from '../ast';
import type { Range } from '../types';
import { rangesOverlap } from '../../shared';
import {
  defaultValidationRules,
} from './rules';
import type {
  ValidationContext,
  ValidationDiagnosticOptions,
  ValidationResult,
  ValidationRule,
} from './types';

/** Runs contributed semantic rules over an already-parsed canonical document. */
export class SemanticValidator {
  public constructor(
    private readonly rules: readonly ValidationRule[] = defaultValidationRules,
  ) {}

  public validate(document: ApiDocument): ValidationResult {
    const diagnostics: AstDiagnostic[] = [];
    const context = createContext(document, diagnostics);

    for (const rule of this.rules) {
      rule.validate(document, context);
    }

    const frozenDiagnostics = Object.freeze([...diagnostics]);
    return Object.freeze({
      diagnostics: frozenDiagnostics,
      valid: !frozenDiagnostics.some(
        (diagnostic) => diagnostic.severity === 'error',
      ),
    });
  }
}

/** Validates one parsed document with the default or caller-contributed rules. */
export function validateApiDocument(
  document: ApiDocument,
  rules?: readonly ValidationRule[],
): ValidationResult {
  return new SemanticValidator(rules).validate(document);
}

/**
 * Validates one selected request while retaining document-level semantics used
 * by request construction. Rules still run through the canonical validator;
 * only diagnostics unrelated to the selected runtime projection are omitted.
 */
export function validateApiRequest(
  document: ApiDocument,
  request: RequestNode,
  rules?: readonly ValidationRule[],
): ValidationResult {
  if (!document.requests.includes(request)) {
    throw new TypeError('Scoped validation requires a request from the document.');
  }
  const full = validateApiDocument(document, rules);
  const requiredRanges = [
    request.range,
    ...document.directives.map((directive) => directive.range),
  ];
  const diagnostics = Object.freeze(full.diagnostics.filter((diagnostic) =>
    requiredRanges.some((range) => rangesOverlap(diagnostic.range, range)) ||
    diagnostic.relatedInformation?.some((related) =>
      rangesOverlap(related.location.range, request.range),
    ) === true,
  ));
  return Object.freeze({
    diagnostics,
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
  });
}

function createContext(
  document: ApiDocument,
  diagnostics: AstDiagnostic[],
): ValidationContext {
  const builder = new AstBuilder(document.sourceId);
  const nodes: AstNode[] = [];
  const requests: RequestNode[] = [];
  const headers: HeaderNode[] = [];
  const directives: DirectiveNode[] = [];
  const variables: VariableNode[] = [];

  walkAst(document, {
    enterNode(node) {
      nodes.push(node);
      switch (node.type) {
        case AstNodeType.Request:
          requests.push(node);
          break;
        case AstNodeType.Header:
          headers.push(node);
          break;
        case AstNodeType.Directive:
          directives.push(node);
          break;
        case AstNodeType.Variable:
          variables.push(node);
          break;
        default:
          break;
      }
    },
  });

  const allDiagnostics = (): readonly AstDiagnostic[] => [
    ...document.diagnostics,
    ...diagnostics,
  ];
  const hasDiagnostic = (code: string, range?: Range): boolean =>
    allDiagnostics().some(
      (diagnostic) =>
        diagnostic.code === code &&
        (range === undefined || rangesOverlap(diagnostic.range, range)),
    );
  const report = (options: ValidationDiagnosticOptions): void => {
    if (hasDiagnostic(options.code, options.range)) {
      return;
    }
    diagnostics.push(builder.diagnostic({
      ...options,
      source: 'api-validator',
    }));
  };

  return Object.freeze({
    requests: Object.freeze(requests),
    headers: Object.freeze(headers),
    directives: Object.freeze(directives),
    variables: Object.freeze(variables),
    nodes: Object.freeze(nodes),
    report,
    hasDiagnostic,
  });
}
