import type {
  ApiDocument,
  AstDiagnostic,
  AstDiagnosticRelatedInformation,
  AstDiagnosticSeverity,
  AstNode,
  DirectiveNode,
  HeaderNode,
  RequestNode,
  VariableNode,
} from '../ast';
import type { Range } from '../types';

/** Immutable output of semantic validation over one canonical document. */
export interface ValidationResult {
  readonly diagnostics: readonly AstDiagnostic[];
  readonly valid: boolean;
}

/** A contributed semantic rule. Rules are independent of the validator engine. */
export interface ValidationRule {
  readonly id: string;
  validate(document: ApiDocument, context: ValidationContext): void;
}

/** Shared, single-pass indexes and diagnostic reporting available to rules. */
export interface ValidationContext {
  readonly requests: readonly RequestNode[];
  readonly headers: readonly HeaderNode[];
  readonly directives: readonly DirectiveNode[];
  readonly variables: readonly VariableNode[];
  readonly nodes: readonly AstNode[];
  report(options: ValidationDiagnosticOptions): void;
  hasDiagnostic(code: string, range?: Range): boolean;
}

/** Input used by a rule to report through the canonical diagnostic model. */
export interface ValidationDiagnosticOptions {
  readonly code: string;
  readonly message: string;
  readonly severity: AstDiagnosticSeverity;
  readonly range: Range;
  readonly relatedInformation?: readonly AstDiagnosticRelatedInformation[];
}
