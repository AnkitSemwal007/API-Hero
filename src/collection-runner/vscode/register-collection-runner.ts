import {
  Position,
  Uri,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
  type TextDocument,
  type TreeView,
} from 'vscode';

import { registerCommandWithLegacyAlias } from '../../commands';
import { parseRunRequestCommandArgument } from '../../commands/run-request-argument';

import {
  parseApiFileRequests,
  type CollectionDiscoveryService,
  type CollectionTreeNode,
} from '../../collections';
import {
  COMMAND_IDS,
  CONFIGURATION_KEYS,
  CONFIGURATION_SECTION,
  DEFAULT_CONFIGURATION,
} from '../../constants';
import {
  analyzeRunPlanDependencies,
  enrichRunPlanWithDependencies,
} from '../../dependencies';
import type { VariableDefinition } from '../../models';
import type { ExecutionOrchestrator } from '../../orchestration';
import { sanitizeHoverLabel, type Logger } from '../../shared';
import { InMemoryRunVariableStore, type CollectionVariableStore, type EnvironmentManager } from '../../variables';
import {
  CollectionRunnerService,
  CollectionRunAlreadyActiveError,
  FailurePolicyKinds,
  type CollectionRunExecuteConfig,
  type CollectionRunFailurePolicyChoice,
  type CollectionRunManager,
  buildRunPlan,
  normalizeCollectionRunOptions,
  type CollectionRunVariableContext,
  type CollectionRetryBackoff,
  type DependenciesExtension,
  type RunPlanTarget,
  type RunSummary,
  COLLECTION_RETRY_DEFAULT_BACKOFF,
  COLLECTION_RETRY_DEFAULT_DELAY_MS,
  COLLECTION_RETRY_DEFAULT_MAX_RETRIES,
  COLLECTION_RETRY_MAX_DELAY_MS_CAP,
  COLLECTION_RETRY_MAX_RETRIES_CAP,
} from '../index';
import {
  CollectionRunSetupPanel,
  type CollectionRunSetupAuthSnapshot,
} from './collection-run-setup-panel';
import {
  CollectionRunStatusBar,
  MultiplexCollectionRunProgress,
  RunScopedCollectionRunProgress,
  VsCodeCollectionRunProgress,
  VsCodeCollectionRunSourceReader,
  formatRunSummaryMessage,
  formatUnexpectedFailMessage,
  withCollectionRunProgress,
} from './progress-ui';
import { normalizeFailurePolicySetting } from './run-report-html';
import type { CollectionRunReportPanel } from './run-report-panel';

export interface RegisterCollectionRunnerOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
  readonly orchestrator: ExecutionOrchestrator;
  readonly collectionsTreeView: TreeView<CollectionTreeNode>;
  readonly collectionRunManager: CollectionRunManager;
  readonly reportPanel: CollectionRunReportPanel;
  readonly setRequestStatusSuppressed?: (suppressed: boolean) => void;
  readonly collectionRunContext: CollectionRunVariableContext;
  readonly collectionVariableStore: CollectionVariableStore;
  readonly setActiveCollectionVariables: (
    variables: readonly VariableDefinition[],
  ) => void;
  readonly getStaticVariableNames: () => ReadonlySet<string>;
  readonly environmentManager: EnvironmentManager;
  readonly getAuthenticationSnapshot?: () => CollectionRunSetupAuthSnapshot;
  readonly onAuthenticationChanged?: (listener: () => void) => Disposable;
  /** Optional response viewer for Compare / Generate TypeScript. */
  readonly responseViewer?: {
    compareWithPrevious(): unknown;
    canCompareWithPrevious(): boolean;
    canGenerateTypeScript(): boolean;
    generateTypeScript(
      rootName?: string,
      options?: {
        readonly attribution?: {
          readonly requestName?: string;
          readonly requestPath?: string;
        };
      },
    ): Promise<string | undefined>;
    lastExecutionSourceId?(): string | undefined;
    lastExecutionOffset?(): number | undefined;
    showDiff(
      left: import('../../response/presentation').ResponsePresentation,
      right: import('../../response/presentation').ResponsePresentation,
      labels?: { readonly leftLabel?: string; readonly rightLabel?: string },
    ): unknown;
  };
}

