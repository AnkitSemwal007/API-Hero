import type { ExtensionContext } from 'vscode';

import type { CollectionRunVariableContext } from '../../collection-runner';
import type { CollectionVariableStore, EnvironmentManager } from '../../variables';
import type { EnvironmentManagerState } from '../../variables/vscode';
import {
  CollectionVariableWriter,
  CompositeVariableWriter,
  DefaultExtractionEngine,
  EnvironmentVariableWriter,
  InMemoryRuntimeVariableOverlay,
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
   * Called after a successful `scope=collection` persist so the active-run
   * resolver snapshot can pick up mid-run collection extracts (§9.3).
   */
  readonly onCollectionVariablePersisted?: () => Promise<void>;
}

export interface RegisterExtractionResult {
  readonly observer: ExtractionObserver;
  readonly overlay: RuntimeVariableOverlay;
  readonly runStore: InMemoryRunVariableStore;
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
  } = options;
  void options.context;
  const environmentWriter = new EnvironmentVariableWriter(
    createEnvironmentWritePorts(environmentManager, () =>
      snapshotEnvironmentManagerState(environmentManager),
    ),
  );
  const storeWithRefresh: CollectionVariableStore = {
    load: (rootPath, collectionId) =>
      collectionVariableStore.load(rootPath, collectionId),
    refresh: (rootPath, collectionId) =>
      collectionVariableStore.refresh(rootPath, collectionId),
    upsert: async (rootPath, collectionId, variable) => {
      await collectionVariableStore.upsert(rootPath, collectionId, variable);
      if (onCollectionVariablePersisted !== undefined) {
        await onCollectionVariablePersisted();
      }
    },
  };
  const collectionWriter = new CollectionVariableWriter({
    store: storeWithRefresh,
    getCollectionRootPath: () => collectionRunContext.getCollectionRootPath(),
    getCollectionId: () => collectionRunContext.getCollectionId(),
  });
  const writer = new CompositeVariableWriter({
    overlay,
    runStore,
    environment: environmentWriter,
    collection: collectionWriter,
    resolveRunStore: () => collectionRunContext.getRunStore(),
  });
  const engine = new DefaultExtractionEngine();
  const observer = new ExtractionObserver(
    engine,
    writer,
    () => environmentManager.activeId,
  );
  return { observer, overlay, runStore };
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
