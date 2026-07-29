import {
  Uri,
  commands,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
} from 'vscode';
import * as path from 'node:path';

import type { CollectionDiscoveryService } from '../../collections';
import { registerCommandWithLegacyAlias } from '../../commands';
import { COMMAND_IDS, VIEW_IDS } from '../../constants';
import type { ExecutionOrchestrator } from '../../orchestration';
import type { Logger } from '../../shared';
import type { VariableDefinition } from '../../models';
import type { VariableResolver, InMemoryRunVariableStore } from '../../variables';
import type { CollectionRunVariableContext } from '../../collection-runner';
import {
  ScenarioEngine,
  ScenarioStorageService,
  scenariosRootPath,
  createScenarioId,
  createStepId,
  ScenarioSchemaVersion,
  StepType,
  type Scenario,
  type RequestStep,
  resolveScenarioRequestRef,
  type ScenarioRequestCatalogEntry,
} from '../index';
import { ScenarioEditorPanel } from './scenario-editor-panel';
import { ScenarioRunReportPanel } from './scenario-report-panel';
import {
  ScenarioTreeDataProvider,
  type ScenarioTreeNode,
} from './scenario-tree-provider';

export interface RegisterScenariosOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
  readonly orchestrator: ExecutionOrchestrator;
  readonly discovery: CollectionDiscoveryService;
  readonly variableResolver: VariableResolver;
  readonly getExternalVariableDefinitions: () => readonly VariableDefinition[];
  readonly collectionRunContext: CollectionRunVariableContext;
}

function buildRequestCatalog(
  discovery: CollectionDiscoveryService,
): readonly ScenarioRequestCatalogEntry[] {
  const snapshot = discovery.snapshot;
  if (snapshot === undefined) return [];
  const entries: ScenarioRequestCatalogEntry[] = [];
  for (const collection of Object.values(snapshot.collections)) {
    const foldersById = collection.folders;
    for (const request of Object.values(collection.requests)) {
      const folderPath =
        request.folderId === undefined
          ? ''
          : (foldersById[request.folderId]?.relativePath ?? '');
      entries.push({
        requestId: request.id,
        name: request.display.label,
        folderPath,
        filePath: request.filePath,
        requestOffset: request.range.start.offset,
      });
    }
  }
  return entries;
}

function resolveRequestSteps(
  scenario: Scenario,
  catalog: readonly ScenarioRequestCatalogEntry[],
): Scenario {
  const steps = scenario.steps.map((step) => {
    if (step.type !== StepType.Request) return step;
    const requestStep = step as RequestStep;
    if (
      requestStep.requestRef === undefined ||
      requestStep.requestRef.trim().length === 0
    ) {
      return step;
    }
    const resolved = resolveScenarioRequestRef(requestStep.requestRef, catalog);
    if (!resolved.ok) {
      throw new Error(resolved.message);
    }
    return {
      ...requestStep,
      requestId: resolved.requestId,
      requestFilePath: resolved.filePath,
      requestOffset: resolved.requestOffset,
    };
  });
  return { ...scenario, steps };
}

function createEmptyScenario(name: string): Scenario {
  const now = new Date().toISOString();
  return {
    id: createScenarioId(),
    schemaVersion: ScenarioSchemaVersion,
    name,
    variables: [],
    steps: [
      {
        id: createStepId(),
        type: StepType.Delay,
        name: 'Start',
        durationMs: 0,
        position: { x: 40, y: 40 },
      },
    ],
    connections: [],
    executionSettings: { failurePolicy: 'stop-on-first-error' },
    metadata: { createdAt: now, updatedAt: now },
  };
}

/** Picks a free `.scenario.json` path, appending -2, -3, … when the slug exists. */
async function allocateUniqueScenarioPath(
  root: string,
  slug: string,
): Promise<string> {
  let candidate = path.join(root, `${slug}.scenario.json`);
  let suffix = 2;
  while (await scenarioFileExists(candidate)) {
    candidate = path.join(root, `${slug}-${suffix}.scenario.json`);
    suffix += 1;
  }
  return candidate;
}

async function scenarioFileExists(filePath: string): Promise<boolean> {
  try {
    await workspace.fs.stat(Uri.file(filePath));
    return true;
  } catch {
    return false;
  }
}

