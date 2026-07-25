import type { ExtensionContext } from 'vscode';

import type { EnvironmentManager } from '../../variables';
import type { EnvironmentManagerState } from '../../variables/vscode';
import {
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
  const { environmentManager, overlay, runStore } = options;
  void options.context;
  const environmentWriter = new EnvironmentVariableWriter(
    createEnvironmentWritePorts(environmentManager, () =>
      snapshotEnvironmentManagerState(environmentManager),
    ),
  );
  const writer = new CompositeVariableWriter({
    overlay,
    runStore,
    environment: environmentWriter,
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
