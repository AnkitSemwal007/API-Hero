import {
  commands,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
  type TreeView,
} from 'vscode';

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
  buildRunPlan,
  listFailurePolicies,
  type CollectionRunVariableContext,
  type DependenciesExtension,
  type FailurePolicyKind,
  type RunPlanTarget,
  type RunSummary,
} from '../index';
import {
  VsCodeCollectionRunProgress,
  VsCodeCollectionRunSourceReader,
  formatRunSummaryMessage,
  withCollectionRunProgress,
} from './progress-ui';
import {
  normalizeFailurePolicySetting,
  resolveFailurePolicyForRun,
} from './run-report-html';
import { CollectionRunReportPanel } from './run-report-panel';

export interface RegisterCollectionRunnerOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
  readonly orchestrator: ExecutionOrchestrator;
  readonly collectionsTreeView: TreeView<CollectionTreeNode>;
  /**
   * Composition-owned history labels. Collection runs merge this with
   * `collectionName` so environmentName is preserved.
   */
  readonly getHistoryCaptureContext: () => {
    readonly environmentName?: string;
    readonly collectionName?: string;
  };
  /**
   * Suppresses the single-request status bar while a collection run is active
   * so only the Collection Runner progress/status UI is visible.
   */
  readonly setRequestStatusSuppressed?: (suppressed: boolean) => void;
  /**
   * Composition-owned holder swapped for the duration of one execute (§3.6,
   * §5.1). `CompositeVariableWriter` / `getVariableContext` in `extension.ts`
   * consult it while a run is active.
   */
  readonly collectionRunContext: CollectionRunVariableContext;
  /** Loaded once per run and cached on `collectionRunContext.begin` (§8.3). */
  readonly collectionVariableStore: CollectionVariableStore;
  /**
   * Lets `extension.ts` merge the active run's collection variables into
   * variable resolution for the run's duration (§8.2). Cleared in `finally`.
   */
  readonly setActiveCollectionVariables: (
    variables: readonly VariableDefinition[],
  ) => void;
  /**
   * Names of variables statically defined outside the run store (env,
   * collection, workspace, global — §6.7). Consulted per pre-flight check so
   * a static definition prevents an incorrect dependency skip even when the
   * run store is empty (e.g. after a failed producer).
   */
  readonly getStaticVariableNames: () => ReadonlySet<string>;
}

/**
 * Registers Collection Runner commands and UI. Called from `extension.ts`
 * only — keeps activate composition-only.
 *
 * Snapshot safety: each command awaits {@link CollectionDiscoveryService.refresh}
 * once and builds the plan from that returned aggregate, avoiding dependence on
 * mid-run refresh races in the repository.
 */
