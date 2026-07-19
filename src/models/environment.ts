import type { EnvironmentId } from '../types';
import type { VariableDefinition } from './variable';

/** Groups variables under a named execution environment. */
export interface Environment {
  readonly id: EnvironmentId;
  readonly name: string;
  readonly variables: readonly VariableDefinition[];
}
