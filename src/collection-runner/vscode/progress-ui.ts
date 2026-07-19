import {
  ProgressLocation,
  StatusBarAlignment,
  Uri,
  window,
  workspace,
  type Disposable,
  type StatusBarItem,
} from 'vscode';

import type {
  CollectionRunProgressPort,
  RunProgressEvent,
  RunSummary,
} from '../index';

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
 * Progress notification + status bar for a whole collection run.
 * Per-request response viewers stay suppressed by the runner service.
 */
export class VsCodeCollectionRunProgress
  implements CollectionRunProgressPort, Disposable
{
  private readonly item: StatusBarItem;
  private disposed = false;
  private report:
    | ((value: { message?: string; increment?: number }) => void)
    | undefined;

  public constructor() {
    this.item = window.createStatusBarItem(StatusBarAlignment.Left, 99);
    this.item.name = 'API Runner Collection Run';
  }

  public bindReporter(
    report: (value: { message?: string; increment?: number }) => void,
  ): void {
    this.report = report;
  }

  public onProgress(event: RunProgressEvent): void {
    if (this.disposed) {
      return;
    }
    const label = event.current?.label;
    const message =
      event.phase === 'completed'
        ? `Finished ${event.completed}/${event.total}`
        : label === undefined
          ? `Running ${event.completed}/${event.total}`
          : `${event.completed + 1}/${event.total}: ${label}`;

    this.report?.({ message });
    this.item.text = `$(sync~spin) API Runner: ${message}`;
    this.item.tooltip = `Elapsed ${formatDuration(event.elapsedMs)}`;
    this.item.show();
  }

  public showSummary(summary: RunSummary): void {
    if (this.disposed) {
      return;
    }
    const { statistics: stats, status } = summary;
    const assertionPart =
      stats.assertionsTotal > 0
        ? `, assertions ${stats.assertionsPassed}/${stats.assertionsTotal}`
        : '';
    const text =
      status === 'cancelled'
        ? `Cancelled — ${stats.passed} passed, ${stats.failed} failed, ${stats.skipped} skipped${assertionPart}`
        : status === 'stopped'
          ? `Stopped — ${stats.passed} passed, ${stats.failed} failed, ${stats.skipped} skipped${assertionPart}`
          : `Done — ${stats.passed} passed, ${stats.failed} failed, ${stats.skipped} skipped${assertionPart}`;
    this.item.text =
      stats.failed > 0 || stats.assertionsFailed > 0
        ? `$(error) API Runner: ${text}`
        : `$(check) API Runner: ${text}`;
    this.item.tooltip = `Collection run finished in ${formatDuration(stats.durationMs)}. Average ${formatDuration(stats.averageResponseTimeMs)}.`;
    this.item.show();
  }

  public hideSoon(delayMs = 5_000): void {
    setTimeout(() => {
      if (!this.disposed) {
        this.item.hide();
      }
    }, delayMs);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.report = undefined;
    this.item.dispose();
  }
}

/** Runs a collection task under one cancellable notification progress. */
export async function withCollectionRunProgress<T>(
  title: string,
  progressUi: VsCodeCollectionRunProgress,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return window.withProgress(
    {
      location: ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (progress, token) => {
      progressUi.bindReporter((value) => progress.report(value));
      const controller = new AbortController();
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

function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms} ms`;
  }
  return `${(ms / 1_000).toFixed(1)} s`;
}
