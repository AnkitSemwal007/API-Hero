import type {
  ScenarioId,
  ScenarioRunId,
  StepId,
  ScenarioRunStatus,
} from '../models';

/** Minimal dispose handle for event subscriptions (framework-free). */
export interface Disposable {
  dispose(): void;
}

/**
 * Event types emitted by {@link ScenarioEventEmitter}.
 */
export const ScenarioEventType = {
  ScenarioStarted: 'scenario-started',
  ScenarioCompleted: 'scenario-completed',
  ScenarioFailed: 'scenario-failed',
  ScenarioCancelled: 'scenario-cancelled',
  StepStarted: 'step-started',
  StepCompleted: 'step-completed',
  StepFailed: 'step-failed',
  StepRetried: 'step-retried',
  StepSkipped: 'step-skipped',
} as const;

export type ScenarioEventType =
  (typeof ScenarioEventType)[keyof typeof ScenarioEventType];

export interface ScenarioStartedEvent {
  readonly scenarioId: ScenarioId;
  readonly scenarioName: string;
  readonly runId: ScenarioRunId;
  readonly startTime: number;
}

export interface ScenarioCompletedEvent {
  readonly scenarioId: ScenarioId;
  readonly scenarioName: string;
  readonly runId: ScenarioRunId;
  readonly status: ScenarioRunStatus;
  readonly endTime: number;
  readonly durationMs: number;
}

export interface ScenarioFailedEvent extends ScenarioCompletedEvent {
  readonly status: 'failed';
  readonly error?: { readonly message: string; readonly cause?: unknown };
}

export interface ScenarioCancelledEvent extends ScenarioCompletedEvent {
  readonly status: 'cancelled';
}

export interface StepStartedEvent {
  readonly runId: ScenarioRunId;
  readonly stepId: StepId;
  readonly stepName: string;
  readonly attempt: number;
  readonly startTime: number;
}

export interface StepCompletedEvent {
  readonly runId: ScenarioRunId;
  readonly stepId: StepId;
  readonly stepName: string;
  readonly attempt: number;
  readonly status: 'completed' | 'skipped';
  readonly endTime: number;
  readonly durationMs: number;
}

export interface StepFailedEvent {
  readonly runId: ScenarioRunId;
  readonly stepId: StepId;
  readonly stepName: string;
  readonly attempt: number;
  readonly status: 'failed';
  readonly endTime: number;
  readonly durationMs: number;
  readonly error: { readonly message: string; readonly cause?: unknown };
}

export interface StepRetriedEvent {
  readonly runId: ScenarioRunId;
  readonly stepId: StepId;
  readonly stepName: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly timestamp: number;
}

export interface StepSkippedEvent {
  readonly runId: ScenarioRunId;
  readonly stepId: StepId;
  readonly stepName: string;
  readonly timestamp: number;
  readonly reason?: string;
}

type AnyListener = (payload: unknown) => void;

function addListener(
  listeners: Set<AnyListener>,
  listener: AnyListener,
): { dispose(): void } {
  listeners.add(listener);
  return {
    dispose(): void {
      listeners.delete(listener);
    },
  };
}

export interface ScenarioEventEmitterPorts {
  onScenarioStarted(listener: (event: ScenarioStartedEvent) => void): Disposable;
  onScenarioCompleted(listener: (event: ScenarioCompletedEvent) => void): Disposable;
  onScenarioFailed(listener: (event: ScenarioFailedEvent) => void): Disposable;
  onScenarioCancelled(listener: (event: ScenarioCancelledEvent) => void): Disposable;
  onStepStarted(listener: (event: StepStartedEvent) => void): Disposable;
  onStepCompleted(listener: (event: StepCompletedEvent) => void): Disposable;
  onStepFailed(listener: (event: StepFailedEvent) => void): Disposable;
  onStepRetried(listener: (event: StepRetriedEvent) => void): Disposable;
  onStepSkipped(listener: (event: StepSkippedEvent) => void): Disposable;
}

/**
 * Framework-free typed emitter for scenario lifecycle events.
 * Uses a per-event-type listener set similar to `vscode.EventEmitter`.
 */
export class ScenarioEventEmitter implements ScenarioEventEmitterPorts {
  private readonly byType = new Map<ScenarioEventType, Set<AnyListener>>();

  private listenersFor(type: ScenarioEventType): Set<AnyListener> {
    const existing = this.byType.get(type);
    if (existing !== undefined) return existing;
    const created = new Set<AnyListener>();
    this.byType.set(type, created);
    return created;
  }

  public onScenarioStarted(
    listener: (event: ScenarioStartedEvent) => void,
  ): Disposable {
    return addListener(
      this.listenersFor(ScenarioEventType.ScenarioStarted),
      listener as AnyListener,
    );
  }

  public onScenarioCompleted(
    listener: (event: ScenarioCompletedEvent) => void,
  ): Disposable {
    return addListener(
      this.listenersFor(ScenarioEventType.ScenarioCompleted),
      listener as AnyListener,
    );
  }

  public onScenarioFailed(
    listener: (event: ScenarioFailedEvent) => void,
  ): Disposable {
    return addListener(
      this.listenersFor(ScenarioEventType.ScenarioFailed),
      listener as AnyListener,
    );
  }

  public onScenarioCancelled(
    listener: (event: ScenarioCancelledEvent) => void,
  ): Disposable {
    return addListener(
      this.listenersFor(ScenarioEventType.ScenarioCancelled),
      listener as AnyListener,
    );
  }

  public onStepStarted(
    listener: (event: StepStartedEvent) => void,
  ): Disposable {
    return addListener(
      this.listenersFor(ScenarioEventType.StepStarted),
      listener as AnyListener,
    );
  }

  public onStepCompleted(
    listener: (event: StepCompletedEvent) => void,
  ): Disposable {
    return addListener(
      this.listenersFor(ScenarioEventType.StepCompleted),
      listener as AnyListener,
    );
  }

  public onStepFailed(
    listener: (event: StepFailedEvent) => void,
  ): Disposable {
    return addListener(
      this.listenersFor(ScenarioEventType.StepFailed),
      listener as AnyListener,
    );
  }

  public onStepRetried(
    listener: (event: StepRetriedEvent) => void,
  ): Disposable {
    return addListener(
      this.listenersFor(ScenarioEventType.StepRetried),
      listener as AnyListener,
    );
  }

  public onStepSkipped(
    listener: (event: StepSkippedEvent) => void,
  ): Disposable {
    return addListener(
      this.listenersFor(ScenarioEventType.StepSkipped),
      listener as AnyListener,
    );
  }

  /**
   * Emits one event to all registered listeners.
   * Callers must pass a payload matching the event type.
   */
  public emit<TPayload>(type: ScenarioEventType, payload: TPayload): void {
    for (const listener of this.listenersFor(type)) {
      listener(payload);
    }
  }
}

