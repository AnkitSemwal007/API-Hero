import {
  ProgressLocation,
  StatusBarAlignment,
  Uri,
  window,
  workspace,
  type Disposable,
  type StatusBarItem,
} from 'vscode';

import { COMMAND_IDS } from '../../constants';
import type { CollectionRunManager } from '../collection-run-manager';
import type {
  CollectionRunProgressPort,
  RunProgressEvent,
  RunSummary,
} from '../index';
import {
  formatAttemptLabel,
  formatAttemptSuffix,
} from '../progress-labels';

export { formatAttemptLabel, formatAttemptSuffix } from '../progress-labels';

/** Reads `.api` text through VS Code's filesystem provider. */
export class VsCodeCollectionRunSourceReader {
  public async readText(filePath: string): Promise<string> {
    const uri = filePath.includes('://')
      ? Uri.parse(filePath)
      : Uri.file(filePath);
    const bytes = await workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  }
}

/**
 * Status bar hub subscribed to {@link CollectionRunManager}.
 * Idle: Ready; Running: Running(N). Click focuses the Execution view.
 */
export class CollectionRunStatusBar implements Disposable {
  private readonly item: StatusBarItem;
  private disposed = false;
  private readonly subscription: { dispose(): void };

  public constructor(
    private readonly manager: CollectionRunManager,
    private readonly setRequestStatusSuppressed?: (
      suppressed: boolean,
    ) => void,
  ) {
    this.item = window.createStatusBarItem(StatusBarAlignment.Left, 99);
    this.item.name = 'API Hero Execution';
    this.item.command = COMMAND_IDS.focusExecution;
    this.subscription = manager.onDidChange(() => {
      this.refresh();
    });
    this.refresh();
    this.item.show();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.subscription.dispose();
    this.setRequestStatusSuppressed?.(false);
    this.item.dispose();
  }

  private refresh(): void {
    if (this.disposed) {
      return;
    }
    const count = this.manager.activeCount;
    this.setRequestStatusSuppressed?.(count > 0);
    if (count === 0) {
      this.item.text = '$(check) API Hero Ready';
      this.item.tooltip = 'API Hero - open Execution view';
      return;
    }
    this.item.text = `$(sync~spin) API Hero Running (${count})`;
    const active = this.manager.listActive();
    this.item.tooltip =
      active.length === 1
        ? formatRunningTooltip(active[0]!)
        : active
            .map(
              (session) =>
                `${session.collectionName}: ${session.completed}/${session.total}`,
            )
            .join('\n');
  }
}

/**
 * Per-run notification progress only (no status bar). Bind a reporter via
 * {@link withCollectionRunProgress}.
 */
export class VsCodeCollectionRunProgress
  implements CollectionRunProgressPort, Disposable
{
  private disposed = false;
  private report:
    | ((value: { message?: string; increment?: number }) => void)
    | undefined;
  private lastReportedPercent: number | undefined;

  public bindReporter(
    report: (value: { message?: string; increment?: number }) => void,
  ): void {
    this.report = report;
    this.lastReportedPercent = undefined;
  }

  public onProgress(event: RunProgressEvent): void {
    if (this.disposed) {
      return;
    }
    const label = event.current?.label;
    const displayed =
      event.phase === 'request-started'
        ? Math.min(event.completed + 1, event.total)
        : event.completed;
    const attemptSuffix = formatAttemptSuffix(event.attempt);
    const message =
      event.phase === 'completed'
        ? `Finished ${event.completed}/${event.total}`
        : label === undefined
          ? `Running ${displayed}/${event.total}${attemptSuffix}`
          : `${displayed}/${event.total}: ${label}${attemptSuffix}`;

    const percent =
      event.total > 0 ? (displayed / event.total) * 100 : undefined;
    const increment =
      percent === undefined
        ? undefined
        : Math.max(0, percent - (this.lastReportedPercent ?? 0));
    this.lastReportedPercent =
      percent === undefined ? this.lastReportedPercent : percent;

    this.report?.({
      message,
      ...(increment !== undefined && increment > 0 ? { increment } : {}),
    });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.report = undefined;
  }
}