export function registerCollectionRunner(
  options: RegisterCollectionRunnerOptions,
): readonly Disposable[] {
  const {
    discovery,
    orchestrator,
    collectionsTreeView,
    logger,
    context,
    collectionRunManager: manager,
    reportPanel,
    setRequestStatusSuppressed,
    collectionRunContext,
    collectionVariableStore,
    setActiveCollectionVariables,
    getStaticVariableNames,
    responseViewer,
    environmentManager,
    getAuthenticationSnapshot,
    onAuthenticationChanged,
  } = options;

  const statusBar = new CollectionRunStatusBar(manager, setRequestStatusSuppressed);
  const sourceReader = new VsCodeCollectionRunSourceReader();
  const multiplex = new MultiplexCollectionRunProgress([manager]);
  const runner = new CollectionRunnerService({
    executor: orchestrator,
    sourceReader,
    progress: multiplex,
  });

  const liveReportSubscription = manager.onDidChange(() => {
    for (const session of [...manager.listActive(), ...manager.listRecent()]) {
      if (reportPanel.isShowing(session.runId)) {
        reportPanel.updateLive(session);
      }
    }
  });

  const activeRunWarning =
    'A collection run is already in progress. Cancel it from the Execution view or the progress notification first.';

  const rejectIfRunActive = async (): Promise<boolean> => {
    if (manager.activeCount <= 0) {
      return false;
    }
    await window.showWarningMessage(activeRunWarning);
    return true;
  };

  const executeConfiguredCollectionRun = async (
    config: CollectionRunExecuteConfig,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> => {
    if (await rejectIfRunActive()) {
      return {
        ok: false,
        message:
          'A collection run is already in progress. Cancel it from the Execution view or the progress notification first.',
      };
    }

    const defaults = readCollectionRunOptionDefaults();
    const runOptions = normalizeCollectionRunOptions({
      retry: {
        enabled: defaults.retryEnabled,
        maxRetries: defaults.maxRetries,
        delayMs: defaults.delayMs,
        backoff: defaults.backoff,
      },
      skipDestructiveRequests: defaults.skipDestructiveRequests,
    });

    const aggregate = await discovery.refresh();
    let plan;
    try {
      plan = buildRunPlan({
        aggregate,
        target: config.target,
        failurePolicy: config.failurePolicy,
        runOptions,
      });
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Unable to build a collection run plan.',
      };
    }

    if (plan.requests.length === 0) {
      return { ok: false, message: 'No requests found for this collection run.' };
    }

    const collectionRootPath = aggregate.collections[plan.collectionId]?.rootPath;
    if (collectionRootPath === undefined) {
      return {
        ok: false,
        message: 'API Hero: The collection for this run is no longer available.',
      };
    }

    const analyses = await analyzeRunPlanDependencies(plan, {
      readText: (filePath) => sourceReader.readText(filePath),
    });
    const enrichment = enrichRunPlanWithDependencies({ membershipPlan: plan, analyses });
    if (!enrichment.ok) {
      return { ok: false, message: `API Hero: ${enrichment.message}` };
    }
    const enrichedPlan = enrichment.plan;
    if (await rejectIfRunActive()) {
      return {
        ok: false,
        message:
          'A collection run is already in progress. Cancel it from the Execution view or the progress notification first.',
      };
    }
    let session;
    try {
      session = manager.begin({ plan: enrichedPlan });
    } catch (error) {
      if (error instanceof CollectionRunAlreadyActiveError) {
        await window.showWarningMessage(activeRunWarning);
        return { ok: false, message: activeRunWarning };
      }
      throw error;
    }

    const configuredEnvironmentName = environmentNameForOverride(
      environmentManager,
      config.environmentOverride,
    );
    reportPanel.showLive(session.snapshot, {
      ...(configuredEnvironmentName === undefined
        ? {}
        : { environmentName: configuredEnvironmentName }),
    });

    const progressTitle =
      config.target.mode === 'selected-requests'
        ? 'API Hero: Run Selected Requests'
        : 'API Hero: Collection Run';
    void continueConfiguredCollectionRun({
      enrichedPlan,
      session,
      collectionRootPath,
      progressTitle,
      config,
      configuredEnvironmentName,
    });
    return { ok: true };
  };

  const continueConfiguredCollectionRun = async (args: {
    readonly enrichedPlan: ReturnType<typeof buildRunPlan>;
    readonly session: ReturnType<CollectionRunManager['begin']>;
    readonly collectionRootPath: string;
    readonly progressTitle: string;
    readonly config: CollectionRunExecuteConfig;
    readonly configuredEnvironmentName: string | undefined;
  }): Promise<void> => {
    const {
      enrichedPlan,
      session,
      collectionRootPath,
      progressTitle,
      config,
      configuredEnvironmentName,
    } = args;
    const progressUi = new VsCodeCollectionRunProgress();
    const scoped = new RunScopedCollectionRunProgress(enrichedPlan.runId, progressUi);
    multiplex.add(scoped);

    const runVariableStore = new InMemoryRunVariableStore();
    let collectionVariables: readonly VariableDefinition[];
    try {
      collectionVariables = await collectionVariableStore.load(
        collectionRootPath,
        enrichedPlan.collectionId,
      );
    } catch (error) {
      logger.warning('Failed to load collection variables for run', {
        message: error instanceof Error ? error.message : String(error),
      });
      collectionVariables = [];
    }
    setActiveCollectionVariables(collectionVariables);
    collectionRunContext.begin({
      runId: enrichedPlan.runId,
      collectionId: enrichedPlan.collectionId,
      collectionRootPath,
      runStore: runVariableStore,
      environmentOverride: config.environmentOverride,
      authenticationPreference: config.authenticationPreference,
    });
    try {
      const summary = await withCollectionRunProgress(
        progressTitle,
        progressUi,
        async () =>
          runner.execute({
            plan: enrichedPlan,
            signal: session.signal,
            historyCaptureContext: {
              environmentName: configuredEnvironmentName,
              collectionName: enrichedPlan.collectionName,
            },
            runVariableStore,
            staticVariableNames: getStaticVariableNames,
          }),
        session.abortController,
      );
      manager.complete(summary);
      await presentSummary(summary, reportPanel, configuredEnvironmentName);
      const reorderedCount = countReorderedRequests(enrichedPlan.extensions?.dependencies);
      if (reorderedCount > 0) {
        void window.showInformationMessage(`Reordered ${reorderedCount} requests for dependencies`);
      }
      logger.info('Collection run finished', {
        runId: summary.runId,
        status: summary.status,
        passed: summary.statistics.passed,
        failed: summary.statistics.failed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warning('Collection run failed unexpectedly', { message });
      manager.fail(enrichedPlan.runId, message);
      await window.showErrorMessage(
        formatUnexpectedFailMessage(manager.get(enrichedPlan.runId), message),
      );
    } finally {
      multiplex.remove(scoped);
      progressUi.dispose();
      runVariableStore.clear();
      collectionRunContext.end(enrichedPlan.runId);
      setActiveCollectionVariables([]);
    }
  };

  const setupPanel = new CollectionRunSetupPanel({
    discovery,
    environmentManager,
    collectionVariableStore,
    ...(getAuthenticationSnapshot === undefined
      ? {}
      : { getAuthenticationSnapshot }),
    ...(onAuthenticationChanged === undefined
      ? {}
      : { onAuthenticationChanged }),
    getDefaultFailurePolicy: defaultFailurePolicyFromSettings,
    executeRun: executeConfiguredCollectionRun,
  });
  reportPanel.setOnRunAgain(async (collectionId) => {
    setupPanel.show({
      target: { mode: 'collection', collectionId },
      restorePrevious: true,
    });
  });

  const openSetup = (target: RunPlanTarget, restorePrevious = false): void => {
    setupPanel.show({
      target,
      ...(restorePrevious ? { restorePrevious: true } : {}),
    });
  };

  const disposables: Disposable[] = [
    statusBar,
    reportPanel,
    setupPanel,
    liveReportSubscription,
    registerCommandWithLegacyAlias(
      COMMAND_IDS.runCollection,
      async (
        node?: CollectionTreeNode,
        extra?: { readonly restorePreviousSetup?: boolean },
      ) => {
        const collectionId =
          node?.kind === 'collection' ? node.id : await pickCollectionId(discovery);
        if (collectionId === undefined) return;
        openSetup(
          { mode: 'collection', collectionId },
          extra?.restorePreviousSetup === true,
        );
      },
    ),
    registerCommandWithLegacyAlias(COMMAND_IDS.runCollectionTests, async (node?: CollectionTreeNode) => {
      const collectionId = node?.kind === 'collection' ? node.id : await pickCollectionId(discovery);
      if (collectionId === undefined) return;
      openSetup({ mode: 'collection', collectionId });
    }),
    registerCommandWithLegacyAlias(COMMAND_IDS.runFolder, async (node?: CollectionTreeNode) => {
      const folderNode =
        node?.kind === 'folder'
          ? node
          : collectionsTreeView.selection.find((item) => item.kind === 'folder');
      if (folderNode === undefined || folderNode.collectionId === undefined || folderNode.folderId === undefined) {
        await window.showErrorMessage('Select a folder in the Collections view to run.');
        return;
      }
      openSetup({
        mode: 'folder',
        collectionId: folderNode.collectionId,
        folderId: folderNode.folderId,
      });
    }),
    registerCommandWithLegacyAlias(COMMAND_IDS.runSelectedRequests, async (node?: CollectionTreeNode) => {
      const selected = collectSelectedRequestIds(collectionsTreeView, node);
      if (selected === undefined) {
        await window.showErrorMessage('Select one or more requests in the Collections view to run.');
        return;
      }
      openSetup({
        mode: 'selected-requests',
        collectionId: selected.collectionId,
        requestIds: selected.requestIds,
      });
    }),
    registerCommandWithLegacyAlias(COMMAND_IDS.compareWithPreviousRun, async () => {
      if (responseViewer === undefined) {
        await window.showInformationMessage('Response viewer is not available.');
        return;
      }
      if (!responseViewer.canCompareWithPrevious()) {
        await window.showInformationMessage(
          'No previous in-session response for this request. Run the request again, then Compare with Previous Run.',
        );
        return;
      }
      responseViewer.compareWithPrevious();
    }),
    registerCommandWithLegacyAlias(COMMAND_IDS.compareCollectionRuns, async () => {
      await window.showInformationMessage(
        'Open a Collection Run Report, expand a request’s Details, then choose Compare Runs.',
      );
    }),
    registerCommandWithLegacyAlias(COMMAND_IDS.generateTypeScript, async (arg) => {
      if (responseViewer === undefined) {
        await window.showInformationMessage('Response viewer is not available.');
        return;
      }
      const argument = parseRunRequestCommandArgument(arg);
      let mappedDocument: TextDocument | undefined;
      if (argument !== undefined) {
        try {
          mappedDocument = await workspace.openTextDocument(Uri.parse(argument.uri));
          const offset = mappedDocument.offsetAt(
            new Position(argument.position.line, argument.position.character),
          );
          await orchestrator.runAtPosition({
            text: mappedDocument.getText(),
            sourceId: mappedDocument.uri.toString(),
            offset,
          });
        } catch (error: unknown) {
          await window.showErrorMessage(
            error instanceof Error
              ? error.message
              : 'API Hero could not run the mapped request.',
          );
          return;
        }
      }
      if (!responseViewer.canGenerateTypeScript()) {
        await window.showInformationMessage(
          'Generate TypeScript is available after a successful JSON response. Run a request that returns JSON, then try again.',
        );
        return;
      }
      if (argument !== undefined && mappedDocument !== undefined) {
        const lastSource = responseViewer.lastExecutionSourceId?.();
        const lastOffset = responseViewer.lastExecutionOffset?.();
        const expectedOffset = mappedDocument.offsetAt(
          new Position(argument.position.line, argument.position.character),
        );
        if (
          lastSource !== mappedDocument.uri.toString() ||
          lastOffset !== expectedOffset
        ) {
          await window.showInformationMessage(
            'Generate TypeScript needs a successful JSON response from the mapped request.',
          );
          return;
        }
      }
      await responseViewer.generateTypeScript(
        undefined,
        mappedDocument === undefined || argument === undefined
          ? undefined
          : {
              attribution: attributionForMappedRequest(
                mappedDocument,
                argument.position.line,
              ),
            },
      );
    }),
  ];

  context.subscriptions.push(...disposables);
  return disposables;
}

function attributionForMappedRequest(
  document: TextDocument,
  line: number,
): { readonly requestName?: string; readonly requestPath?: string } {
  const parsed = parseApiFileRequests(document.getText(), document.uri.toString());
  const summary = parsed.requests.find((request) => request.range.start.line === line);
  const requestName = sanitizeHoverLabel(summary?.label ?? '').trim();
  const folder = workspace.getWorkspaceFolder(document.uri);
  const requestPath =
    folder === undefined ? '' : workspace.asRelativePath(document.uri, false).trim();
  return {
    ...(requestName.length > 0 ? { requestName } : {}),
    ...(requestPath.length > 0 ? { requestPath } : {}),
  };
}

function countReorderedRequests(dependencies: DependenciesExtension | undefined): number {
  if (dependencies === undefined || !dependencies.reordered) return 0;
  const { originalOrder, executionOrder } = dependencies;
  let count = 0;
  for (let index = 0; index < executionOrder.length; index += 1) {
    if (executionOrder[index] !== originalOrder[index]) count += 1;
  }
  return count;
}

async function presentSummary(
  summary: RunSummary,
  reportPanel: CollectionRunReportPanel,
  environmentName?: string,
): Promise<void> {
  reportPanel.show(summary, {
    ...(environmentName === undefined || environmentName.trim().length === 0
      ? {}
      : { environmentName: environmentName.trim() }),
  });
  const message = formatRunSummaryMessage(summary);
  if (summary.statistics.failed > 0 || summary.statistics.assertionsFailed > 0 || summary.status === 'stopped') {
    await window.showWarningMessage(message);
  } else {
    await window.showInformationMessage(message);
  }
}

function defaultFailurePolicyFromSettings(): CollectionRunFailurePolicyChoice {
  const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);
  const setting = normalizeFailurePolicySetting(
    configuration.get(
      CONFIGURATION_KEYS.collectionRunnerFailurePolicy,
      DEFAULT_CONFIGURATION.collectionRunnerFailurePolicy,
    ),
  );
  return setting === FailurePolicyKinds.StopOnFirstError
    ? FailurePolicyKinds.StopOnFirstError
    : FailurePolicyKinds.ContinueOnError;
}

function environmentNameForOverride(
  environmentManager: EnvironmentManager,
  override: { readonly environmentId?: string },
): string | undefined {
  if (override.environmentId === undefined || override.environmentId.length === 0) {
    return undefined;
  }
  return environmentManager.list().find((environment) => environment.id === override.environmentId)
    ?.name;
}

interface CollectionRunOptionDefaults {
  readonly retryEnabled: boolean;
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly backoff: CollectionRetryBackoff;
  readonly skipDestructiveRequests: boolean;
}

function readCollectionRunOptionDefaults(): CollectionRunOptionDefaults {
  const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);
  const backoffRaw = configuration.get<string>(
    CONFIGURATION_KEYS.collectionRunnerRetryBackoff,
    DEFAULT_CONFIGURATION.collectionRunnerRetryBackoff,
  );
  const backoff: CollectionRetryBackoff =
    backoffRaw === 'fixed' || backoffRaw === 'exponential'
      ? backoffRaw
      : COLLECTION_RETRY_DEFAULT_BACKOFF;
  const maxRetriesRaw = configuration.get<number>(
    CONFIGURATION_KEYS.collectionRunnerMaxRetries,
    DEFAULT_CONFIGURATION.collectionRunnerMaxRetries,
  );
  const delayMsRaw = configuration.get<number>(
    CONFIGURATION_KEYS.collectionRunnerRetryDelayMs,
    DEFAULT_CONFIGURATION.collectionRunnerRetryDelayMs,
  );
  return {
    retryEnabled: configuration.get<boolean>(
      CONFIGURATION_KEYS.collectionRunnerRetryEnabled,
      DEFAULT_CONFIGURATION.collectionRunnerRetryEnabled,
    ),
    maxRetries:
      typeof maxRetriesRaw === 'number' && Number.isSafeInteger(maxRetriesRaw)
        ? Math.min(
            Math.max(0, maxRetriesRaw),
            COLLECTION_RETRY_MAX_RETRIES_CAP,
          )
        : COLLECTION_RETRY_DEFAULT_MAX_RETRIES,
    delayMs:
      typeof delayMsRaw === 'number' && Number.isSafeInteger(delayMsRaw)
        ? Math.min(Math.max(0, delayMsRaw), COLLECTION_RETRY_MAX_DELAY_MS_CAP)
        : COLLECTION_RETRY_DEFAULT_DELAY_MS,
    backoff,
    skipDestructiveRequests: configuration.get<boolean>(
      CONFIGURATION_KEYS.collectionRunnerSkipDestructiveRequests,
      DEFAULT_CONFIGURATION.collectionRunnerSkipDestructiveRequests,
    ),
  };
}

