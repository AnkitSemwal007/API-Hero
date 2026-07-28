/**
 * Registers the Execution Activity Bar tree view and related commands.
 */
import {
  commands,
  env,
  window,
  type Disposable,
  type ExtensionContext,
  type TreeView,
} from 'vscode';
import type { CollectionDiscoveryService } from '../../collections';
import {
  findTreeNodeByCollectionId,
  type CollectionTreeNode,
} from '../../collections';
import { COMMAND_IDS, VIEW_IDS } from '../../constants';
import type { CollectionRunManager } from '../collection-run-manager';
import type { CollectionRunSessionSnapshot } from '../run-session-models';
import {
  ExecutionTreeDataProvider,
  type ExecutionTreeNode,
} from './execution-tree-provider';
import type { CollectionRunReportPanel } from './run-report-panel';

export interface RegisterExecutionViewOptions {
  readonly context: ExtensionContext;
  readonly manager: CollectionRunManager;
  readonly reportPanel: CollectionRunReportPanel;
  readonly discovery: CollectionDiscoveryService;
  readonly collectionsTreeView: TreeView<CollectionTreeNode>;
}

export function registerExecutionView(
  options: RegisterExecutionViewOptions,
): readonly Disposable[] {
  const { context, manager, reportPanel, discovery, collectionsTreeView } = options;
  const provider = new ExecutionTreeDataProvider();
  const treeView = window.createTreeView(VIEW_IDS.execution, {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  const refreshTree = (): void => {
    provider.setSessions(manager.listActive(), manager.listRecent());
    const count = manager.activeCount;
    treeView.badge =
      count > 0
        ? {
            value: count,
            tooltip:
              count === 1
                ? '1 active collection run'
                : `${count} active collection runs`,
          }
        : undefined;
  };
  const openLive = async (runId: string): Promise<void> => {
    const session = manager.get(runId);
    if (session === undefined) {
      await window.showInformationMessage('That collection run is no longer available.');
      return;
    }
    if (session.summary !== undefined) {
      reportPanel.show(session.summary);
      return;
    }
    reportPanel.showLive(session);
  };
  const openRecent = async (runId: string): Promise<void> => {
    const session = manager.get(runId);
    if (session?.summary !== undefined) {
      reportPanel.show(session.summary);
      return;
    }
    if (session !== undefined) {
      reportPanel.showLive(session);
      return;
    }
    await window.showInformationMessage('No run report is available for that session.');
  };
  const revealByRunId = async (runId: string): Promise<void> => {
    const session = manager.get(runId);
    if (session === undefined) {
      await window.showInformationMessage('That collection run is no longer available.');
      return;
    }
    await revealExecutionCollection(discovery, collectionsTreeView, session);
  };
  const revealByCollectionId = async (collectionId: string): Promise<void> => {
    await commands.executeCommand(COMMAND_IDS.focusCollections);
    const aggregate = discovery.snapshot ?? (await discovery.refresh());
    const node = findTreeNodeByCollectionId(aggregate, collectionId);
    if (node === undefined) {
      await window.showWarningMessage('That collection is no longer in the workspace.');
      return;
    }
    try {
      await collectionsTreeView.reveal(node, { select: true, focus: true, expand: true });
    } catch {
      await window.showWarningMessage('Could not reveal that collection in the tree.');
    }
  };
  const resolveRunId = (arg?: string | ExecutionTreeNode): string | undefined => {
    if (typeof arg === 'string' && arg.trim().length > 0) return arg.trim();
    if (arg !== undefined && typeof arg === 'object' && (arg.kind === 'activeRun' || arg.kind === 'recentRun')) {
      return arg.session.runId;
    }
    return undefined;
  };
  refreshTree();
  const disposables: Disposable[] = [
    treeView,
    provider,
    manager.onDidChange(refreshTree),
    commands.registerCommand(COMMAND_IDS.focusExecution, async () => {
      await commands.executeCommand(`${VIEW_IDS.execution}.focus`);
    }),
    commands.registerCommand(COMMAND_IDS.cancelCollectionRun, async (arg?: string | ExecutionTreeNode) => {
      const runId = resolveRunId(arg) ?? manager.listActive()[0]?.runId;
      if (runId === undefined) {
        await window.showInformationMessage('No collection run is currently active.');
        return;
      }
      if (!manager.cancel(runId)) {
        await window.showInformationMessage('That collection run is no longer active.');
      }
    }),
    commands.registerCommand(COMMAND_IDS.openLiveRunReport, async (arg?: string | ExecutionTreeNode) => {
      const runId = resolveRunId(arg) ?? manager.listActive()[0]?.runId;
      if (runId === undefined) {
        await window.showInformationMessage('No collection run is currently active.');
        return;
      }
      await openLive(runId);
    }),
    commands.registerCommand(COMMAND_IDS.openRecentRunReport, async (arg?: string | ExecutionTreeNode) => {
      const runId = resolveRunId(arg);
      if (runId !== undefined) {
        await openRecent(runId);
        return;
      }
      const recent = manager.listRecent();
      if (recent.length === 0) {
        await window.showInformationMessage('No recent collection runs are available.');
        return;
      }
      await openRecent(recent[0]!.runId);
    }),
    commands.registerCommand(COMMAND_IDS.revealExecutionCollection, async (arg?: string | ExecutionTreeNode) => {
      const runId = resolveRunId(arg);
      if (runId !== undefined) {
        if (manager.get(runId) !== undefined) {
          await revealByRunId(runId);
          return;
        }
        // Tree nodes pass a run id; a bare string may be a collection id (palette/tests).
        const aggregate = discovery.snapshot ?? (await discovery.refresh());
        if (findTreeNodeByCollectionId(aggregate, runId) !== undefined) {
          await revealByCollectionId(runId);
          return;
        }
        await window.showInformationMessage(
          'That collection run is no longer available. Select a run in Execution, or focus Collections.',
        );
        return;
      }
      const session = manager.listActive()[0] ?? manager.listRecent()[0];
      if (session === undefined) {
        await window.showInformationMessage('No collection run is available to reveal.');
        return;
      }
      await revealByCollectionId(session.collectionId);
    }),
    commands.registerCommand(COMMAND_IDS.copyCollectionRunId, async (arg?: string | ExecutionTreeNode) => {
      const id = resolveRunId(arg) ?? manager.listActive()[0]?.runId ?? manager.listRecent()[0]?.runId;
      if (id === undefined) {
        await window.showInformationMessage('No collection run ID is available to copy.');
        return;
      }
      await env.clipboard.writeText(id);
    }),
  ];
  context.subscriptions.push(...disposables);
  return disposables;
}

export async function revealExecutionCollection(
  discovery: CollectionDiscoveryService,
  collectionsTreeView: TreeView<CollectionTreeNode>,
  session: CollectionRunSessionSnapshot,
): Promise<void> {
  await commands.executeCommand(COMMAND_IDS.focusCollections);
  const aggregate = discovery.snapshot ?? (await discovery.refresh());
  const node = findTreeNodeByCollectionId(aggregate, session.collectionId);
  if (node === undefined) {
    await window.showWarningMessage(`Collection "${session.collectionName}" is no longer in the workspace.`);
    return;
  }
  try {
    await collectionsTreeView.reveal(node, { select: true, focus: true, expand: true });
  } catch {
    await window.showWarningMessage(`Could not reveal collection "${session.collectionName}" in the tree.`);
  }
}
