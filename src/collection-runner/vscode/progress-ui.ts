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
  private lastReportedPercent: number | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor() {
    this.item = window.createStatusBarItem(StatusBarAlignment.Left, 99);
    this.item.name = 'API Hero Collection Run';
  }

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
    // Align the displayed request index with the progress bar:
    // request-started uses completed+1 (in flight); finished/completed use completed.
    const displayed =
      event.phase === 'request-started'
        ? Math.min(event.completed + 1, event.total)
        : event.completed;
    const message =
      event.phase === 'completed'
        ? `Finished ${event.completed}/${event.total}`
        : label === undefined
          ? `Running ${displayed}/${event.total}`
          : `${displayed}/${event.total}: ${label}`;

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
    this.item.text = `$(sync~spin) API Hero: ${message}`;
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
        ? `$(error) API Hero: ${text}`
        : `$(check) API Hero: ${text}`;
    this.item.tooltip =
      `Collection run finished in ${formatDuration(stats.durationMs)}. ` +
      `Average ${formatDuration(stats.averageResponseTimeMs)}. ` +
      'See the Collection Run Report panel for per-request details.';
    this.item.show();
  }

  public hideSoon(delayMs = 5_000): void {
    if (this.hideTimer !== undefined) {
      clearTimeout(this.hideTimer);
    }
    this.hideTimer = setTimeout(() => {
      this.hideTimer = undefined;
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
    if (this.hideTimer !== undefined) {
      clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
    }
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