async function pickCollectionId(discovery: CollectionDiscoveryService): Promise<string | undefined> {
  const aggregate = discovery.snapshot ?? (await discovery.refresh());
  const collections = Object.values(aggregate.collections);
  if (collections.length === 0) {
    await window.showErrorMessage('No collections are available to run.');
    return undefined;
  }
  if (collections.length === 1) return collections[0]!.id;
  const picked = await window.showQuickPick(
    collections.map((collection) => ({
      label: collection.display.label,
      description: collection.metadata.workspacePath,
      id: collection.id,
    })),
    { title: 'Run Collection', placeHolder: 'Select a collection' },
  );
  return picked?.id;
}

function collectSelectedRequestIds(
  treeView: TreeView<CollectionTreeNode>,
  node: CollectionTreeNode | undefined,
): { collectionId: string; requestIds: string[] } | undefined {
  const fromSelection = treeView.selection.filter(
    (item) => item.kind === 'request' && item.requestId !== undefined,
  );
  const nodes =
    fromSelection.length > 0
      ? fromSelection
      : node?.kind === 'request' && node.requestId !== undefined
        ? [node]
        : [];
  if (nodes.length === 0) return undefined;
  const collectionId = nodes[0]?.collectionId;
  if (collectionId === undefined) return undefined;
  const requestIds: string[] = [];
  for (const item of nodes) {
    if (item.collectionId === collectionId && item.requestId !== undefined) {
      requestIds.push(item.requestId);
    }
  }
  return requestIds.length === 0 ? undefined : { collectionId, requestIds };
}
