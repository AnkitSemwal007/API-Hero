import type { SourceRange } from './parser-ast';

/** Severity assigned to a parser or validation diagnostic. */
export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

/** Describes a problem associated with a source range. */
export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly range: SourceRange;
  readonly source?: string;
}
