/**
 * Deterministic variable scopes. Precedence is owned by VariableResolver.
 * Scopes are listed low→high in prose elsewhere; do not rely on union order.
 */
export type VariableScope =
  | 'global'
  | 'workspace'
  | 'collection'
  | 'environment'
  | 'document'
  | 'run';

export type VariableSource = VariableScope;

/** Immutable input definition. Values may reference other variables. */
export interface VariableDefinition {
  readonly name: string;
  readonly value: string;
  readonly scope: VariableScope;
  readonly sensitive: boolean;
}

/** A fully expanded variable value. */
export interface VariableValue {
  readonly name: string;
  readonly value: string;
  readonly scope: VariableScope;
  readonly sensitive: boolean;
}

/** Compatibility shape retained for existing consumers. */
export interface Variable {
  readonly name: string;
  readonly value: string;
  readonly scope: VariableScope;
  readonly secret?: boolean;
  readonly sensitive?: boolean;
  readonly enabled?: boolean;
}
