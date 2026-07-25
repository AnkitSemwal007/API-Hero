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

/** Treats empty or whitespace-only ids as unset (no active environment). */
export function normalizeOptionalEnvironmentId(
  id: string | undefined,
): string | undefined {
  if (id === undefined || id.trim().length === 0) {
    return undefined;
  }
  return id;
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
    this.configuredEnvironmentId = normalizeOptionalEnvironmentId(
      this.configuration.activeEnvironmentId,
    );
    this.activeEnvironmentId = this.configuredEnvironmentId;
  }

  public list(): readonly Environment[] {
    return this.configuration.environments;
  }

  public get activeId(): string | undefined {
    return this.activeEnvironmentId;
  }

  public switchActive(id: string | undefined): void {
    const normalized = normalizeOptionalEnvironmentId(id);
    if (normalized !== undefined && !this.configuration.environments.some(
      (environment) => environment.id === normalized,
    )) {
      throw new Error(`Unknown environment "${normalized}".`);
    }
    if (normalized === this.activeEnvironmentId) {
      return;
    }
    this.activeEnvironmentId = normalized;
    this.notify();
  }

  /**
   * Re-reads configuration and emits only when effective variables or the
   * active environment changed. Unrelated settings preserve session selection.
   * Clears a stale session/configured active id that no longer exists.
   */
  public refresh(): void {
    const before = this.capture();
    const next = cloneSnapshot(this.repository.getSnapshot());
    const configured = normalizeOptionalEnvironmentId(next.activeEnvironmentId);
    const configuredExists =
      configured === undefined ||
      next.environments.some((environment) => environment.id === configured);
    const nextConfigured = configuredExists ? configured : undefined;

    if (nextConfigured !== this.configuredEnvironmentId) {
      this.configuredEnvironmentId = nextConfigured;
      this.activeEnvironmentId = nextConfigured;
    }
    this.configuration = next;

    // Drop session selection pointing at a deleted environment.
    if (
      this.activeEnvironmentId !== undefined &&
      !this.configuration.environments.some(
        (environment) => environment.id === this.activeEnvironmentId,
      )
    ) {
      this.activeEnvironmentId = undefined;
    }

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
