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
  ScenarioEventEmitter,
  ScenarioStorageService,
  scenariosRootPath,
  buildScenarioFromTemplate,
  listScenarioTemplates,
  StepType,
  type Scenario,
  type RequestStep,
  type ScenarioTemplateId,
  resolveScenarioRequestRef,
  type ScenarioRequestCatalogEntry,
} from '../index';
import { ScenarioEditorPanel } from './scenario-editor-panel';
import { ScenarioRunReportPanel } from './scenario-report-panel';
import {
  ScenarioTreeDataProvider,
  type ScenarioTreeNode,
} from './scenario-tree-provider';
import {
  SCENARIO_LAST_RUNS_STATE_KEY,
  SCENARIO_DIFF_BANNER_DISMISSED_KEY,
  readScenarioLastRuns,
  type ScenarioLastRunStatus,
  type ScenarioLastRunsMap,
} from './scenario-last-runs';
import {
  findUnboundRequestSteps,
  formatUnboundRequestGuidance,
} from './scenario-request-binding';

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
    const filePath = (requestStep.requestFilePath ?? '').trim();
    const requestId = String(requestStep.requestId ?? '');
    // Already bound via Choose Request… — do not re-resolve by display name
    // (ambiguous/renamed catalog entries would undo a successful pick).
    if (filePath.length > 0 && !requestId.startsWith('pending:')) {
      return step;
    }
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

