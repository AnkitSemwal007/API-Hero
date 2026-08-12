import {
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
  type TreeView,
} from 'vscode';

import { registerCommandWithLegacyAlias } from '../../commands';

import type { CollectionDiscoveryService } from '../../collections';
import type { CollectionTreeNode } from '../../collections';
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
import type { Logger } from '../../shared';
import { InMemoryRunVariableStore, type CollectionVariableStore } from '../../variables';
import {
  CollectionRunnerService,
  CollectionRunAlreadyActiveError,
  type CollectionRunManager,
  buildRunPlan,
  listFailurePolicies,
  normalizeCollectionRunOptions,
  type CollectionRunOptions,
  type CollectionRunVariableContext,
  type CollectionRetryBackoff,
  type DependenciesExtension,
  type FailurePolicyKind,
  type RunPlanTarget,
  type RunSummary,
  COLLECTION_RETRY_DEFAULT_BACKOFF,
  COLLECTION_RETRY_DEFAULT_DELAY_MS,
  COLLECTION_RETRY_DEFAULT_MAX_RETRIES,
  COLLECTION_RETRY_MAX_DELAY_MS_CAP,
  COLLECTION_RETRY_MAX_RETRIES_CAP,
} from '../index';
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
import {
  normalizeFailurePolicySetting,
  resolveFailurePolicyForRun,
} from './run-report-html';
import type { CollectionRunReportPanel } from './run-report-panel';

export interface RegisterCollectionRunnerOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
  readonly orchestrator: ExecutionOrchestrator;
  readonly collectionsTreeView: TreeView<CollectionTreeNode>;
  readonly collectionRunManager: CollectionRunManager;
  readonly reportPanel: CollectionRunReportPanel;
  readonly getHistoryCaptureContext: () => {
    readonly environmentName?: string;
    readonly collectionName?: string;
  };
  readonly setRequestStatusSuppressed?: (suppressed: boolean) => void;
  readonly collectionRunContext: CollectionRunVariableContext;
  readonly collectionVariableStore: CollectionVariableStore;
  readonly setActiveCollectionVariables: (
    variables: readonly VariableDefinition[],
  ) => void;
  readonly getStaticVariableNames: () => ReadonlySet<string>;
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
    getHistoryCaptureContext,
    setRequestStatusSuppressed,
    collectionRunContext,
    collectionVariableStore,
    setActiveCollectionVariables,
    getStaticVariableNames,
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

  const runWithTarget = async (
    target: RunPlanTarget,
    progressTitle = 'API Hero: Collection Run',
  ): Promise<void> => {
    if (await rejectIfRunActive()) {
      return;
    }

    const policy = await resolveFailurePolicy();
    if (policy === undefined) return;

    const runOptions = await resolveCollectionRunOptions();
    if (runOptions === undefined) return;

    const aggregate = await discovery.refresh();
    let plan;
    try {
      plan = buildRunPlan({
        aggregate,
        target,
        failurePolicy: policy,
        runOptions,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to build a collection run plan.';
      await window.showErrorMessage(message);
      return;
    }

    if (plan.requests.length === 0) {
      await window.showInformationMessage('No requests found for this collection run.');
      return;
    }

    const collectionRootPath = aggregate.collections[plan.collectionId]?.rootPath;
    if (collectionRootPath === undefined) {
      await window.showErrorMessage('API Hero: The collection for this run is no longer available.');
      return;
    }

    const analyses = await analyzeRunPlanDependencies(plan, {
      readText: (filePath) => sourceReader.readText(filePath),
    });
    const enrichment = enrichRunPlanWithDependencies({ membershipPlan: plan, analyses });
    if (!enrichment.ok) {
      await window.showErrorMessage(`API Hero: ${enrichment.message}`);
      return;
    }
    const enrichedPlan = enrichment.plan;
    // Re-check immediately before begin — async work above can race with another start.
    if (await rejectIfRunActive()) {
      return;
    }
    let session;
    try {
      session = manager.begin({ plan: enrichedPlan });
    } catch (error) {
      if (error instanceof CollectionRunAlreadyActiveError) {
        await window.showWarningMessage(activeRunWarning);
        return;
      }
      throw error;
    }
    reportPanel.showLive(session.snapshot);

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
              ...getHistoryCaptureContext(),
              collectionName: enrichedPlan.collectionName,
            },
            runVariableStore,
            staticVariableNames: getStaticVariableNames,
          }),
        session.abortController,
      );
      manager.complete(summary);
      await presentSummary(summary, reportPanel);
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

  const disposables: Disposable[] = [
    statusBar,
    reportPanel,
    liveReportSubscription,
    registerCommandWithLegacyAlias(COMMAND_IDS.runCollection, async (node?: CollectionTreeNode) => {
      const collectionId = node?.kind === 'collection' ? node.id : await pickCollectionId(discovery);
      if (collectionId === undefined) return;
      await runWithTarget({ mode: 'collection', collectionId });
    }),
    registerCommandWithLegacyAlias(COMMAND_IDS.runCollectionTests, async (node?: CollectionTreeNode) => {
      const collectionId = node?.kind === 'collection' ? node.id : await pickCollectionId(discovery);
      if (collectionId === undefined) return;
      await runWithTarget({ mode: 'collection', collectionId });
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
      await runWithTarget({
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
      await runWithTarget(
        {
          mode: 'selected-requests',
          collectionId: selected.collectionId,
          requestIds: selected.requestIds,
        },
        'API Hero: Run Selected Requests',
      );
    }),
  ];

  context.subscriptions.push(...disposables);
  return disposables;
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

async function presentSummary(summary: RunSummary, reportPanel: CollectionRunReportPanel): Promise<void> {
  reportPanel.show(summary);
  const message = formatRunSummaryMessage(summary);
  if (summary.statistics.failed > 0 || summary.statistics.assertionsFailed > 0 || summary.status === 'stopped') {
    await window.showWarningMessage(message);
  } else {
    await window.showInformationMessage(message);
  }
}

async function resolveFailurePolicy(): Promise<FailurePolicyKind | undefined> {
  const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);
  const setting = normalizeFailurePolicySetting(
    configuration.get(
      CONFIGURATION_KEYS.collectionRunnerFailurePolicy,
      DEFAULT_CONFIGURATION.collectionRunnerFailurePolicy,
    ),
  );
  return resolveFailurePolicyForRun(setting, pickFailurePolicy);
}

async function resolveCollectionRunOptions(): Promise<
  CollectionRunOptions | undefined
> {
  const defaults = readCollectionRunOptionDefaults();
  const retry = await pickRetryOptions(defaults);
  if (retry === undefined) {
    return undefined;
  }
  const skipDestructive = await pickSkipDestructive(
    defaults.skipDestructiveRequests,
  );
  if (skipDestructive === undefined) {
    return undefined;
  }
  return normalizeCollectionRunOptions({
    retry,
    skipDestructiveRequests: skipDestructive,
  });
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

async function pickRetryOptions(
  defaults: CollectionRunOptionDefaults,
): Promise<CollectionRunOptions['retry'] | undefined> {
  type RetryPick =
    | { readonly id: 'off' }
    | { readonly id: 'preset' }
    | { readonly id: 'custom' };

  const presetLabel = `Retries: ${defaults.maxRetries} ${defaults.backoff} ${defaults.delayMs}ms`;
  const items: Array<{
    label: string;
    description?: string;
    pick: RetryPick;
  }> = [
    {
      label: 'Retries: Off',
      description: 'No automatic retries',
      pick: { id: 'off' },
    },
    {
      label: presetLabel,
      description: 'Use settings defaults',
      pick: { id: 'preset' },
    },
    {
      label: 'Retries: Custom…',
      description: 'Choose max retries, delay, and backoff',
      pick: { id: 'custom' },
    },
  ];

  const active =
    defaults.retryEnabled === false
      ? items[0]
      : items[1];
  const picked = await window.showQuickPick(items, {
    title: 'Collection run retries',
    placeHolder: 'Choose retry behavior for this run',
    ...(active === undefined ? {} : { activeItems: [active] }),
  });
  if (picked === undefined) {
    return undefined;
  }

  if (picked.pick.id === 'off') {
    return {
      enabled: false,
      maxRetries: defaults.maxRetries,
      delayMs: defaults.delayMs,
      backoff: defaults.backoff,
    };
  }

  if (picked.pick.id === 'preset') {
    return {
      enabled: true,
      maxRetries: defaults.maxRetries,
      delayMs: defaults.delayMs,
      backoff: defaults.backoff,
    };
  }

  const maxRetriesInput = await window.showInputBox({
    title: 'Max retries',
    prompt: `Retries after the first attempt (0–${COLLECTION_RETRY_MAX_RETRIES_CAP})`,
    value: String(defaults.maxRetries),
    validateInput: (value) => {
      const parsed = Number(value);
      if (
        !Number.isSafeInteger(parsed) ||
        parsed < 0 ||
        parsed > COLLECTION_RETRY_MAX_RETRIES_CAP
      ) {
        return `Enter an integer from 0 to ${COLLECTION_RETRY_MAX_RETRIES_CAP}.`;
      }
      return undefined;
    },
  });
  if (maxRetriesInput === undefined) {
    return undefined;
  }

  const delayInput = await window.showInputBox({
    title: 'Retry delay (ms)',
    prompt: `Base delay between attempts (0–${COLLECTION_RETRY_MAX_DELAY_MS_CAP})`,
    value: String(defaults.delayMs),
    validateInput: (value) => {
      const parsed = Number(value);
      if (
        !Number.isSafeInteger(parsed) ||
        parsed < 0 ||
        parsed > COLLECTION_RETRY_MAX_DELAY_MS_CAP
      ) {
        return `Enter an integer from 0 to ${COLLECTION_RETRY_MAX_DELAY_MS_CAP}.`;
      }
      return undefined;
    },
  });
  if (delayInput === undefined) {
    return undefined;
  }

  const backoffItems: Array<{
    label: string;
    description: string;
    backoff: CollectionRetryBackoff;
  }> = [
    {
      label: 'Exponential',
      description: 'delayMs × 2^(retryIndex−1)',
      backoff: 'exponential',
    },
    {
      label: 'Fixed',
      description: 'Same delayMs between every retry',
      backoff: 'fixed',
    },
  ];
  const activeBackoff =
    backoffItems.find((item) => item.backoff === defaults.backoff) ??
    backoffItems[0];
  const backoffPicked = await window.showQuickPick(backoffItems, {
    title: 'Retry backoff',
    placeHolder: 'Choose backoff strategy',
    ...(activeBackoff === undefined ? {} : { activeItems: [activeBackoff] }),
  });
  if (backoffPicked === undefined) {
    return undefined;
  }

  return {
    enabled: true,
    maxRetries: Number(maxRetriesInput),
    delayMs: Number(delayInput),
    backoff: backoffPicked.backoff,
  };
}

async function pickSkipDestructive(
  defaultSkip: boolean,
): Promise<boolean | undefined> {
  const items = [
    {
      label: 'Skip destructive DELETE requests',
      description: 'DELETE methods are skipped for this run',
      skip: true,
    },
    {
      label: 'Allow DELETE requests',
      description: 'Run DELETE methods normally',
      skip: false,
    },
  ];
  const active = items.find((item) => item.skip === defaultSkip) ?? items[1];
  const picked = await window.showQuickPick(items, {
    title: 'Destructive requests',
    placeHolder: 'Skip DELETE requests for this run?',
    ...(active === undefined ? {} : { activeItems: [active] }),
  });
  return picked?.skip;
}

async function pickFailurePolicy(): Promise<FailurePolicyKind | undefined> {
  const items = listFailurePolicies().map((policy) => ({
    label: policy.label,
    description: policy.kind,
    policyKind: policy.kind,
  }));
  const picked = await window.showQuickPick(items, {
    title: 'Collection run failure policy',
    placeHolder: 'Choose how failures are handled',
  });
  return picked?.policyKind;
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
