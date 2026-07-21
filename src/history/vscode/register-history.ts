import {
  commands,
  env,
  Position,
  Range,
  Selection,
  Uri,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
  type QuickPickItem,
} from 'vscode';

import { COMMAND_IDS, VIEW_IDS } from '../../constants';
import type { ExecutionOrchestrator } from '../../orchestration';
import type { Logger } from '../../shared';
import type { EnvironmentManager } from '../../variables';
import {
  DefaultHistoryRecorder,
  filterHistoryEntries,
  HistoryExecutionStatus,
  resolveHistoryRerunArgument,
  type HistoryCaptureInput,
  type HistoryEntry,
  type HistoryExecutionStatus as HistoryStatus,
  type HistoryFilter,
  type HistoryRecorder,
  type HistoryRepository,
} from '../index';
import { formatHistorySummaryText } from './history-detail-html';
import { HistoryDetailPanel } from './history-detail-panel';
import { FileHistoryRepository } from './file-history-repository';
import {
  describeHistoryFilter,
  HistoryTreeDataProvider,
  type HistoryTreeNode,
} from './history-tree-provider';

export interface HistoryInfrastructure {
  readonly repository: HistoryRepository;
  readonly recorder: HistoryRecorder;
  /** Wired after the tree is registered so appends refresh the explorer. */
  setOnRecorded(listener: (() => Promise<void>) | undefined): void;
}

/**
 * Creates persistence + recorder before the orchestrator is constructed.
 * Call {@link registerHistory} afterward to attach the Activity Bar UI.
 */
export function createHistoryInfrastructure(
  context: ExtensionContext,
  maxEntries: number,
): HistoryInfrastructure {
  const repository = FileHistoryRepository.fromExtensionContext(
    context,
    maxEntries,
  );
  const inner = new DefaultHistoryRecorder(repository);
  let onRecorded: (() => Promise<void>) | undefined;

  const recorder: HistoryRecorder = {
    beginRun: (runId) => inner.beginRun(runId),
    record: async (input: HistoryCaptureInput) => {
      const recorded = await inner.record(input);
      if (recorded && onRecorded !== undefined) {
        await onRecorded();
      }
      return recorded;
    },
  };

  return {
    repository,
    recorder,
    setOnRecorded: (listener) => {
      onRecorded = listener;
    },
  };
}

export interface RegisterHistoryOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
  readonly orchestrator: ExecutionOrchestrator;
  readonly environmentManager: EnvironmentManager;
  readonly infrastructure: HistoryInfrastructure;
}

export interface HistoryRegistration {
  readonly disposables: readonly Disposable[];
  readonly repository: HistoryRepository;
  /**
   * Sole composition-owned capture-context provider for history metadata.
   * Supplies secret-free `environmentName` when an environment is active.
   * `collectionName` is omitted until a secret-free lookup is wired (best-effort).
   * `extension.ts` passes this into {@link ExecutionOrchestrator}.
   */
  readonly getCaptureContext: () => {
    readonly environmentName?: string;
    readonly collectionName?: string;
  };
  readonly refresh: () => Promise<void>;
}

/**
 * Composes the History tree view and commands.
 * Called from `extension.ts` only — keeps activate composition-only.
 */
