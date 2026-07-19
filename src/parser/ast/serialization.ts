import type { AstNode } from './models';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

/**
 * Converts an AST subtree to JSON-compatible data.
 *
 * Parent links are non-enumerable and therefore cannot form serialized cycles.
 */
export function astToJsonValue(root: AstNode): JsonValue {
  return JSON.parse(JSON.stringify(root)) as JsonValue;
}

/** Serializes an AST subtree without parent-reference cycles. */
export function serializeAst(root: AstNode, space?: number): string {
  return JSON.stringify(root, undefined, space);
}
