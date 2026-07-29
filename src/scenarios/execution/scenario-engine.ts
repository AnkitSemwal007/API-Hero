import type { VariableDefinition } from '../../models';
import type { VariableResolver } from '../../variables';
import { InMemoryRunVariableStore } from '../../variables';
import type { CollectionRequestExecutorPort } from '../../collection-runner';
import type { ScenarioExecutionLogger } from './execution-context';
import type { ScenarioEventEmitter } from '../events/scenario-events';

import {
  ScenarioEventType,
  type ScenarioCancelledEvent,
  type ScenarioCompletedEvent,
  type ScenarioFailedEvent,
  type ScenarioStartedEvent,
  type StepCompletedEvent,
  type StepFailedEvent,
  type StepRetriedEvent,
  type StepSkippedEvent,
  type StepStartedEvent,
} from '../events/scenario-events';

import type {
  Scenario,
  ScenarioRunId,
  ScenarioRunResult,
  ScenarioRunStatus,
  StepId,
  StepRunResult,
  StepRunStatus,
  RetryPolicy,
} from '../models';
import {
  createScenarioRunId,
  StepRunStatus as StepRunStates,
  ScenarioRunStatus as ScenarioRunStates,
} from '../models';
import { validateScenario } from '../validation/scenario-validator';
import { buildControlFlowGraph } from '../graph/control-flow-graph';

import type { ScenarioExecutionContext as ScenarioExecutionContextType } from './execution-context';

import { DefaultScenarioStepRegistry } from './step-registry';
import type { ScenarioStepRunnerExecutionResult } from './step-registry';

import { RequestStepRunner } from './step-runners/request-step-runner';
import { DelayStepRunner } from './step-runners/delay-step-runner';
import { ConditionStepRunner } from './step-runners/condition-step-runner';
import { VariableStepRunner } from './step-runners/variable-step-runner';
import { GroupStepRunner } from './step-runners/group-step-runner';

import { createScenarioVariableResolver } from '../variables/scenario-variable-resolver';

import type { ExecutionReport } from '../report/execution-report';
import { buildExecutionReport } from '../report/execution-report';

export interface ScenarioEnginePorts {
  readonly executor: CollectionRequestExecutorPort;
  readonly sourceReader: { readText(filePath: string): Promise<string> };
  readonly externalVariableResolver: VariableResolver;
  readonly externalVariableDefinitions: readonly VariableDefinition[];
  readonly fileExists: (filePath: string) => boolean | Promise<boolean>;
  readonly logger: ScenarioExecutionLogger;
  readonly eventEmitter?: ScenarioEventEmitter;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /**
   * Optional hooks so the VS Code layer can activate the composite variable
   * writer's run store for `@extract` during the scenario run.
   */
  readonly onRunStoreBegin?: (runId: string, store: InMemoryRunVariableStore) => void;
  readonly onRunStoreEnd?: (runId: string) => void;
}

export interface RunScenarioOptions {
  readonly signal?: AbortSignal;
}

export interface RunScenarioResult {
  readonly run: ScenarioRunResult;
  readonly report: ExecutionReport;
}

function defaultNow(): number {
  return Date.now();
}

function sleepMs(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(new Error('aborted'));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function resolveFailurePolicyStop(failurePolicy: string, step: { retryPolicy?: RetryPolicy }): boolean {
  const stopByPolicy =
    failurePolicy === 'stop-on-first-error' ||
    failurePolicy === 'stop-on-failure';
  const stopByRetry = step.retryPolicy?.stopOnFailure ?? false;
  return stopByPolicy || stopByRetry;
}

function mergeSignalWithTimeout(signal: AbortSignal, timeoutMs: number): AbortSignal {
  if (timeoutMs <= 0) return signal;
  if (timeoutMs === Number.POSITIVE_INFINITY) return signal;

  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal.reason ?? 'cancelled');
  signal.addEventListener('abort', onAbort, { once: true });

  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);

  controller.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    },
    { once: true },
  );

  return controller.signal;
}

/**
 * Orchestrates one scenario execution.
 */
export class ScenarioEngine {
  public constructor(private readonly ports: ScenarioEnginePorts) {}