export function registerHistory(
  options: RegisterHistoryOptions,
): HistoryRegistration {
  const { context, logger, orchestrator, environmentManager, infrastructure } =
    options;
  const { repository } = infrastructure;

  const treeProvider = new HistoryTreeDataProvider();
  const treeView = window.createTreeView(VIEW_IDS.history, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  let cachedEntries: readonly HistoryEntry[] = [];

  const detailPanel = new HistoryDetailPanel({
    rerun: (entry) => rerunEntry(orchestrator, entry),
    reveal: (entry) => revealOriginalRequest(entry),
    deleteEntry: async (entry) => {
      const deleted = await repository.delete(entry.id);
      if (deleted) {
        await refresh();
      }
      return deleted;
    },
  });

  const applyFilterBanner = (): void => {
    treeView.message = describeHistoryFilter(treeProvider.getFilter());
  };

  const refresh = async (): Promise<void> => {
    const entries = await repository.list();
    cachedEntries = entries;
    treeProvider.setEntries(entries);
    applyFilterBanner();
  };

  infrastructure.setOnRecorded(refresh);

  /** Owned here; wired into the orchestrator once from `extension.ts`. */
  const getCaptureContext = (): {
    readonly environmentName?: string;
    readonly collectionName?: string;
  } => {
    const environmentName = environmentManager.capture().active?.name;
    return {
      ...(environmentName === undefined ? {} : { environmentName }),
      // collectionName intentionally omitted until a secret-free lookup exists
    };
  };

  const disposables: Disposable[] = [
    treeView,
    detailPanel,
    {
      dispose: () => infrastructure.setOnRecorded(undefined),
    },
    commands.registerCommand(COMMAND_IDS.focusHistory, async () => {
      await commands.executeCommand(`${VIEW_IDS.history}.focus`);
    }),
    /**
     * Intentional IA alias for menus/Overview Quick Actions.
     * Same behavior as focusHistory — not a separate Activity Bar view.
     */
    commands.registerCommand(COMMAND_IDS.recentRequests, async () => {
      await commands.executeCommand(COMMAND_IDS.focusHistory);
    }),
    commands.registerCommand(
      COMMAND_IDS.openHistoryEntry,
      async (target?: unknown) => {
        const entry = await resolveEntry(repository, target);
        if (entry === undefined) {
          await window.showInformationMessage(
            'Select a history entry to inspect.',
          );
          return;
        }
        detailPanel.show(entry);
      },
    ),
    commands.registerCommand(
      COMMAND_IDS.rerunHistoryEntry,
      async (target?: unknown) => {
        const entry = await resolveEntry(repository, target);
        if (entry === undefined) {
          await window.showInformationMessage(
            'Select a history entry to re-run.',
          );
          return;
        }
        await rerunEntry(orchestrator, entry);
      },
    ),
    commands.registerCommand(
      COMMAND_IDS.revealHistoryRequest,
      async (target?: unknown) => {
        const entry = await resolveEntry(repository, target);
        if (entry === undefined) {
          await window.showInformationMessage(
            'Select a history entry to reveal.',
          );
          return;
        }
        await revealOriginalRequest(entry);
      },
    ),
    commands.registerCommand(
      COMMAND_IDS.copyHistorySummary,
      async (target?: unknown) => {
        const entry = await resolveEntry(repository, target);
        if (entry === undefined) {
          await window.showInformationMessage(
            'Select a history entry to copy.',
          );
          return;
        }
        await env.clipboard.writeText(formatHistorySummaryText(entry));
        window.setStatusBarMessage('History summary copied to clipboard', 2_000);
      },
    ),
    commands.registerCommand(
      COMMAND_IDS.deleteHistoryEntry,
      async (target?: unknown) => {
        const entry = await resolveEntry(repository, target);
        if (entry === undefined) {
          return;
        }
        const deleted = await repository.delete(entry.id);
        if (deleted) {
          detailPanel.notifyEntryDeleted(entry.id);
          await refresh();
        }
      },
    ),
    commands.registerCommand(COMMAND_IDS.clearHistory, async () => {
      const confirm = await window.showWarningMessage(
        'Clear all API Hero request history?',
        { modal: true },
        'Clear History',
      );
      if (confirm !== 'Clear History') {
        return;
      }
      await repository.clear();
      detailPanel.close();
      await refresh();
      logger.info('Request history cleared');
    }),
    commands.registerCommand(COMMAND_IDS.searchHistory, async () => {
      const next = await promptHistoryFilter(
        treeProvider.getFilter(),
        cachedEntries,
      );
      if (next === undefined) {
        return;
      }
      treeProvider.setFilter(next);
      applyFilterBanner();
    }),
    commands.registerCommand(COMMAND_IDS.refreshHistory, async () => {
      await refresh();
    }),
  ];

  void refresh().then(
    () => logger.info('Request history loaded'),
    (error: unknown) => {
      logger.warning('Request history failed to load', {
        message: error instanceof Error ? error.message : String(error),
      });
    },
  );

  context.subscriptions.push(...disposables);

  return {
    disposables,
    repository,
    getCaptureContext,
    refresh,
  };
}

async function resolveEntry(
  repository: HistoryRepository,
  target: unknown,
): Promise<HistoryEntry | undefined> {
  if (typeof target === 'string') {
    return repository.get(target);
  }
  if (isHistoryTreeEntry(target)) {
    return target.entry;
  }
  if (isHistoryEntry(target)) {
    return target;
  }
  if (isRecord(target) && typeof target.id === 'string') {
    return repository.get(target.id);
  }
  return undefined;
}

/**
 * Facet filter UX: status → method → optional free-text.
 * Uses {@link HistoryFilter} / {@link filterHistoryEntries} unchanged.
 */
async function promptHistoryFilter(
  current: HistoryFilter,
  entries: readonly HistoryEntry[],
): Promise<HistoryFilter | undefined> {
  const statusPick = await window.showQuickPick(statusFacetItems(current), {
    title: 'Filter History — Status',
    placeHolder: 'Filter by execution outcome',
    matchOnDescription: true,
  });
  if (statusPick === undefined) {
    return undefined;
  }
  if (statusPick.id === 'clear') {
    return {};
  }

  const status =
    statusPick.id === 'all'
      ? undefined
      : (statusPick.id as HistoryStatus);

  const methodPick = await window.showQuickPick(
    methodFacetItems(current, entries, status),
    {
      title: 'Filter History — Method',
      placeHolder: 'Filter by HTTP method',
      matchOnDescription: true,
    },
  );
  if (methodPick === undefined) {
    return undefined;
  }

  const method =
    methodPick.id === 'all' ? undefined : methodPick.id.toUpperCase();

  const text = await window.showInputBox({
    title: 'Filter History — Text',
    prompt: 'Optional free-text filter (method, URL, name, status). Leave empty to skip.',
    value: current.query ?? '',
    placeHolder: 'example.com',
  });
  if (text === undefined) {
    return undefined;
  }

  return {
    ...(status === undefined ? {} : { status }),
    ...(method === undefined ? {} : { method }),
    ...(text.trim().length === 0 ? {} : { query: text.trim() }),
  };
}

interface FilterPickItem extends QuickPickItem {
  readonly id: string;
}

function statusFacetItems(current: HistoryFilter): FilterPickItem[] {
  const selected =
    typeof current.status === 'string' ? current.status : undefined;
  return [
    {
      id: 'all',
      label: 'All statuses',
      description: selected === undefined ? 'Current' : undefined,
      picked: selected === undefined,
    },
    {
      id: HistoryExecutionStatus.Success,
      label: '$(pass) Success',
      description: selected === HistoryExecutionStatus.Success ? 'Current' : undefined,
      picked: selected === HistoryExecutionStatus.Success,
    },
    {
      id: HistoryExecutionStatus.Failure,
      label: '$(error) Failure',
      description: selected === HistoryExecutionStatus.Failure ? 'Current' : undefined,
      picked: selected === HistoryExecutionStatus.Failure,
    },
    {
      id: HistoryExecutionStatus.Cancelled,
      label: '$(circle-slash) Cancelled',
      description:
        selected === HistoryExecutionStatus.Cancelled ? 'Current' : undefined,
      picked: selected === HistoryExecutionStatus.Cancelled,
    },
    {
      id: 'clear',
      label: '$(clear-all) Clear all filters',
      description: describeHistoryFilter(current),
    },
  ];
}

function methodFacetItems(
  current: HistoryFilter,
  entries: readonly HistoryEntry[],
  status: HistoryStatus | undefined,
): FilterPickItem[] {
  const scoped = filterHistoryEntries(
    entries,
    status === undefined ? {} : { status },
  );
  const methods = [
    ...new Set(
      scoped.map((entry) => entry.summary.method.trim().toUpperCase()).filter(
        (method) => method.length > 0,
      ),
    ),
  ].sort();
  const selected = current.method?.trim().toUpperCase();
  return [
    {
      id: 'all',
      label: 'All methods',
      description: selected === undefined ? 'Current' : undefined,
      picked: selected === undefined,
    },
    ...methods.map((method) => ({
      id: method,
      label: `$(symbol-method) ${method}`,
      description: selected === method ? 'Current' : undefined,
      picked: selected === method,
    })),
  ];
}

async function rerunEntry(
  orchestrator: ExecutionOrchestrator,
  entry: HistoryEntry,
): Promise<void> {
  const argument = resolveHistoryRerunArgument(entry);
  const sourceUri = entry.metadata.source?.uri;
  if (argument === undefined || sourceUri === undefined) {
    await window.showErrorMessage(
      'This history entry has no source location to re-run.',
    );
    return;
  }

  let document;
  try {
    document = await workspace.openTextDocument(Uri.parse(sourceUri));
  } catch {
    await window.showErrorMessage(
      'The original request file could not be opened. It may have been moved or deleted.',
    );
    return;
  }

  const editor = await window.showTextDocument(document);
  const position = document.validatePosition(
    new Position(argument.position.line, argument.position.character),
  );
  editor.selection = new Selection(position, position);
  editor.revealRange(new Range(position, position));

  await orchestrator.runAtPosition({
    text: document.getText(),
    sourceId: document.uri.toString(),
    offset: document.offsetAt(position),
  });
}

async function revealOriginalRequest(entry: HistoryEntry): Promise<void> {
  const argument = resolveHistoryRerunArgument(entry);
  const sourceUri = entry.metadata.source?.uri;
  if (argument === undefined || sourceUri === undefined) {
    await window.showErrorMessage(
      'This history entry has no source location to reveal.',
    );
    return;
  }

  try {
    const document = await workspace.openTextDocument(Uri.parse(sourceUri));
    const editor = await window.showTextDocument(document);
    const position = document.validatePosition(
      new Position(argument.position.line, argument.position.character),
    );
    editor.selection = new Selection(position, position);
    editor.revealRange(new Range(position, position));
  } catch {
    await window.showErrorMessage(
      'The original request file could not be opened. It may have been moved or deleted.',
    );
  }
}

function isHistoryTreeEntry(
  value: unknown,
): value is Extract<HistoryTreeNode, { kind: 'entry' }> {
  return isRecord(value) && value.kind === 'entry' && isHistoryEntry(value.entry);
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isRecord(value.summary) &&
    isRecord(value.metadata)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Exported for tests — filters a snapshot with the same rules as the tree. */
export function filterVisibleHistory(
  entries: readonly HistoryEntry[],
  filter: HistoryFilter | string | undefined,
): readonly HistoryEntry[] {
  if (filter === undefined) {
    return entries;
  }
  if (typeof filter === 'string') {
    if (filter.trim().length === 0) {
      return entries;
    }
    return filterHistoryEntries(entries, { query: filter });
  }
  return filterHistoryEntries(entries, filter);
}
