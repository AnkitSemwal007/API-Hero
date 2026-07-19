import {
  commands,
  Position,
  Range,
  Selection,
  Uri,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
} from 'vscode';

import { COMMAND_IDS, VIEW_IDS } from '../../constants';
import type { ExecutionOrchestrator } from '../../orchestration';
import type { Logger } from '../../shared';
import type { EnvironmentManager } from '../../variables';
import {
  DefaultHistoryRecorder,
  filterHistoryEntries,
  resolveHistoryRerunArgument,
  type HistoryCaptureInput,
  type HistoryEntry,
  type HistoryRecorder,
  type HistoryRepository,
} from '../index';
import { FileHistoryRepository } from './file-history-repository';
import {
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

  const refresh = async (): Promise<void> => {
    const entries = await repository.list();
    treeProvider.setEntries(entries);
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
    {
      dispose: () => infrastructure.setOnRecorded(undefined),
    },
    commands.registerCommand(COMMAND_IDS.focusHistory, async () => {
      await commands.executeCommand(`${VIEW_IDS.history}.focus`);
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
        await showEntryDetails(entry);
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
      COMMAND_IDS.deleteHistoryEntry,
      async (target?: unknown) => {
        const entry = await resolveEntry(repository, target);
        if (entry === undefined) {
          return;
        }
        const deleted = await repository.delete(entry.id);
        if (deleted) {
          await refresh();
        }
      },
    ),
    commands.registerCommand(COMMAND_IDS.clearHistory, async () => {
      const confirm = await window.showWarningMessage(
        'Clear all API Runner request history?',
        { modal: true },
        'Clear History',
      );
      if (confirm !== 'Clear History') {
        return;
      }
      await repository.clear();
      await refresh();
      logger.info('Request history cleared');
    }),
    commands.registerCommand(COMMAND_IDS.searchHistory, async () => {
      const value = await window.showInputBox({
        title: 'Filter Request History',
        prompt: 'Filter by method, URL, name, or status',
        value: treeProvider.getFilterQuery() ?? '',
        placeHolder: 'GET example.com',
      });
      if (value === undefined) {
        return;
      }
      treeProvider.setFilterQuery(value.length === 0 ? undefined : value);
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

async function showEntryDetails(entry: HistoryEntry): Promise<void> {
  const lines = [
    `${entry.summary.method} ${entry.summary.url}`,
    `Outcome: ${entry.summary.status}`,
    entry.summary.statusCode === undefined
      ? undefined
      : `HTTP: ${entry.summary.statusCode} ${entry.summary.statusText ?? ''}`.trim(),
    `Duration: ${entry.summary.durationMs} ms`,
    `Completed: ${entry.summary.timestamp}`,
    entry.metadata.requestName === undefined
      ? undefined
      : `Name: ${entry.metadata.requestName}`,
    entry.metadata.environmentName === undefined
      ? undefined
      : `Environment: ${entry.metadata.environmentName}`,
    entry.metadata.collectionName === undefined
      ? undefined
      : `Collection: ${entry.metadata.collectionName}`,
    entry.metadata.contentType === undefined
      ? undefined
      : `Content-Type: ${entry.metadata.contentType}`,
    entry.metadata.responseSizeBytes === undefined
      ? undefined
      : `Response size: ${entry.metadata.responseSizeBytes} bytes`,
    entry.metadata.errorCode === undefined
      ? undefined
      : `Error: ${entry.metadata.errorCode} — ${entry.metadata.errorMessage ?? ''}`,
    entry.metadata.source?.uri === undefined
      ? undefined
      : `Source: ${entry.metadata.source.uri}`,
  ].filter((line): line is string => line !== undefined);

  await window.showInformationMessage(lines[0]!, {
    detail: lines.slice(1).join('\n'),
    modal: true,
  });
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
  query: string | undefined,
): readonly HistoryEntry[] {
  if (query === undefined || query.trim().length === 0) {
    return entries;
  }
  return filterHistoryEntries(entries, { query });
}
