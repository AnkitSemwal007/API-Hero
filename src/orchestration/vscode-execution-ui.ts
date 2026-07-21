import type { StatusBarItem } from 'vscode';
import {
  ProgressLocation,
  StatusBarAlignment,
  ThemeColor,
  window,
} from 'vscode';

import type {
  ExecutionNotificationSink,
  ExecutionProgressRunner,
  ExecutionStatus,
  ExecutionStatusPresenter,
} from './execution-orchestrator';

const IDLE_DELAY_MS = 3_000;

/** Runs orchestration work in VS Code's cancellable notification progress UI. */
export class VsCodeExecutionProgressRunner implements ExecutionProgressRunner {
  public run<T>(
    task: (
      signal: AbortSignal,
      reporter: { report(message: string): void },
    ) => Promise<T>,
  ): Promise<T> {
    return Promise.resolve(window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'API Hero',
        cancellable: true,
      },
      async (progress, token) => {
        const controller = new AbortController();
        const cancellation = token.onCancellationRequested(() =>
          controller.abort('cancelled'),
        );
        if (token.isCancellationRequested) {
          controller.abort('cancelled');
        }
        try {
          return await task(controller.signal, {
            report: (message) => progress.report({ message }),
          });
        } finally {
          cancellation.dispose();
        }
      },
    ));
  }
}

/** Displays safe orchestration failures without exposing native errors. */
export class VsCodeExecutionNotificationSink
implements ExecutionNotificationSink {
  public error(message: string): void {
    void window.showErrorMessage(message);
  }
}

/** Owns the single request-execution status item and its idle timer. */
export class VsCodeExecutionStatusPresenter
implements ExecutionStatusPresenter {
  private readonly item: StatusBarItem;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  public constructor() {
    this.item = window.createStatusBarItem(StatusBarAlignment.Left, 100);
    this.item.name = 'API Hero Request Status';
  }

  public update(status: ExecutionStatus): void {
    if (this.disposed) {
      return;
    }
    this.clearIdleTimer();
    this.item.backgroundColor = undefined;
    switch (status.kind) {
      case 'idle':
        this.item.hide();
        return;
      case 'running':
        this.item.text = '$(sync~spin) API Hero: Running…';
        this.item.tooltip = 'API Hero is executing the selected request.';
        this.item.show();
        return;
      case 'success':
        this.item.text = `$(check) API Hero: Success (${status.statusCode})`;
        this.item.tooltip = `Request completed with HTTP status ${status.statusCode}.`;
        break;
      case 'failed':
        this.item.text = '$(error) API Hero: Failed';
        this.item.tooltip = 'The selected request failed.';
        this.item.backgroundColor = new ThemeColor(
          'statusBarItem.errorBackground',
        );
        break;
      case 'cancelled':
        this.item.text = '$(circle-slash) API Hero: Cancelled';
        this.item.tooltip = 'The selected request was cancelled.';
        break;
    }
    this.item.show();
    this.idleTimer = setTimeout(() => this.update({ kind: 'idle' }), IDLE_DELAY_MS);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearIdleTimer();
    this.item.dispose();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }
}
