import type { VariableDefinition, VariableValue } from '../models';

/**
 * Ephemeral run-scoped variables for a collection/file/selected run.
 * P0: in-memory stub; Collection Runner does not own a store yet (Phase 2).
 */
export interface RunVariableStore {
  set(name: string, value: string, sensitive?: boolean): void;
  get(name: string): VariableValue | undefined;
  /** Definitions suitable for VariableResolutionContext (scope: 'run'). */
  toDefinitions(): readonly VariableDefinition[];
  /** Detached snapshot for debugging / future plan extensions. */
  snapshot(): ReadonlyMap<string, VariableValue>;
  clear(): void;
}

/**
 * Map-backed {@link RunVariableStore}. `set` overwrites; `sensitive` defaults to false.
 */
export class InMemoryRunVariableStore implements RunVariableStore {
  private readonly values = new Map<string, VariableValue>();

  set(name: string, value: string, sensitive = false): void {
    this.values.set(name, {
      name,
      value,
      scope: 'run',
      sensitive,
    });
  }

  get(name: string): VariableValue | undefined {
    return this.values.get(name);
  }

  toDefinitions(): readonly VariableDefinition[] {
    return [...this.values.values()].map((entry) => ({
      name: entry.name,
      value: entry.value,
      scope: 'run',
      sensitive: entry.sensitive,
    }));
  }

  snapshot(): ReadonlyMap<string, VariableValue> {
    return new Map(this.values);
  }

  clear(): void {
    this.values.clear();
  }
}
