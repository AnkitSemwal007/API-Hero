import { parseRunRequestCommandArgument } from './run-request-argument';

/** Document surface needed to resolve a Run Request invocation without VS Code. */
export interface RunRequestDocumentView {
  readonly uri: string;
  readonly languageId: string;
  /**
   * Clamps a position into document bounds when the editor would.
   * When omitted, the supplied position is used as-is.
   */
  validatePosition?(position: {
    readonly line: number;
    readonly character: number;
  }): { readonly line: number; readonly character: number };
  /** Converts a line/character position to a UTF-16 document offset. */
  offsetAt(position: {
    readonly line: number;
    readonly character: number;
  }): number;
}

export type ResolveRunRequestInvocationResult =
  | { readonly ok: true; readonly offset: number }
  | { readonly ok: false; readonly errorMessage: string };

export interface ResolveRunRequestInvocationInput {
  /** Raw command argument (CodeLens payload) or `undefined` for caret-based runs. */
  readonly suppliedArgument: unknown;
  readonly activeDocument: RunRequestDocumentView | undefined;
  /** Active caret when no argument is supplied. */
  readonly activeSelection?: {
    readonly line: number;
    readonly character: number;
  };
  readonly apiLanguageId: string;
}

/**
 * Pure decision/prep logic for the Run Request command.
 * Returns either a document offset or a user-facing error message.
 */
export function resolveRunRequestInvocation(
  input: ResolveRunRequestInvocationInput,
): ResolveRunRequestInvocationResult {
  const argument =
    input.suppliedArgument === undefined
      ? undefined
      : parseRunRequestCommandArgument(input.suppliedArgument);
  if (input.suppliedArgument !== undefined && argument === undefined) {
    return {
      ok: false,
      errorMessage: 'API Hero received an invalid request location.',
    };
  }

  const document = input.activeDocument;
  if (document === undefined) {
    return {
      ok: false,
      errorMessage: 'Open an API Hero request file and try again.',
    };
  }
  if (document.languageId !== input.apiLanguageId) {
    return {
      ok: false,
      errorMessage: 'Run Request is available only in API Hero (.api) files.',
    };
  }
  if (argument !== undefined && document.uri !== argument.uri) {
    return {
      ok: false,
      errorMessage:
        'The request location no longer belongs to the active editor.',
    };
  }

  const rawPosition =
    argument === undefined
      ? (input.activeSelection ?? { line: 0, character: 0 })
      : argument.position;
  const position =
    document.validatePosition === undefined
      ? rawPosition
      : document.validatePosition(rawPosition);
  return {
    ok: true,
    offset: document.offsetAt(position),
  };
}
