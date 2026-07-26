import type { ExtensionContext } from 'vscode';

import { collectionIdForRoot } from '../../collections';
import type { CollectionRunVariableContext } from '../../collection-runner';
import type { CollectionVariableStore, EnvironmentManager } from '../../variables';
import type { EnvironmentManagerState } from '../../variables/vscode';
import {
  CollectionVariableWriter,
  CompositeVariableWriter,
  DefaultExtractionEngine,
  EnvironmentVariableWriter,
  InMemoryRuntimeVariableOverlay,
  WorkspaceVariableWriter,
  type RuntimeVariableOverlay,
} from '..';
import type { InMemoryRunVariableStore } from '../../variables';
import { createEnvironmentWritePorts } from './environment-write-adapter';
import { ExtractionObserver } from './extraction-observer';

export interface RegisterExtractionOptions {
  readonly context: ExtensionContext;
  readonly environmentManager: EnvironmentManager;
  readonly overlay: InMemoryRuntimeVariableOverlay;
  readonly runStore: InMemoryRunVariableStore;
  /** Persists `scope=collection` writes (Phase 2). */
  readonly collectionVariableStore: CollectionVariableStore;
  /**
   * Composition-owned holder for the active collection run's store + identity
   * (Phase 2, §3.6). Consulted per write so `run` writes land in the active
   * collection run's store and `collection` writes resolve the right root.
   */
  readonly collectionRunContext: CollectionRunVariableContext;
  /**
   * Called after a successful `scope=collection` persist so the collection
   * variable cache (and active-run snapshot when applicable) pick up the
   * new value — including Create Variable / extract outside a collection run.
   */
  readonly onCollectionVariablePersisted?: (persisted: {
    readonly rootPath: string;
    readonly collectionId: string;
  }) => Promise<void>;
  /**
   * Resolves the owning collection root for a single-request source path so
   * `@extract scope=collection` works outside an active collection run.
   */
  readonly resolveCollectionRootPathForSource?: (
    sourceId: string,
  ) => string | undefined;
}

export interface RegisterExtractionResult {
  readonly observer: ExtractionObserver;
  readonly overlay: RuntimeVariableOverlay;
  readonly runStore: InMemoryRunVariableStore;
  readonly writer: CompositeVariableWriter;
}

/**
 * Composes extraction engine, writers, and VS Code observer. Call from
 * `extension.ts` only (mirrors `registerAssertions`).
 */
export function registerExtraction(
  options: RegisterExtractionOptions,
): RegisterExtractionResult {
  const {
    environmentManager,
    overlay,
    runStore,
    collectionVariableStore,
    collectionRunContext,
    onCollectionVariablePersisted,
    resolveCollectionRootPathForSource,
  } = options;
  void options.context;
  const environmentPorts = createEnvironmentWritePorts(
    environmentManager,
    () => snapshotEnvironmentManagerState(environmentManager),
  );
  const environmentWriter = new EnvironmentVariableWriter(environmentPorts);
  const workspaceWriter = new WorkspaceVariableWriter(environmentPorts);
  const storeWithRefresh: CollectionVariableStore = {
    load: (rootPath, collectionId) =>
      collectionVariableStore.load(rootPath, collectionId),
    refresh: (rootPath, collectionId) =>
      collectionVariableStore.refresh(rootPath, collectionId),
    upsert: async (rootPath, collectionId, variable) => {
      await collectionVariableStore.upsert(rootPath, collectionId, variable);
      if (onCollectionVariablePersisted !== undefined) {
        await onCollectionVariablePersisted({ rootPath, collectionId });
      }
    },
  };
  const collectionWriter = new CollectionVariableWriter({
    store: storeWithRefresh,
    getCollectionRootPath: () => collectionRunContext.getCollectionRootPath(),
    getCollectionId: () => collectionRunContext.getCollectionId(),
    ...(resolveCollectionRootPathForSource === undefined
      ? {}
      : { resolveCollectionRootPathForSource }),
    collectionIdForRoot,
  });
  const writer = new CompositeVariableWriter({
    overlay,
    runStore,
    environment: environmentWriter,
    collection: collectionWriter,
    workspace: workspaceWriter,
    resolveRunStore: () => collectionRunContext.getRunStore(),
  });
  const engine = new DefaultExtractionEngine();
  const observer = new ExtractionObserver(
    engine,
    writer,
    () => environmentManager.activeId,
  );
  return { observer, overlay, runStore, writer };
}

function snapshotEnvironmentManagerState(
  manager: EnvironmentManager,
): EnvironmentManagerState {
  const capture = manager.capture();
  return {
    environments: manager.list().map((environment) => ({
      id: environment.id,
      name: environment.name,
      variables: environment.variables.map((variable) => ({
        name: variable.name,
        value: variable.value,
        sensitive: variable.sensitive,
      })),
    })),
    globalVariables: capture.globalVariables.map((variable) => ({
      name: variable.name,
      value: variable.value,
      sensitive: variable.sensitive,
    })),
    workspaceVariables: capture.workspaceVariables.map((variable) => ({
      name: variable.name,
      value: variable.value,
      sensitive: variable.sensitive,
    })),
    ...(manager.activeId === undefined
      ? {}
      : { activeEnvironmentId: manager.activeId }),
  };
}
