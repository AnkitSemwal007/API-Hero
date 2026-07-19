import type { HistoryEntry, HistorySourceLocation } from './models';

/**
 * Serializable argument compatible with `apiRunner.runRequest`.
 * Pure domain type — no VS Code imports.
 */
export interface HistoryRerunArgument {
  readonly uri: string;
  readonly position: {
    readonly line: number;
    readonly character: number;
  };
}

/**
 * Resolves a re-run argument from a history entry's stored source location.
 * Returns undefined when the entry lacks a usable file location.
 */
export function resolveHistoryRerunArgument(
  entry: HistoryEntry,
): HistoryRerunArgument | undefined {
  return resolveRerunFromSource(entry.metadata.source);
}

/** Resolves a re-run argument from an explicit source location. */
export function resolveRerunFromSource(
  source: HistorySourceLocation | undefined,
): HistoryRerunArgument | undefined {
  if (source === undefined || source.uri.trim().length === 0) {
    return undefined;
  }
  if (
    typeof source.line === 'number' &&
    Number.isSafeInteger(source.line) &&
    source.line >= 0 &&
    typeof source.character === 'number' &&
    Number.isSafeInteger(source.character) &&
    source.character >= 0
  ) {
    return Object.freeze({
      uri: source.uri,
      position: Object.freeze({
        line: source.line,
        character: source.character,
      }),
    });
  }
  return undefined;
}

/**
 * Builds a source location snapshot from orchestration inputs.
 * `character` mirrors VS Code / Run Request argument naming (parser `column`).
 */
export function buildHistorySourceLocation(input: {
  readonly uri: string;
  readonly offset?: number;
  readonly line?: number;
  readonly character?: number;
  readonly requestId?: string;
}): HistorySourceLocation {
  const location: {
    -readonly [K in keyof HistorySourceLocation]?: HistorySourceLocation[K];
  } = {
    uri: input.uri,
  };
  if (input.offset !== undefined) {
    location.offset = input.offset;
  }
  if (input.line !== undefined) {
    location.line = input.line;
  }
  if (input.character !== undefined) {
    location.character = input.character;
  }
  if (input.requestId !== undefined) {
    location.requestId = input.requestId;
  }
  return Object.freeze(location) as HistorySourceLocation;
}
