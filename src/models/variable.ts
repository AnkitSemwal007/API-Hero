/** Deterministic variable scopes, ordered from lowest to highest precedence. */
export type VariableScope = 'global' | 'workspace' | 'environment' | 'document';

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
