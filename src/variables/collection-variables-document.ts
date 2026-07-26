/**
 * Document shape and parse/serialize helpers for a collection's
 * `api-hero.variables.json` (non-sensitive values; sensitive rows carry an
 * empty value on disk — the real value lives in the `variables.local.json`
 * overlay). Domain-only — no `vscode` imports.
 */

export const COLLECTION_VARIABLES_SCHEMA_VERSION = 1;

export interface CollectionVariablesDocument {
  readonly schemaVersion: number;
  readonly variables: readonly {
    readonly name: string;
    readonly value: string;
    readonly sensitive?: boolean;
  }[];
}

export function emptyCollectionVariablesDocument(): CollectionVariablesDocument {
  return {
    schemaVersion: COLLECTION_VARIABLES_SCHEMA_VERSION,
    variables: [],
  };
}

export function parseCollectionVariablesDocument(
  text: string,
): CollectionVariablesDocument | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const schemaVersion =
    typeof record.schemaVersion === 'number' &&
    Number.isInteger(record.schemaVersion)
      ? record.schemaVersion
      : COLLECTION_VARIABLES_SCHEMA_VERSION;
  return {
    schemaVersion,
    variables: parseVariableList(record.variables),
  };
}

export function serializeCollectionVariablesDocument(
  document: CollectionVariablesDocument,
): string {
  return `${JSON.stringify(
    {
      schemaVersion: document.schemaVersion,
      variables: document.variables.map((variable) => ({
        name: variable.name,
        value: variable.value,
        ...(variable.sensitive === true ? { sensitive: true } : {}),
      })),
    },
    undefined,
    2,
  )}\n`;
}

function parseVariableList(
  value: unknown,
): readonly {
  readonly name: string;
  readonly value: string;
  readonly sensitive?: boolean;
}[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: {
    readonly name: string;
    readonly value: string;
    readonly sensitive?: boolean;
  }[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : '';
    if (name.trim().length === 0) {
      continue;
    }
    result.push({
      name,
      value: typeof record.value === 'string' ? record.value : '',
      ...(record.sensitive === true ? { sensitive: true } : {}),
    });
  }
  return result;
}