export function registerScenarios(
  options: RegisterScenariosOptions,
): readonly Disposable[] {
  const {
    context,
    logger,
    orchestrator,
    discovery,
    variableResolver,
    getExternalVariableDefinitions,
    collectionRunContext,
  } = options;

  const storage = new ScenarioStorageService();
  const treeProvider = new ScenarioTreeDataProvider();
  const reportPanel = new ScenarioRunReportPanel();
  let activeAbort: AbortController | undefined;

  const refreshTree = async (): Promise<void> => {
    const folder = workspace.workspaceFolders?.[0];
    if (folder === undefined) {
      treeProvider.setScenarios([]);
      return;
    }
    const root = scenariosRootPath(folder.uri.fsPath);
    const discovered = await storage.discover(root);
    if (!discovered.ok) {
      treeProvider.setScenarios([]);
      return;
    }
    const loadedNodes: ScenarioTreeNode[] = [];
    for (const filePath of discovered.files) {
      const loaded = await storage.load(filePath);
      if (!loaded.ok) continue;
      loadedNodes.push({
        kind: 'scenario',
        id: loaded.scenario.id,
        name: loaded.scenario.name,
        filePath,
      });
    }
    treeProvider.setScenarios(loadedNodes);
  };

  const runScenario = async (scenario: Scenario): Promise<void> => {
    if (activeAbort !== undefined) {
      void window.showWarningMessage('A scenario run is already in progress.');
      return;
    }
    const catalog = buildRequestCatalog(discovery);
    let resolved: Scenario;
    try {
      resolved = resolveRequestSteps(scenario, catalog);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      void window.showErrorMessage(message);
      return;
    }

    activeAbort = new AbortController();
    const controller = activeAbort;
    try {
      const engine = new ScenarioEngine({
        executor: orchestrator,
        sourceReader: {
          async readText(filePath: string): Promise<string> {
            const bytes = await workspace.fs.readFile(Uri.file(filePath));
            return Buffer.from(bytes).toString('utf8');
          },
        },
        externalVariableResolver: variableResolver,
        externalVariableDefinitions: getExternalVariableDefinitions(),
        fileExists: async (filePath: string) => {
          try {
            await workspace.fs.stat(Uri.file(filePath));
            return true;
          } catch {
            return false;
          }
        },
        logger: {
          info: (message, ctx) => logger.info(message, ctx),
          warning: (message, ctx) => logger.warning(message, ctx),
          error: (message, cause, ctx) => logger.error(message, cause, ctx),
          debug: (message, ctx) => logger.debug(message, ctx),
        },
        onRunStoreBegin: (runId, store: InMemoryRunVariableStore) => {
          collectionRunContext.begin({
            runId,
            collectionId: `scenario:${scenario.id}`,
            collectionRootPath: scenariosRootPath(
              workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
            ),
            runStore: store,
          });
        },
        onRunStoreEnd: (runId) => {
          collectionRunContext.end(runId);
        },
      });

      const result = await engine.runScenario(resolved, {
        signal: controller.signal,
      });
      reportPanel.show(result.report);
      if (result.run.status === 'completed') {
        void window.showInformationMessage(
          `Scenario "${scenario.name}" completed.`,
        );
      } else {
        void window.showWarningMessage(
          `Scenario "${scenario.name}" finished with status ${result.run.status}.`,
        );
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      logger.error('Scenario run failed', cause);
      void window.showErrorMessage(message);
    } finally {
      if (activeAbort === controller) activeAbort = undefined;
    }
  };

  const editorPanel = new ScenarioEditorPanel({
    save: async (scenario, filePath) => {
      const saved = await storage.save(scenario, filePath);
      if (!saved.ok) {
        throw new Error(saved.error.message);
      }
      await refreshTree();
      void window.showInformationMessage(`Saved scenario "${scenario.name}".`);
    },
    run: async (scenario) => {
      await runScenario(scenario);
    },
  });

  const treeView = window.createTreeView(VIEW_IDS.explorer, {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });

  const disposables: Disposable[] = [
    treeProvider,
    treeView,
    editorPanel,
    reportPanel,
    registerCommandWithLegacyAlias(COMMAND_IDS.refreshScenarios, async () => {
      await refreshTree();
    }),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.openScenarioEditor,
      async (node?: ScenarioTreeNode) => {
        let filePath = node?.filePath;
        if (filePath === undefined) {
          const picked = await window.showQuickPick(
            treeProvider.getChildren().map((n) => ({
              label: n.name,
              description: n.filePath,
              node: n,
            })),
            { placeHolder: 'Select a scenario to open' },
          );
          filePath = picked?.node.filePath;
        }
        if (filePath === undefined) return;
        const loaded = await storage.load(filePath);
        if (!loaded.ok) {
          void window.showErrorMessage(loaded.error.message);
          return;
        }
        editorPanel.show(loaded.scenario, filePath);
      },
    ),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.runScenario,
      async (node?: ScenarioTreeNode) => {
        let filePath = node?.filePath;
        if (filePath === undefined) {
          const picked = await window.showQuickPick(
            treeProvider.getChildren().map((n) => ({
              label: n.name,
              description: n.filePath,
              node: n,
            })),
            { placeHolder: 'Select a scenario to run' },
          );
          filePath = picked?.node.filePath;
        }
        if (filePath === undefined) return;
        const loaded = await storage.load(filePath);
        if (!loaded.ok) {
          void window.showErrorMessage(loaded.error.message);
          return;
        }
        await runScenario(loaded.scenario);
      },
    ),
    registerCommandWithLegacyAlias(COMMAND_IDS.createScenario, async () => {
      const folder = workspace.workspaceFolders?.[0];
      if (folder === undefined) {
        void window.showErrorMessage(
          'Open a workspace folder to create scenarios.',
        );
        return;
      }
      const name = await window.showInputBox({
        prompt: 'Scenario name',
        value: 'New Scenario',
      });
      if (name === undefined || name.trim().length === 0) return;
      const root = scenariosRootPath(folder.uri.fsPath);
      const slug =
        name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, '-')
          .replace(/^-|-$/gu, '') || 'scenario';
      const filePath = await allocateUniqueScenarioPath(root, slug);
      const scenario = createEmptyScenario(name.trim());
      const saved = await storage.save(scenario, filePath);
      if (!saved.ok) {
        void window.showErrorMessage(saved.error.message);
        return;
      }
      await refreshTree();
      editorPanel.show(scenario, filePath);
    }),
    registerCommandWithLegacyAlias(COMMAND_IDS.focusScenarios, async () => {
      const first = treeProvider.getChildren()[0];
      if (first === undefined) {
        await commands.executeCommand(`${VIEW_IDS.explorer}.focus`);
        return;
      }
      await treeView.reveal(first, {
        select: false,
        focus: true,
        expand: true,
      });
    }),
  ];

  context.subscriptions.push(...disposables);
  void refreshTree();

  return disposables;
}
