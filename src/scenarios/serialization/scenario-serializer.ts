import type { Connection, Scenario, StepUnion } from '../models';
import { ScenarioSchemaVersion as CURRENT_VERSION } from '../models';

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => sortDeep(v));
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => [key, sortDeep(record[key])] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

function serializeStep(step: StepUnion): unknown {
  // Preserve insertion order for root step objects by building a stable
  // normalized object first, then deep-sorting keys recursively.
  const base = {
    id: step.id,
    type: step.type,
    name: step.name,
    ...(step.description === undefined ? {} : { description: step.description }),
    ...(step.position === undefined ? {} : { position: step.position }),
    ...(step.retryPolicy === undefined ? {} : { retryPolicy: step.retryPolicy }),
    ...(step.outputs === undefined ? {} : { outputs: step.outputs }),
  } as const;

  // Step-specific fields are required for re-validation + execution after
  // loading from `.scenario.json` sidecars.
  const expanded =
    step.type === 'request'
      ? {
          ...base,
          requestId: step.requestId,
          requestFilePath: step.requestFilePath,
          requestOffset: step.requestOffset,
          inputMappings: step.inputMappings,
          ...(step.requestRef === undefined ? {} : { requestRef: step.requestRef }),
        }
      : step.type === 'delay'
        ? {
            ...base,
            durationMs: step.durationMs,
          }
        : step.type === 'condition'
          ? {
              ...base,
              ...(step.condition === undefined ? {} : { condition: step.condition }),
              ...(step.expression === undefined ? {} : { expression: step.expression }),
              trueBranch: step.trueBranch,
              falseBranch: step.falseBranch,
            }
          : step.type === 'variable'
            ? {
                ...base,
                assignments: step.assignments,
              }
            : step.type === 'group'
              ? {
                  ...base,
                  stepIds: step.stepIds,
                }
              : base;

  return sortDeep(expanded);
}

function serializeConnection(connection: Connection): unknown {
  return sortDeep({
    id: connection.id,
    fromStepId: connection.fromStepId,
    toStepId: connection.toStepId,
    ...(connection.condition === undefined ? {} : { condition: connection.condition }),
  });
}

/**
 * Builds deterministic JSON for a {@link Scenario}.
 * - schemaVersion is the first key
 * - steps are sorted by id
 * - connections are sorted by id
 * - nested objects have stable key ordering
 */
export function serializeScenario(scenario: Scenario): string {
  const stepsSorted = [...scenario.steps].sort((a, b) => a.id.localeCompare(b.id));
  const connectionsSorted = [...scenario.connections].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const normalized = {
    schemaVersion: CURRENT_VERSION,
    id: scenario.id,
    name: scenario.name,
    ...(scenario.description === undefined ? {} : { description: scenario.description }),
    variables: sortDeep(scenario.variables),
    steps: sortDeep(stepsSorted.map((s) => serializeStep(s))),
    connections: sortDeep(connectionsSorted.map((c) => serializeConnection(c))),
    executionSettings: sortDeep(scenario.executionSettings),
    metadata: sortDeep(scenario.metadata),
  };

  return JSON.stringify(normalized, undefined, 2) + '\n';
}

