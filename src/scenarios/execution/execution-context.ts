import type {
  Scenario,
  ScenarioRunId,
  StepId,
  TimelineEntry,
} from '../models';
import type { RunVariableStore } from '../../variables';

/**
 * Framework-neutral logger surface for scenario execution.
 * Adapter implementations can bridge to extension logger / output channel.
 */
export interface ScenarioExecutionLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warning(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, cause?: unknown, context?: Readonly<Record<string, unknown>>): void;
  debug(message: string, context?: Readonly<Record<string, unknown>>): void;
}

/** Last HTTP response snapshot for condition expressions (secret-safe). */
export interface ScenarioLastResponseSnapshot {
  readonly statusCode?: number;
  /** Header values keyed by lowercase name. */
  readonly headers: ReadonlyMap<string, string>;
}

/**
 * Shared runtime state for step execution.
 * Mutable fields are `variables`, `outputs`, `timeline`, and `lastResponse`.
 */
export interface ScenarioExecutionContext {
  readonly runId: ScenarioRunId;
  readonly scenario: Scenario;
  readonly variables: Map<string, string>;
  readonly outputs: Map<StepId, Map<string, string>>;
  readonly signal: AbortSignal;
  readonly logger: ScenarioExecutionLogger;
  readonly timeline: TimelineEntry[];
  readonly startTime: number;
  /** Updated after each successful request step for condition evaluation. */
  lastResponse?: ScenarioLastResponseSnapshot;
  /**
   * Optional run-scoped store shared with the request execution pipeline so
   * `@extract` writes become visible to subsequent scenario steps.
   */
  readonly runStore?: RunVariableStore;
}

