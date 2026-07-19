import type { OutputChannel } from 'vscode';

import type { LogSink } from '../shared/logging';

/** Adapts a VS Code output channel to the framework-neutral logging sink. */
export class VsCodeLogSink implements LogSink {
  public constructor(private readonly outputChannel: OutputChannel) {}

  /** Appends one complete message to the output channel. */
  public appendLine(message: string): void {
    this.outputChannel.appendLine(message);
  }
}
