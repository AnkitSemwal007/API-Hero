import type { AuthenticationProfile } from '../models';

/** Severity for import diagnostics (never throws for recoverable issues). */
export type ImportDiagnosticSeverity = 'error' | 'warning' | 'info';

/** Structured, secret-masked diagnostic from any import pipeline stage. */
export interface ImportDiagnostic {
  readonly code: string;
  readonly severity: ImportDiagnosticSeverity;
  readonly message: string;
  /** JSON Pointer–like path into the specification when known. */
  readonly path?: string;
}

/** A generated `.api` file relative to the import target root. */
export interface GeneratedApiFile {
  /** Path relative to the import output directory (POSIX separators). */
  readonly relativePath: string;
  readonly content: string;
}

/** Environment patch produced by the environment generator. */
export interface GeneratedEnvironment {
  readonly id: string;
  readonly name: string;
  readonly variables: readonly GeneratedVariable[];
  /** When true, the writer should set this environment as active. */
  readonly activate: boolean;
}

export interface GeneratedVariable {
  readonly name: string;
  readonly value: string;
  readonly sensitive: boolean;
}

/**
 * Auth profile metadata for settings. Secrets use `{ kind: 'secret' }` only —
 * never literal credential values from the specification.
 */
export interface GeneratedAuthProfile {
  readonly profile: AuthenticationProfile;
  /** Human-readable hints for SecretStorage keys the user must populate. */
  readonly secretHints: readonly string[];
  /** Extra notes (e.g. OAuth2 flows are metadata-only). */
  readonly notes?: string;
}

/** Domain artifacts produced before workspace writing. */
export interface ImportArtifacts {
  readonly apiName: string;
  readonly apiVersion: string;
  readonly openapiVersion: string;
  /** Suggested subdirectory under the workspace folder (e.g. `imported/petstore`). */
  readonly outputDirectoryName: string;
  readonly files: readonly GeneratedApiFile[];
  readonly environments: readonly GeneratedEnvironment[];
  readonly authProfiles: readonly GeneratedAuthProfile[];
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly folderCount: number;
  readonly requestCount: number;
}

/** Final summary shown in the UI after write + settings apply. */
export interface ImportSummary {
  readonly apiName: string;
  readonly apiVersion: string;
  readonly openapiVersion: string;
  readonly targetDirectory: string;
  readonly folderCount: number;
  readonly requestCount: number;
  readonly variableCount: number;
  readonly authProfileCount: number;
  readonly environmentCount: number;
  readonly writtenFiles: readonly string[];
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly cancelled: boolean;
  readonly success: boolean;
}

/** Cancellation token without depending on VS Code. */
export interface ImportCancellation {
  readonly isCancellationRequested: boolean;
}

/** Progress phases reported to the UI adapter. */
export type ImportProgressPhase =
  | 'loading'
  | 'parsing'
  | 'validating'
  | 'resolving'
  | 'generating'
  | 'writing'
  | 'refreshing'
  | 'completed';

export interface ImportProgressEvent {
  readonly phase: ImportProgressPhase;
  readonly message: string;
}

/** Caps that protect against pathological specs. */
export interface ImportLimits {
  /** Maximum specification source size in bytes. */
  readonly maxFileBytes: number;
  /** Maximum `$ref` chase depth before failing with a diagnostic. */
  readonly maxRefDepth: number;
  /** Maximum schema sample recursion depth. */
  readonly maxSchemaDepth: number;
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxFileBytes: 5 * 1024 * 1024,
  maxRefDepth: 64,
  maxSchemaDepth: 32,
};
