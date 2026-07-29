import type {
  Scenario,
  ScenarioRunResult,
  StepRunResult,
  TimelineEntry,
} from '../models';

import { MASKED_VARIABLE_VALUE } from '../../variables';

export interface ExecutionReportStatistics {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly cancelled: number;
  readonly durationMs: number;
}

export interface ExecutionReportVariableSnapshot {
  readonly name: string;
  readonly value: string;
  readonly sensitive: boolean;
  readonly displayValue: string;
}

export interface ExecutionReportStepDetails {
  readonly stepId: string;
  readonly stepName: string;
  readonly status: StepRunResult['status'];
  readonly attempt: number;
  readonly durationMs: number;
  readonly error?: { readonly message: string; readonly cause?: unknown };
  readonly outputs?: readonly { readonly name: string; readonly value: string }[];
}

export interface ExecutionReport {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly runId: string;
  readonly status: ScenarioRunResult['status'];
  readonly startTime: number;
  readonly endTime: number;
  readonly durationMs: number;
  readonly statistics: ExecutionReportStatistics;
  readonly timeline: readonly TimelineEntry[];
  readonly stepResults: readonly ExecutionReportStepDetails[];
  readonly variables: readonly ExecutionReportVariableSnapshot[];
}

function snapshotVariables(
  scenario: Scenario,
  run: ScenarioRunResult,
): readonly ExecutionReportVariableSnapshot[] {
  const sensitiveByName = new Map<string, boolean>(
    scenario.variables.map((v) => [v.name, v.sensitive]),
  );
  const keys = [...run.variables.keys()].sort((a, b) => a.localeCompare(b));
  return keys.map((name) => {
    const value = run.variables.get(name) ?? '';
    const sensitive = sensitiveByName.get(name) ?? false;
    const safeValue = sensitive ? MASKED_VARIABLE_VALUE : value;
    return {
      name,
      // Never keep cleartext for sensitive variables in report snapshots.
      value: safeValue,
      sensitive,
      displayValue: safeValue,
    };
  });
}

function mapStep(
  step: StepRunResult,
  sensitiveNames: ReadonlySet<string>,
): ExecutionReportStepDetails {
  const outputs =
    step.outputs === undefined
      ? undefined
      : step.outputs.map((output) => {
          const sensitive =
            sensitiveNames.has(output.name) ||
            sensitiveNames.has(`${step.stepName}.${output.name}`);
          return {
            name: output.name,
            value: sensitive ? MASKED_VARIABLE_VALUE : output.value,
          };
        });
  return {
    stepId: step.stepId,
    stepName: step.stepName,
    status: step.status,
    attempt: step.attempt,
    durationMs: step.durationMs,
    ...(step.error === undefined ? {} : { error: step.error }),
    ...(outputs === undefined ? {} : { outputs }),
  };
}

/**
 * Builds a report model from a finished (or cancelled) scenario run.
 */
export function buildExecutionReport(
  scenario: Scenario,
  run: ScenarioRunResult,
): ExecutionReport {
  const total = run.stepResults.length;
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let cancelled = 0;
  for (const step of run.stepResults) {
    switch (step.status) {
      case 'completed':
        completed += 1;
        break;
      case 'failed':
        failed += 1;
        break;
      case 'skipped':
        skipped += 1;
        break;
      case 'cancelled':
        cancelled += 1;
        break;
    }
  }

  const statistics: ExecutionReportStatistics = {
    total,
    completed,
    failed,
    skipped,
    cancelled,
    durationMs: run.durationMs,
  };

  const sensitiveNames = new Set(
    scenario.variables.filter((v) => v.sensitive).map((v) => v.name),
  );

  return {
    scenarioId: run.scenarioId,
    scenarioName: run.scenarioName,
    runId: run.runId,
    status: run.status,
    startTime: run.startTime,
    endTime: run.endTime,
    durationMs: run.durationMs,
    statistics,
    timeline: [...run.timeline],
    stepResults: run.stepResults.map((step) => mapStep(step, sensitiveNames)),
    variables: snapshotVariables(scenario, run),
  };
}