async function promptRunInputs(scenario: Scenario): Promise<Scenario | undefined> {
  const named = scenario.variables.filter((v) => v.name.trim().length > 0);
  if (named.length === 0) {
    return scenario;
  }

  const choice = await window.showQuickPick(
    [
      {
        label: 'Run with defaults',
        description: 'Use scenario variable defaults as authored',
        id: 'defaults' as const,
      },
      {
        label: 'Override run inputs…',
        description: 'Prompt for each scenario variable for this run only',
        id: 'override' as const,
      },
    ],
    {
      placeHolder:
        'Scenario variables — Environment/Auth are inherited from the workspace',
      ignoreFocusOut: true,
    },
  );
  if (choice === undefined) return undefined;
  if (choice.id === 'defaults') return scenario;

  const overrides: Record<string, string> = {};
  for (const variable of named) {
    const value = await window.showInputBox({
      prompt: `Run input: ${variable.name}${variable.sensitive ? ' (sensitive)' : ''}`,
      value: variable.defaultValue ?? '',
      password: variable.sensitive,
      ignoreFocusOut: true,
    });
    if (value === undefined) return undefined;
    overrides[variable.name] = value;
  }

  return {
    ...scenario,
    variables: scenario.variables.map((variable) =>
      Object.prototype.hasOwnProperty.call(overrides, variable.name)
        ? { ...variable, defaultValue: overrides[variable.name] }
        : variable,
    ),
  };
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
  // Assigned after `runScenario` so the panel `run` callback can close over it.
  // eslint-disable-next-line prefer-const -- deferred init; never reassigned
  let editorPanel!: ScenarioEditorPanel;

  const readLastRuns = (): ScenarioLastRunsMap =>
    readScenarioLastRuns(context.workspaceState.get(SCENARIO_LAST_RUNS_STATE_KEY));

  const writeLastRun = async (
    scenarioId: string,
    status: ScenarioLastRunStatus,
  ): Promise<void> => {
    const next = {
      ...readLastRuns(),
      [scenarioId]: { status, at: new Date().toISOString() },
    };
    await context.workspaceState.update(SCENARIO_LAST_RUNS_STATE_KEY, next);
  };

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
    const lastRuns = readLastRuns();
    const loadedNodes: ScenarioTreeNode[] = [];
    for (const filePath of discovered.files) {
      const loaded = await storage.load(filePath);
      if (!loaded.ok) continue;
      const last = lastRuns[loaded.scenario.id];
      loadedNodes.push({
        kind: 'scenario',
        id: loaded.scenario.id,
        name: loaded.scenario.name,
        filePath,
        description: loaded.scenario.description,
        tags: loaded.scenario.metadata.tags,
        lastRunStatus: last?.status,
        lastRunAt: last?.at,
      });
    }
    treeProvider.setScenarios(loadedNodes);
  };

  const runScenario = async (
    scenario: Scenario,
    filePath?: string,
  ): Promise<void> => {
    if (activeAbort !== undefined) {
      void window.showWarningMessage('A scenario run is already in progress.');
      return;
    }

    const catalog = buildRequestCatalog(discovery);
    const resolvedPath = filePath ?? editorPanel.getActiveFilePath();
    // Reveal editor for live highlights / bind guidance without wiping an
    // already-open dirty canvas (full init only when switching documents).
    if (resolvedPath !== undefined) {
      editorPanel.ensureVisible(scenario, resolvedPath, catalog);
    }

    const unbound = findUnboundRequestSteps(scenario, catalog);
    if (unbound.length > 0) {
      // Reveal only — do not forceReload when the same document is open
      // (would wipe unsaved Choose Request… binds).
      if (resolvedPath !== undefined) {
        editorPanel.ensureVisible(scenario, resolvedPath, catalog);
      }
      void window.showErrorMessage(formatUnboundRequestGuidance(unbound));
      return;
    }

    // Acquire the single-flight lock before any await so overlapping Runs
    // cannot both pass the guard and clobber collectionRunContext.
    const controller = new AbortController();
    activeAbort = controller;
    const progressDisposables: Disposable[] = [];

    try {
      const withInputs = await promptRunInputs(scenario);
      if (withInputs === undefined) {
        return;
      }

      let resolved: Scenario;
      try {
        resolved = resolveRequestSteps(withInputs, catalog);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (resolvedPath !== undefined) {
          editorPanel.ensureVisible(withInputs, resolvedPath, catalog, {
            forceReload: true,
          });
        }
        void window.showErrorMessage(
          `${message} Open the Scenario Editor and use Choose Request… on each unbound request step.`,
        );
        return;
      }

      const eventEmitter = new ScenarioEventEmitter();
      const editorOpenForScenario =
        editorPanel.getActiveScenarioId() === scenario.id;

      if (editorOpenForScenario) {
        progressDisposables.push(
          eventEmitter.onStepStarted((event) => {
            void editorPanel.postRunProgress({
              stepId: event.stepId,
              status: 'started',
              attempt: event.attempt,
            });
          }),
          eventEmitter.onStepCompleted((event) => {
            void editorPanel.postRunProgress({
              stepId: event.stepId,
              status: event.status === 'skipped' ? 'skipped' : 'completed',
              attempt: event.attempt,
              durationMs: event.durationMs,
            });
          }),
          eventEmitter.onStepFailed((event) => {
            void editorPanel.postRunProgress({
              stepId: event.stepId,
              status: 'failed',
              attempt: event.attempt,
              durationMs: event.durationMs,
            });
          }),
          eventEmitter.onStepSkipped((event) => {
            void editorPanel.postRunProgress({
              stepId: event.stepId,
              status: 'skipped',
            });
          }),
        );
      }

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
        eventEmitter,
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

      const finishStatus: ScenarioLastRunStatus =
        result.run.status === 'completed'
          ? 'completed'
          : result.run.status === 'cancelled'
            ? 'cancelled'
            : 'failed';
      await writeLastRun(scenario.id, finishStatus);
      if (editorOpenForScenario) {
        await editorPanel.postRunFinished(result.run.status);
      }
      reportPanel.show(result.report);
      if (result.run.status === 'completed') {
        void window.showInformationMessage(
          `Scenario "${scenario.name}" completed.`,
        );
      } else if (result.run.status === 'cancelled') {
        void window.showWarningMessage(
          `Scenario "${scenario.name}" was cancelled.`,
        );
      } else {
        void window.showWarningMessage(
          `Scenario "${scenario.name}" failed.`,
        );
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      logger.error('Scenario run failed', cause);
      await writeLastRun(scenario.id, 'failed');
      if (editorPanel.getActiveScenarioId() === scenario.id) {
        await editorPanel.postRunFinished('failed');
      }
      void window.showErrorMessage(message);
    } finally {
      for (const d of progressDisposables) d.dispose();
      if (activeAbort === controller) {
        activeAbort = undefined;
      }
      await refreshTree();
    }
  };

  editorPanel = new ScenarioEditorPanel({
    save: async (scenario, filePath) => {
      const saved = await storage.save(scenario, filePath);
      if (!saved.ok) {
        throw new Error(saved.error.message);
      }
      await refreshTree();
      void window.showInformationMessage(`Saved scenario "${scenario.name}".`);
    },
    run: async (scenario, filePath) => {
      await runScenario(scenario, filePath);
    },
    openAuth: async () => {
      await commands.executeCommand(COMMAND_IDS.manageAuthProfiles);
    },
    getDiffBannerDismissed: () =>
      context.workspaceState.get<boolean>(SCENARIO_DIFF_BANNER_DISMISSED_KEY) ===
      true,
    setDiffBannerDismissed: async () => {
      await context.workspaceState.update(
        SCENARIO_DIFF_BANNER_DISMISSED_KEY,
        true,
      );
    },
    pickRequest: async () => {
      const catalog = buildRequestCatalog(discovery);
      if (catalog.length === 0) {
        void window.showInformationMessage(
          'No requests in Collections yet. Create requests first — Scenarios call those APIs.',
        );
        return undefined;
      }
      const picked = await window.showQuickPick(
        catalog.map((entry) => ({
          label: entry.name,
          description: entry.folderPath || undefined,
          detail: entry.filePath,
          entry,
        })),
        {
          placeHolder: 'Choose a Collection request for this step',
          matchOnDescription: true,
          matchOnDetail: true,
        },
      );
      if (picked === undefined) return undefined;
      const qualifiedRef =
        picked.entry.folderPath.trim().length > 0
          ? `${picked.entry.folderPath}/${picked.entry.name}`
          : picked.entry.name;
      return {
        requestRef: qualifiedRef,
        requestId: picked.entry.requestId,
        filePath: picked.entry.filePath,
        offset: picked.entry.requestOffset,
      };
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
              description: n.description ?? n.filePath,
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
        editorPanel.show(
          loaded.scenario,
          filePath,
          buildRequestCatalog(discovery),
        );
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
              description: n.description ?? n.filePath,
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
        await runScenario(loaded.scenario, filePath);
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

      const templates = listScenarioTemplates();
      const primary = templates.filter((t) => !t.secondary);
      const secondary = templates.filter((t) => t.secondary);
      const picked = await window.showQuickPick(
        [
          ...primary.map((t) => ({
            label: t.label,
            description: t.description,
            detail: 'Starter template',
            templateId: t.id,
          })),
          ...secondary.map((t) => ({
            label: t.label,
            description: t.description,
            detail: 'Start from an empty entry step',
            templateId: t.id,
          })),
        ],
        {
          placeHolder:
            'Scenarios automate one API workflow — pick a starter or start blank',
          ignoreFocusOut: true,
        },
      );
      if (picked === undefined) return;

      const name = await window.showInputBox({
        prompt: 'Scenario name',
        value: picked.label === 'Start Blank' ? 'New Scenario' : picked.label,
        ignoreFocusOut: true,
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
      const scenario = buildScenarioFromTemplate(
        picked.templateId as ScenarioTemplateId,
        name.trim(),
      );
      const saved = await storage.save(scenario, filePath);
      if (!saved.ok) {
        void window.showErrorMessage(saved.error.message);
        return;
      }
      await refreshTree();
      editorPanel.show(scenario, filePath, buildRequestCatalog(discovery));
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
