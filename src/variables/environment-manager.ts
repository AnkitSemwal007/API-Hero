import type { Environment, VariableDefinition } from '../models';
import { deepFreeze } from '../shared';

export interface EnvironmentSnapshot {
  readonly active?: Environment;
  readonly globalVariables: readonly VariableDefinition[];
  readonly workspaceVariables: readonly VariableDefinition[];
}

export interface VariableConfigurationSnapshot {
  readonly environments: readonly Environment[];
  readonly activeEnvironmentId?: string;
  readonly globalVariables: readonly VariableDefinition[];
  readonly workspaceVariables: readonly VariableDefinition[];
}

export interface VariableConfigurationRepository {
  getSnapshot(): VariableConfigurationSnapshot;
}

export interface EnvironmentChangeDisposable {
  dispose(): void;
}

/**
 * Owns explicit environment selection. Each capture is deeply detached and
 * frozen, so an in-flight request cannot observe a later switch.
 */
export class EnvironmentManager {
  private activeEnvironmentId: string | undefined;
  private configuredEnvironmentId: string | undefined;
  private configuration: VariableConfigurationSnapshot;
  private readonly listeners = new Set<() => void>();

  public constructor(private readonly repository: VariableConfigurationRepository) {
    this.configuration = cloneSnapshot(repository.getSnapshot());
    this.configuredEnvironmentId = this.configuration.activeEnvironmentId;
    this.activeEnvironmentId = this.configuredEnvironmentId;
  }

  public list(): readonly Environment[] {
    return this.configuration.environments;
  }

  public get activeId(): string | undefined {
    return this.activeEnvironmentId;
  }

  public switchActive(id: string | undefined): void {
    if (id !== undefined && !this.configuration.environments.some(
      (environment) => environment.id === id,
    )) {
      throw new Error(`Unknown environment "${id}".`);
    }
    if (id === this.activeEnvironmentId) {
      return;
    }
    this.activeEnvironmentId = id;
    this.notify();
  }

  /**
   * Re-reads configuration and emits only when effective variables or the
   * active environment changed. Unrelated settings preserve session selection.
   */
  public refresh(): void {
    const before = this.capture();
    const next = cloneSnapshot(this.repository.getSnapshot());
    const configured = next.activeEnvironmentId;
    if (configured !== this.configuredEnvironmentId) {
      this.configuredEnvironmentId = configured;
      this.activeEnvironmentId = configured;
    }
    this.configuration = next;
    const after = this.capture();
    if (!environmentSnapshotsEqual(before, after)) {
      this.notify();
    }
  }

  public capture(): EnvironmentSnapshot {
    const active = this.configuration.environments.find(
      (environment) => environment.id === this.activeEnvironmentId,
    );
    return deepFreeze({
      ...(active === undefined ? {} : { active }),
      globalVariables: this.configuration.globalVariables,
      workspaceVariables: this.configuration.workspaceVariables,
    });
  }

  public onDidChange(listener: () => void): EnvironmentChangeDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function cloneSnapshot(snapshot: VariableConfigurationSnapshot): VariableConfigurationSnapshot {
  return deepFreeze(structuredClone(snapshot));
}

function environmentSnapshotsEqual(
  left: EnvironmentSnapshot,
  right: EnvironmentSnapshot,
): boolean {
  return environmentsEqual(left.active, right.active) &&
    definitionsEqual(left.globalVariables, right.globalVariables) &&
    definitionsEqual(left.workspaceVariables, right.workspaceVariables);
}

function environmentsEqual(
  left: Environment | undefined,
  right: Environment | undefined,
): boolean {
  return left?.id === right?.id &&
    left?.name === right?.name &&
    definitionsEqual(left?.variables ?? [], right?.variables ?? []);
}

function definitionsEqual(
  left: readonly VariableDefinition[],
  right: readonly VariableDefinition[],
): boolean {
  return left.length === right.length && left.every((definition, index) => {
    const other = right[index];
    return other !== undefined &&
      definition.name === other.name &&
      definition.value === other.value &&
      definition.scope === other.scope &&
      definition.sensitive === other.sensitive;
  });
}
