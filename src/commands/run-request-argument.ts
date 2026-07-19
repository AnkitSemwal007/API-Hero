/** Stable serializable argument emitted by API request CodeLens entries. */
export interface RunRequestCommandArgument {
  readonly uri: string;
  readonly position: {
    readonly line: number;
    readonly character: number;
  };
}

export function parseRunRequestCommandArgument(
  value: unknown,
): RunRequestCommandArgument | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['uri', 'position'])) {
    return undefined;
  }
  if (
    typeof value.uri !== 'string' ||
    value.uri.length === 0 ||
    !isRecord(value.position) ||
    !hasOnlyKeys(value.position, ['line', 'character'])
  ) {
    return undefined;
  }
  const { line, character } = value.position;
  if (
    !Number.isSafeInteger(line) ||
    !Number.isSafeInteger(character) ||
    (line as number) < 0 ||
    (character as number) < 0
  ) {
    return undefined;
  }
  return {
    uri: value.uri,
    position: {
      line: line as number,
      character: character as number,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