  public async runScenario(scenario: Scenario, options: RunScenarioOptions = {}): Promise<RunScenarioResult> {
    const now = this.ports.now ?? defaultNow;
    const sleep = this.ports.sleep ?? sleepMs;

    const validation = await validateScenario(scenario, { fileExists: this.ports.fileExists });
    if (!validation.ok) {
      throw new Error(`Scenario validation failed: ${validation.errors[0]?.message ?? 'unknown error'}`);
    }

    const controlFlow = buildControlFlowGraph(scenario);
    const entryStepId = controlFlow.entryStepId;
    if (entryStepId === undefined) {
      throw new Error('Scenario must have a unique entry step after validation.');
    }

    const runId: ScenarioRunId = createScenarioRunId();
    const startTime = now();

    const externalSignal = options.signal ?? new AbortController().signal;
    const timeoutMs = scenario.executionSettings.timeoutMs;
    const signal = timeoutMs === undefined
      ? externalSignal
      : mergeSignalWithTimeout(externalSignal, timeoutMs);

    const runStore = new InMemoryRunVariableStore();
    const variables = new Map<string, string>();
    for (const variable of scenario.variables) {
      if (variable.defaultValue === undefined) continue;
      variables.set(variable.name, variable.defaultValue);
      runStore.set(variable.name, variable.defaultValue, variable.sensitive);
    }
    this.ports.onRunStoreBegin?.(runId, runStore);

    const context: ScenarioExecutionContextType = {
      runId,
      scenario,
      variables,
      outputs: new Map<StepId, Map<string, string>>(),
      signal,
      logger: this.ports.logger,
      timeline: [],
      startTime,
      runStore,
    };

    try {
      return await this.executeValidatedScenario({
        scenario,
        context,
        controlFlow,
        runId,
        startTime,
        now,
        sleep,
      });
    } finally {
      this.ports.onRunStoreEnd?.(runId);
    }
  }

