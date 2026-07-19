/** Destination accepted by the centralized logger. */
export interface LogSink {
  appendLine(message: string): void;
}

/** Structured context attached to a log entry. */
export type LogContext = Readonly<Record<string, unknown>>;

/** Centralized, framework-neutral application logger. */
export class Logger {
  public constructor(private readonly sink: LogSink) {}

  /** Writes an informational message. */
  public info(message: string, context?: LogContext): void {
    this.write('INFO', message, context);
  }

  /** Writes a warning message. */
  public warning(message: string, context?: LogContext): void {
    this.write('WARNING', message, context);
  }

  /** Writes an error message and optional cause. */
  public error(message: string, error?: unknown, context?: LogContext): void {
    this.write('ERROR', message, { ...context, error });
  }

  /** Writes a diagnostic message. */
  public debug(message: string, context?: LogContext): void {
    this.write('DEBUG', message, context);
  }

  private write(
    level: string,
    message: string,
    context?: LogContext,
  ): void {
    const details = context === undefined ? '' : ` ${this.serialize(context)}`;
    this.sink.appendLine(
      `${new Date().toISOString()} [${level}] ${message}${details}`,
    );
  }

  private serialize(context: LogContext): string {
    try {
      return JSON.stringify(context);
    } catch {
      return '[unserializable context]';
    }
  }
}