export function registerCollectionRunner(
  options: RegisterCollectionRunnerOptions,
): readonly Disposable[] {
  const {
    discovery,
    orchestrator,
    collectionsTreeView,
    logger,
    context,
    getHistoryCaptureContext,
    setRequestStatusSuppressed,
    collectionRunContext,
    collectionVariableStore,
    setActiveCollectionVariables,
    getStaticVariableNames,
  } = options;
  const progressUi = new VsCodeCollectionRunProgress();
  const reportPanel = new CollectionRunReportPanel();
  const sourceReader = new VsCodeCollectionRunSourceReader();
  const runner = new CollectionRunnerService({
    executor: orchestrator,
    sourceReader,
    progress: progressUi,
  });

  let activeRun: AbortController | undefined;

  const runWithTarget = async (
    target: RunPlanTarget,
    title: string,
  ): Promise<void> => {
    if (activeRun !== undefined) {
      await window.showWarningMessage(
        'A collection run is already in progress. Cancel it from the progress notification first.',
      );
      return;
    }

    const policy = await resolveFailurePolicy();
    if (policy === undefined) {
      return;
    }

    // Await a full refresh so the plan is built from a committed snapshot,
    // not a partially updated repository during a concurrent invalidate.
    const aggregate = await discovery.refresh();
    let plan;
    try {
      plan = buildRunPlan({
        aggregate,
        target,
        failurePolicy: policy,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to build a collection run plan.';
      await window.showErrorMessage(message);
      return;
    }

    if (plan.requests.length === 0) {
      await window.showInformationMessage(
        'No requests found for this collection run.',
      );
      return;
    }

    const collectionRootPath = aggregate.collections[plan.collectionId]?.rootPath;
    if (collectionRootPath === undefined) {
      await window.showErrorMessage(
        'API Hero: The collection for this run is no longer available.',
      );
      return;
    }

    // Discovery → buildRunPlan (membership DFS) → analyze produces/consumes/
    // depends-on → enrich. On CYCLE / AMBIGUOUS / UNKNOWN targets, abort
    // before any request executes (§5.1, §6.5).
    const analyses = await analyzeRunPlanDependencies(plan, {
      readText: (filePath) => sourceReader.readText(filePath),
    });
    const enrichment = enrichRunPlanWithDependencies({
      membershipPlan: plan,
      analyses,
    });
    if (!enrichment.ok) {
      await window.showErrorMessage(`API Hero: ${enrichment.message}`);
      return;
    }
    const enrichedPlan = enrichment.plan;

    activeRun = new AbortController();
    const controller = activeRun;
    setRequestStatusSuppressed?.(true);

    // Fresh per-run store (never the session store) + active collection
    // context for the duration of this execute only (§5.1, §5.2, §5.5).
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
        title,
        progressUi,
        async (progressSignal) => {
          const onAbort = (): void => controller.abort('cancelled');
          progressSignal.addEventListener('abort', onAbort, { once: true });
          if (progressSignal.aborted) {
            controller.abort('cancelled');
          }
          try {
            return await runner.execute({
              plan: enrichedPlan,
              signal: controller.signal,
              historyCaptureContext: {
                ...getHistoryCaptureContext(),
                collectionName: enrichedPlan.collectionName,
              },
              runVariableStore,
              staticVariableNames: getStaticVariableNames,
            });
          } finally {
            progressSignal.removeEventListener('abort', onAbort);
          }
        },
      );
      await presentSummary(summary, progressUi, reportPanel);
      const reorderedCount = countReorderedRequests(
        enrichedPlan.extensions?.dependencies,
      );
      if (reorderedCount > 0) {
        void window.showInformationMessage(
          `Reordered ${reorderedCount} requests for dependencies`,
        );
      }
      logger.info('Collection run finished', {
        runId: summary.runId,
        status: summary.status,
        passed: summary.statistics.passed,
        failed: summary.statistics.failed,
      });
    } catch (error) {
      logger.warning('Collection run failed unexpectedly', {
        message: error instanceof Error ? error.message : String(error),
      });
      await window.showErrorMessage(
        'API Hero could not complete the collection run.',
      );
    } finally {
      // Always end + clear, including abort and policy stop (§5.4, §13).
      runVariableStore.clear();
      collectionRunContext.end(enrichedPlan.runId);
      setActiveCollectionVariables([]);
      setRequestStatusSuppressed?.(false);
      if (activeRun === controller) {
        activeRun = undefined;
      }
      progressUi.hideSoon();
    }
  };

  const disposables: Disposable[] = [
    progressUi,
    reportPanel,
    commands.registerCommand(COMMAND_IDS.runCollection, async (node?: CollectionTreeNode) => {
      const collectionId =
        node?.kind === 'collection'
          ? node.id
          : await pickCollectionId(discovery);
      if (collectionId === undefined) {
        return;
      }
      await runWithTarget(
        { mode: 'collection', collectionId },
        'API Hero: Run Collection',
      );
    }),
    commands.registerCommand(
      COMMAND_IDS.runCollectionTests,
      async (node?: CollectionTreeNode) => {
        const collectionId =
          node?.kind === 'collection'
            ? node.id
            : await pickCollectionId(discovery);
        if (collectionId === undefined) {
          return;
        }
        await runWithTarget(
          { mode: 'collection', collectionId },
          'API Hero: Run Collection Tests',
        );
      },
    ),
    commands.registerCommand(
      COMMAND_IDS.runFolder,
      async (node?: CollectionTreeNode) => {
        const folderNode =
          node?.kind === 'folder'
            ? node
            : collectionsTreeView.selection.find((item) => item.kind === 'folder');
        if (
          folderNode === undefined ||
          folderNode.collectionId === undefined ||
          folderNode.folderId === undefined
        ) {
          await window.showErrorMessage(
            'Select a folder in the Collections view to run.',
          );
          return;
        }
        await runWithTarget(
          {
            mode: 'folder',
            collectionId: folderNode.collectionId,
            folderId: folderNode.folderId,
          },
          'API Hero: Run Folder',
        );
      },
    ),
    commands.registerCommand(
      COMMAND_IDS.runSelectedRequests,
      async (node?: CollectionTreeNode) => {
        const selected = collectSelectedRequestIds(
          collectionsTreeView,
          node,
        );
        if (selected === undefined) {
          await window.showErrorMessage(
            'Select one or more requests in the Collections view to run.',
          );
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
      },
    ),
  ];

  context.subscriptions.push(...disposables);
  return disposables;
}

/** Counts positions where execution order differs from membership order (§6.6, §10.2). */
function countReorderedRequests(
  dependencies: DependenciesExtension | undefined,
): number {
  if (dependencies === undefined || !dependencies.reordered) {
    return 0;
  }
  const { originalOrder, executionOrder } = dependencies;
  let count = 0;
  for (let index = 0; index < executionOrder.length; index += 1) {
    if (executionOrder[index] !== originalOrder[index]) {
      count += 1;
    }
  }
  return count;
}

async function presentSummary(
  summary: RunSummary,
  progressUi: VsCodeCollectionRunProgress,
  reportPanel: CollectionRunReportPanel,
): Promise<void> {
  progressUi.showSummary(summary);
  reportPanel.show(summary);
  const message = formatRunSummaryMessage(summary);
  if (
    summary.statistics.failed > 0 ||
    summary.statistics.assertionsFailed > 0 ||
    summary.status === 'stopped'
  ) {
    await window.showWarningMessage(message);
  } else if (summary.status === 'cancelled') {
    await window.showInformationMessage(message);
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

async function pickCollectionId(
  discovery: CollectionDiscoveryService,
): Promise<string | undefined> {
  const aggregate = discovery.snapshot ?? (await discovery.refresh());
  const collections = Object.values(aggregate.collections);
  if (collections.length === 0) {
    await window.showErrorMessage('No collections are available to run.');
    return undefined;
  }
  if (collections.length === 1) {
    return collections[0]!.id;
  }
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
  if (nodes.length === 0) {
    return undefined;
  }
  const collectionId = nodes[0]?.collectionId;
  if (collectionId === undefined) {
    return undefined;
  }
  const requestIds: string[] = [];
  for (const item of nodes) {
    if (
      item.collectionId === collectionId &&
      item.requestId !== undefined
    ) {
      requestIds.push(item.requestId);
    }
  }
  return requestIds.length === 0 ? undefined : { collectionId, requestIds };
}