  private async executeValidatedScenario(options: {
    readonly scenario: Scenario;
    readonly context: ScenarioExecutionContextType;
    readonly controlFlow: ReturnType<typeof buildControlFlowGraph>;
    readonly runId: ScenarioRunId;
    readonly startTime: number;
    readonly now: () => number;
    readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  }): Promise<RunScenarioResult> {
    const { scenario, context, controlFlow, runId, startTime, now, sleep } = options;

    const scenarioVariableResolver = createScenarioVariableResolver({
      scenario,
      externalVariableResolver: this.ports.externalVariableResolver,
      externalVariableDefinitions: this.ports.externalVariableDefinitions,
    });

    const registry = new DefaultScenarioStepRegistry();
    registry.register(
      new RequestStepRunner({
        executor: this.ports.executor,
        sourceReader: this.ports.sourceReader,
        scenarioVariableResolver,
        now,
        sleep,
      }),
    );
    registry.register(new DelayStepRunner({ now, sleep }));
    registry.register(new ConditionStepRunner({ now, scenarioVariableResolver }));
    registry.register(new VariableStepRunner({ now, scenarioVariableResolver }));
    registry.register(new GroupStepRunner({ now }));

    const stepById = new Map(scenario.steps.map((s) => [s.id, s]));

    const outgoingByStepId = new Map<StepId, { readonly connectionId: string; readonly toStepId: StepId }[]>();
    for (const connection of scenario.connections) {
      const list = outgoingByStepId.get(connection.fromStepId) ?? [];
      list.push({ connectionId: connection.id, toStepId: connection.toStepId });
      outgoingByStepId.set(connection.fromStepId, list);
    }
    const connectionById = new Map<string, { readonly connectionId: string; readonly toStepId: StepId }>();
    for (const out of outgoingByStepId.values()) {
      for (const entry of out) connectionById.set(entry.connectionId, entry);
    }

    const emitScenarioStarted = (): void => {
      const payload: ScenarioStartedEvent = {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        runId,
        startTime,
      };
      this.ports.eventEmitter?.emit(ScenarioEventType.ScenarioStarted, payload);
    };
    const emitScenarioCompleted = (status: ScenarioRunStatus): void => {
      const endTime = now();
      const payload: ScenarioCompletedEvent = {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        runId,
        status,
        endTime,
        durationMs: endTime - startTime,
      };
      this.ports.eventEmitter?.emit(ScenarioEventType.ScenarioCompleted, payload);
    };
    const emitScenarioFailed = (error?: { readonly message: string; readonly cause?: unknown }): void => {
      const endTime = now();
      const payload: ScenarioFailedEvent = {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        runId,
        status: ScenarioRunStates.Failed,
        endTime,
        durationMs: endTime - startTime,
        ...(error === undefined ? {} : { error }),
      };
      this.ports.eventEmitter?.emit(ScenarioEventType.ScenarioFailed, payload);
    };
    const emitScenarioCancelled = (): void => {
      const endTime = now();
      const payload: ScenarioCancelledEvent = {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        runId,
        status: ScenarioRunStates.Cancelled,
        endTime,
        durationMs: endTime - startTime,
      };
      this.ports.eventEmitter?.emit(ScenarioEventType.ScenarioCancelled, payload);
    };

    const emitStepStarted = (stepId: StepId, stepName: string, attempt: number, timestamp: number): void => {
      const payload: StepStartedEvent = { runId, stepId, stepName, attempt, startTime: timestamp };
      this.ports.eventEmitter?.emit(ScenarioEventType.StepStarted, payload);
    };
    const emitStepCompleted = (stepResult: StepRunResult, timestamp: number): void => {
      const payload: StepCompletedEvent = {
        runId,
        stepId: stepResult.stepId,
        stepName: stepResult.stepName,
        attempt: stepResult.attempt,
        status: stepResult.status === 'skipped' ? 'skipped' : 'completed',
        endTime: timestamp,
        durationMs: stepResult.durationMs,
      };
      this.ports.eventEmitter?.emit(ScenarioEventType.StepCompleted, payload);
    };
    const emitStepFailed = (stepResult: StepRunResult): void => {
      const errorPayload = stepResult.error ?? { message: 'Step failed.' };
      const payload: StepFailedEvent = {
        runId,
        stepId: stepResult.stepId,
        stepName: stepResult.stepName,
        attempt: stepResult.attempt,
        status: StepRunStates.Failed,
        endTime: stepResult.endTime,
        durationMs: stepResult.durationMs,
        error: errorPayload,
      };
      this.ports.eventEmitter?.emit(ScenarioEventType.StepFailed, payload);
    };
    const emitStepSkipped = (stepResult: StepRunResult): void => {
      const payload: StepSkippedEvent = {
        runId,
        stepId: stepResult.stepId,
        stepName: stepResult.stepName,
        timestamp: stepResult.endTime,
        reason: stepResult.error?.message,
      };
      this.ports.eventEmitter?.emit(ScenarioEventType.StepSkipped, payload);
    };
    const emitStepRetried = (step: { retryPolicy?: RetryPolicy }, stepResult: StepRunResult, timestamp: number): void => {
      const policy = step.retryPolicy;
      const maxAttempts = (policy?.maxRetries ?? 0) + 1;
      if (stepResult.attempt <= 1) return;
      const payload: StepRetriedEvent = {
        runId,
        stepId: stepResult.stepId,
        stepName: stepResult.stepName,
        attempt: stepResult.attempt,
        maxAttempts,
        timestamp,
      };
      this.ports.eventEmitter?.emit(ScenarioEventType.StepRetried, payload);
    };

    emitScenarioStarted();

    const active = new Set<StepId>();
    active.add(entryStepId);
    const executed = new Set<StepId>();
    const stepResults: StepRunResult[] = [];

    let stopOnFailure = false;
    let cancelled = false;
    let failedError: { readonly message: string; readonly cause?: unknown } | undefined;

    const failurePolicy = scenario.executionSettings.failurePolicy;

    for (const stepId of controlFlow.executionOrder) {
      const step = stepById.get(stepId);
      if (step === undefined) continue;

      if (!active.has(stepId)) {
        const timestamp = now();
        const result: StepRunResult = {
          stepId,
          stepName: step.name,
          status: StepRunStates.Skipped,
          startTime: timestamp,
          endTime: timestamp,
          durationMs: 0,
          attempt: 0,
        };
        executed.add(stepId);
        stepResults.push(result);
        context.timeline.push({
          timestamp,
          stepId,
          stepName: step.name,
          event: 'skipped',
          message: result.error?.message,
        });
        emitStepSkipped(result);
        continue;
      }

      if (cancelled || stopOnFailure) {
        // Remaining active nodes are resolved after the loop.
        continue;
      }

      if (context.signal.aborted) {
        cancelled = true;
        const timestamp = now();
        const result: StepRunResult = {
          stepId,
          stepName: step.name,
          status: StepRunStates.Cancelled,
          startTime: timestamp,
          endTime: timestamp,
          durationMs: 0,
          attempt: 0,
        };
        executed.add(stepId);
        stepResults.push(result);
        context.timeline.push({
          timestamp,
          stepId,
          stepName: step.name,
          event: 'failed',
          message: 'Scenario cancelled.',
        });
        break;
      }

      const runner = registry.get(step.type);
      const startedAt = now();
      context.timeline.push({
        timestamp: startedAt,
        stepId,
        stepName: step.name,
        event: 'started',
      });
      emitStepStarted(stepId, step.name, 1, startedAt);

      const runnerResult: ScenarioStepRunnerExecutionResult = await runner.run(step, context);
      const stepResult = runnerResult.stepResult;
      executed.add(stepId);
      stepResults.push(stepResult);

      // Retries: emit once when attempts > 1.
      emitStepRetried(step, stepResult, stepResult.endTime);

      if (stepResult.status === StepRunStates.Completed) {
        context.timeline.push({
          timestamp: stepResult.endTime,
          stepId,
          stepName: step.name,
          event: 'completed',
        });
        emitStepCompleted(stepResult, stepResult.endTime);
      } else if (stepResult.status === StepRunStates.Skipped) {
        context.timeline.push({
          timestamp: stepResult.endTime,
          stepId,
          stepName: step.name,
          event: 'skipped',
          message: stepResult.error?.message,
        });
        emitStepSkipped(stepResult);
      } else if (stepResult.status === StepRunStates.Cancelled) {
        context.timeline.push({
          timestamp: stepResult.endTime,
          stepId,
          stepName: step.name,
          event: 'failed',
          message: 'Step cancelled.',
        });
        cancelled = true;
        break;
      } else if (stepResult.status === StepRunStates.Failed) {
        context.timeline.push({
          timestamp: stepResult.endTime,
          stepId,
          stepName: step.name,
          event: 'failed',
          message: stepResult.error?.message,
        });
        emitStepFailed(stepResult);
        stopOnFailure = resolveFailurePolicyStop(failurePolicy, step);
        failedError = stepResult.error;
        if (stopOnFailure) {
          break;
        }
      }

      // Activate successors only for completed steps.
      if (stepResult.status === StepRunStates.Completed) {
        const outgoing = outgoingByStepId.get(stepId) ?? [];
        const chosenConnectionIds = runnerResult.nextConnectionIds;
        const toActivate =
          chosenConnectionIds === undefined
            ? outgoing.map((e) => e.toStepId)
            : chosenConnectionIds
                .map((id) => connectionById.get(id)?.toStepId)
                .filter((v): v is StepId => v !== undefined);
        for (const toId of toActivate) {
          active.add(toId);
        }
      }
    }

    // Finalize run status + fill in remaining nodes.
    const endTime = now();
    const durationMs = endTime - startTime;
    const runStatus: ScenarioRunStatus = cancelled
      ? ScenarioRunStates.Cancelled
      : stopOnFailure
        ? ScenarioRunStates.Failed
        : ScenarioRunStates.Completed;

    for (const stepId of controlFlow.executionOrder) {
      if (executed.has(stepId)) continue;
      const step = stepById.get(stepId);
      if (!step) continue;

      const timestamp = now();
      const status: StepRunStatus =
        runStatus === ScenarioRunStates.Cancelled
          ? StepRunStates.Cancelled
          : StepRunStates.Skipped;

      const result: StepRunResult = {
        stepId,
        stepName: step.name,
        status,
        startTime: timestamp,
        endTime: timestamp,
        durationMs: 0,
        attempt: 0,
      };
      stepResults.push(result);
      context.timeline.push({
        timestamp,
        stepId,
        stepName: step.name,
        event: status === StepRunStates.Cancelled ? 'failed' : 'skipped',
        message: undefined,
      });
    }

    const run: ScenarioRunResult = {
      runId,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      status: runStatus,
      startTime,
      endTime,
      durationMs,
      stepResults,
      variables: new Map(context.variables),
      timeline: [...context.timeline],
    };

    const report = buildExecutionReport(scenario, run);

    if (runStatus === ScenarioRunStates.Completed) {
      emitScenarioCompleted(runStatus);
    } else if (runStatus === ScenarioRunStates.Failed) {
      emitScenarioFailed(
        failedError === undefined
          ? undefined
          : { message: failedError.message, cause: failedError.cause },
      );
    } else {
      emitScenarioCancelled();
    }

    return { run, report };
  }
}

