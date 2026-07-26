import type { VariableScope } from '../models';

/** Scopes VariableWriter may target. Global is forbidden (ADR). */
export type VariableWriteTargetScope = Exclude<VariableScope, 'global'>;

export interface VariableWriteRequest {
  readonly name: string;
  readonly value: string;
  readonly scope: VariableWriteTargetScope;
  readonly sensitive: boolean;
  /** Required for document-scope overlay writes (request identity). */
  readonly requestKey?: string;
}

export type VariableWriteResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | 'UNSUPPORTED_SCOPE'
        | 'INVALID_NAME'
        | 'NOT_IMPLEMENTED'
        | 'NO_ACTIVE_ENVIRONMENT'
        | 'PERSIST_FAILED';
      readonly message: string;
    };

export interface RuntimeOverlayIdentity {
  /** Stable request identity, e.g. request:<path>#<index> or sourceId+index. */
  readonly requestKey: string;
}

export type ExtractionSourceKind = 'json-path' | 'header' | 'status';

export type ExtractionSource =
  | { readonly kind: 'json-path'; readonly path: string }
  | { readonly kind: 'header'; readonly name: string }
  | { readonly kind: 'status' };

export type ExtractionWhen =
  | { readonly kind: 'always' }
  | { readonly kind: 'status'; readonly spec: string }
  | { readonly kind: 'assertions-pass' }
  | { readonly kind: 'content-type'; readonly mime: string };

export interface ExtractionRule {
  readonly id: string;
  readonly variableName: string;
  readonly source: ExtractionSource;
  readonly targetScope: VariableWriteTargetScope;
  readonly sensitive: boolean;
  readonly required: boolean;
  readonly enabled: boolean;
  readonly when: ExtractionWhen;
  /** Original directive text for diagnostics / report. */
  readonly sourceText?: string;
}

export type ExtractionOutcomeKind =
  | 'extracted'
  | 'skipped'
  | 'failed'
  | 'malformed';

export interface ExtractionOutcome {
  readonly rule: ExtractionRule;
  readonly kind: ExtractionOutcomeKind;
  /** Masked for UI when sensitive; never log raw secrets. */
  readonly maskedValue?: string;
  readonly reason?: string;
  readonly writeOk?: boolean;
}

export interface ExtractionReport {
  readonly outcomes: readonly ExtractionOutcome[];
  readonly extractedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly malformedCount: number;
}

/** Minimal assertion summary extraction needs — avoids importing assertions (cycle). */
export interface ExtractionAssertionSummary {
  readonly failed: number;
  readonly malformed: number;
}

export interface ExtractionAssertionReport {
  readonly summary: ExtractionAssertionSummary;
}

export interface ExtractionContext {
  readonly result: import('../execution').ExecutionResult;
  readonly assertionReport?: ExtractionAssertionReport;
  readonly requestKey: string;
  readonly activeEnvironmentId?: string;
}

/** Port for persisting extracted values. Implementations live in writer modules. */
export interface VariableWriter {
  write(request: VariableWriteRequest): Promise<VariableWriteResult>;
}

export interface ExtractionEngine {
  apply(
    rules: readonly ExtractionRule[],
    context: ExtractionContext,
    writer: VariableWriter,
  ): Promise<ExtractionReport>;
}

export interface ResponseExtractor {
  readonly kind: ExtractionSourceKind;
  extract(
    source: ExtractionSource,
    context: ExtractionContext,
  ):
    | { readonly found: true; readonly value: unknown }
    | { readonly found: false; readonly reason: string };
}

export interface ExtractorRegistry {
  get(kind: ExtractionSourceKind): ResponseExtractor | undefined;
}
