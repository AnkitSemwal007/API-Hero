/**
 * Editor projection of the GraphQL-over-HTTP JSON envelope.
 * Splits and joins `{ query, variables, operationName }` for the Request Editor.
 * This is not a GraphQL language parser and does not execute requests.
 */

import type { RequestSourceBody } from './models';

/** Starter document shown when switching Protocol to GraphQL on an empty body. */
export const GRAPHQL_STARTER_QUERY = 'query {\n\n}';

export interface GraphqlEditorEnvelope {
  readonly query: string;
  readonly variablesText: string;
  readonly operationName: string;
}

const EMPTY_ENVELOPE: GraphqlEditorEnvelope = {
  query: '',
  variablesText: '{}',
  operationName: '',
};

/** True iff the authored `@protocol` value is GraphQL. */
export function isGraphqlProtocol(protocol: string | undefined): boolean {
  return protocol !== undefined && protocol.trim().toLowerCase() === 'graphql';
}

/**
 * Projects a request body JSON envelope into Query / Variables / Operation name
 * fields. Malformed JSON or a non-envelope object yields an empty query — the
 * raw JSON is never dumped into the query textarea.
 */
export function parseGraphqlEditorEnvelope(
  body: RequestSourceBody | undefined,
): GraphqlEditorEnvelope {
  if (body === undefined) {
    return EMPTY_ENVELOPE;
  }
  if (body.type !== 'json' && body.type !== 'text' && body.type !== 'raw') {
    return EMPTY_ENVELOPE;
  }
  const text = body.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return EMPTY_ENVELOPE;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return EMPTY_ENVELOPE;
  }
  if (!isJsonObject(parsed) || typeof parsed.query !== 'string') {
    return EMPTY_ENVELOPE;
  }

  let variablesText = '{}';
  if (isJsonObject(parsed.variables)) {
    variablesText = JSON.stringify(parsed.variables, null, 2);
  }

  const operationName =
    typeof parsed.operationName === 'string' &&
    parsed.operationName.trim().length > 0
      ? parsed.operationName
      : '';

  return {
    query: parsed.query,
    variablesText,
    operationName,
  };
}

/**
 * Joins Query / Variables / Operation name into a JSON request body.
 * Invalid variables JSON is omitted rather than throwing, so save can keep
 * query and operationName while the user is still editing variables.
 */
export function compileGraphqlEditorEnvelope(
  query: string,
  variablesText: string,
  operationName: string,
): RequestSourceBody {
  const envelope: {
    query: string;
    variables?: { readonly [key: string]: unknown };
    operationName?: string;
  } = { query };

  const trimmedVariables = variablesText.trim();
  if (trimmedVariables.length === 0) {
    envelope.variables = {};
  } else {
    const variables = parseVariablesObject(variablesText);
    if (variables !== undefined) {
      envelope.variables = variables;
    }
  }

  const trimmedOperation = operationName.trim();
  if (trimmedOperation.length > 0) {
    envelope.operationName = trimmedOperation;
  }

  return {
    type: 'json',
    text: JSON.stringify(envelope, null, 2),
  };
}

function parseVariablesObject(
  variablesText: string,
): { readonly [key: string]: unknown } | undefined {
  try {
    const parsed: unknown = JSON.parse(variablesText);
    if (!isJsonObject(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function isJsonObject(
  value: unknown,
): value is { readonly [key: string]: unknown } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