/** Fans progress events to a fixed set plus dynamically added ports. */
export class MultiplexCollectionRunProgress
  implements CollectionRunProgressPort
{
  private readonly fixed: readonly CollectionRunProgressPort[];
  private readonly dynamic = new Set<CollectionRunProgressPort>();

  public constructor(
    fixed: readonly CollectionRunProgressPort[] = [],
  ) {
    this.fixed = fixed;
  }

  public add(port: CollectionRunProgressPort): void {
    this.dynamic.add(port);
  }

  public remove(port: CollectionRunProgressPort): void {
    this.dynamic.delete(port);
  }

  public onProgress(event: RunProgressEvent): void {
    for (const port of this.fixed) {
      port.onProgress(event);
    }
    for (const port of this.dynamic) {
      port.onProgress(event);
    }
  }
}

/** Forwards progress only when `event.runId` matches the scoped run. */
export class RunScopedCollectionRunProgress
  implements CollectionRunProgressPort
{
  public constructor(
    private readonly runId: string,
    private readonly inner: CollectionRunProgressPort,
  ) {}

  public onProgress(event: RunProgressEvent): void {
    if (event.runId !== this.runId) {
      return;
    }
    this.inner.onProgress(event);
  }
}

/** Runs a collection task under one cancellable notification progress. */
export async function withCollectionRunProgress<T>(
  title: string,
  progressUi: VsCodeCollectionRunProgress,
  task: (signal: AbortSignal) => Promise<T>,
  abortController?: AbortController,
): Promise<T> {
  return window.withProgress(
    {
      location: ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (progress, token) => {
      progressUi.bindReporter((value) => progress.report(value));
      const controller = abortController ?? new AbortController();
      const cancellation = token.onCancellationRequested(() =>
        controller.abort('cancelled'),
      );
      if (token.isCancellationRequested) {
        controller.abort('cancelled');
      }
      try {
        return await task(controller.signal);
      } finally {
        cancellation.dispose();
        progressUi.bindReporter(() => undefined);
      }
    },
  );
}

/** Builds a secret-free completion message for notifications. */
export function formatRunSummaryMessage(summary: RunSummary): string {
  const { statistics: stats, plan, status } = summary;
  const name = plan.collectionName;
  const verb =
    status === 'cancelled'
      ? 'cancelled'
      : status === 'stopped'
        ? 'stopped'
        : 'finished';
  const assertionPart =
    stats.assertionsTotal > 0
      ? ` Assertions ${stats.assertionsPassed}/${stats.assertionsTotal} passed.`
      : '';
  return (
    `Collection run ${verb} for "${name}": ` +
    `${stats.passed} passed, ${stats.failed} failed, ` +
    `${stats.skipped} skipped, ${stats.cancelled} cancelled ` +
    `(${formatDuration(stats.durationMs)}, avg ${formatDuration(stats.averageResponseTimeMs)}).` +
    assertionPart
  );
}

function formatRunningTooltip(session: {
  readonly collectionName: string;
  readonly current?: { readonly label: string };
  readonly lastProgress?: {
    readonly phase: string;
    readonly attempt?: import('../models').RunProgressAttempt;
  };
  readonly completed: number;
  readonly total: number;
  readonly elapsedMs: number;
}): string {
  const current =
    session.current?.label !== undefined && session.current.label.length > 0
      ? session.current.label
      : 'Starting...';
  const displayed =
    session.lastProgress?.phase === 'request-started'
      ? Math.min(session.completed + 1, session.total)
      : session.completed;
  const attemptLine = formatAttemptLabel(session.lastProgress?.attempt);
  return [
    session.collectionName,
    `Request: ${current}`,
    ...(attemptLine === undefined ? [] : [`Attempt: ${attemptLine}`]),
    `Progress: ${displayed} / ${session.total}`,
    `Elapsed: ${formatDuration(session.elapsedMs)}`,
  ].join('\n');
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms} ms`;
  }
  return `${(ms / 1_000).toFixed(1)} s`;
}

export function formatUnexpectedFailMessage(
  session: { readonly collectionName?: string } | undefined,
  fallbackMessage?: string,
): string {
  const name = session?.collectionName ?? 'collection';
  const detail =
    fallbackMessage !== undefined && fallbackMessage.trim().length > 0
      ? (' ' + fallbackMessage.trim())
      : '';
  return 'API Hero could not complete the collection run for "' + name + '".' + detail;
}
