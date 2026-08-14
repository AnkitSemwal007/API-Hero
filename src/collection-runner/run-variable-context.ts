/**
 * Process-wide holder for the active collection run's `RunVariableStore` and
 * collection identity, swapped for the duration of one
 * `CollectionRunnerService.execute` call (§3.6, §5.5).
 *
 * Single-request runs leave this inactive and use the session `RunVariableStore`
 * owned by `extension.ts`. Framework-free — no `vscode` imports.
 */

import type { RunVariableStore } from '../variables';

export type CollectionRunAuthenticationPreference =
  | 'collection-default'
  | 'resolved';

export interface CollectionRunEnvironmentOverride {
  /** Omitted/undefined = no environment for this run. */
  readonly environmentId?: string;
}

export interface CollectionRunVariableContextBeginOptions {
  readonly runId: string;
  readonly collectionId: string;
  readonly collectionRootPath: string;
  readonly runStore: RunVariableStore;
  /**
   * When present, collection-run variable/auth resolution uses this override
   * instead of the session active environment.
   */
  readonly environmentOverride?: CollectionRunEnvironmentOverride;
  /**
   * When `'resolved'`, skip collection default auth and use session/workspace
   * default. Default: `'collection-default'`.
   */
  readonly authenticationPreference?: CollectionRunAuthenticationPreference;
}

export interface CollectionRunVariableContext {
  /** Activates the context for `options.runId`. Overwrites any prior state. */
  begin(options: CollectionRunVariableContextBeginOptions): void;
  /** Deactivates the context, but only if it is still owned by `runId`. */
  end(runId: string): void;
  isActive(): boolean;
  getRunStore(): RunVariableStore | undefined;
  getCollectionId(): string | undefined;
  getCollectionRootPath(): string | undefined;
  /**
   * `undefined` when no override was supplied (use the session active
   * environment). Present with no `environmentId` means explicit No Environment.
   */
  getEnvironmentOverride(): CollectionRunEnvironmentOverride | undefined;
  getAuthenticationPreference():
    | CollectionRunAuthenticationPreference
    | undefined;
}

/** Creates an inactive {@link CollectionRunVariableContext}. */
export function createCollectionRunVariableContext(): CollectionRunVariableContext {
  let active:
    | {
        readonly runId: string;
        readonly collectionId: string;
        readonly collectionRootPath: string;
        readonly runStore: RunVariableStore;
        readonly environmentOverride?: CollectionRunEnvironmentOverride;
        readonly authenticationPreference?: CollectionRunAuthenticationPreference;
      }
    | undefined;

  return {
    begin(options: CollectionRunVariableContextBeginOptions): void {
      active = { ...options };
    },
    end(runId: string): void {
      if (active?.runId === runId) {
        active = undefined;
      }
    },
    isActive(): boolean {
      return active !== undefined;
    },
    getRunStore(): RunVariableStore | undefined {
      return active?.runStore;
    },
    getCollectionId(): string | undefined {
      return active?.collectionId;
    },
    getCollectionRootPath(): string | undefined {
      return active?.collectionRootPath;
    },
    getEnvironmentOverride(): CollectionRunEnvironmentOverride | undefined {
      return active?.environmentOverride;
    },
    getAuthenticationPreference():
      | CollectionRunAuthenticationPreference
      | undefined {
      return active?.authenticationPreference;
    },
  };
}
