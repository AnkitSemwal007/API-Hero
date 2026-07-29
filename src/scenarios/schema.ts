/**
 * Structural parse/validate for scenario.json documents (schemaVersion 1.0.0).
 */

import { parseDependRef } from '../dependencies';
import { parseConditionExpression } from './condition-expression';
import {
  ScenarioSchemaVersion,
  ScenarioVariableScope,
  StepType,
  type ConditionExpression,
  type ConditionOperator,
  type Connection,
  type Scenario,
  type ScenarioVariable,
  type StepUnion,
} from './models';

export type ParseScenarioDocumentResult =
  | { readonly ok: true; readonly scenario: Scenario }
  | { readonly ok: false; readonly errors: readonly string[] };

const VARIABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePosition(
  value: unknown,
): { readonly x: number; readonly y: number } | undefined {
  if (!isRecord(value)) return undefined;
  const x = typeof value.x === 'number' ? value.x : undefined;
  const y = typeof value.y === 'number' ? value.y : undefined;
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return { x, y };
}

function parseVariables(
  value: unknown,
):
  | { readonly ok: true; readonly variables: readonly ScenarioVariable[] }
  | { readonly ok: false; readonly errors: readonly string[] } {
  if (value === undefined) return { ok: true, variables: [] };
  if (!Array.isArray(value)) {
    return { ok: false, errors: ['Scenario.variables must be an array.'] };
  }
  const variables: ScenarioVariable[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : crypto.randomUUID();
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (name.length === 0 || !VARIABLE_NAME_RE.test(name)) continue;
    if (seen.has(name)) {
      return { ok: false, errors: [`Duplicate scenario variable "${name}".`] };
    }
    seen.add(name);
    const scope =
      typeof item.scope === 'string' &&
      Object.values(ScenarioVariableScope).includes(item.scope as never)
        ? (item.scope as ScenarioVariable['scope'])
        : ScenarioVariableScope.Scenario;
    const defaultValue =
      typeof item.defaultValue === 'string' ? item.defaultValue : undefined;
    const sensitive = item.sensitive === true;
    variables.push({
      id,
      name,
      scope,
      ...(defaultValue === undefined ? {} : { defaultValue }),
      sensitive,
    });
  }
  return { ok: true, variables };
}

function parseSteps(value: unknown):
  | { readonly ok: true; readonly steps: readonly StepUnion[] }
  | { readonly ok: false; readonly errors: readonly string[] } {
  if (!Array.isArray(value)) {
    return { ok: false, errors: ['Scenario.steps must be an array.'] };
  }
  const steps: StepUnion[] = [];
  const ids = new Set<string>();

  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const type = typeof item.type === 'string' ? item.type : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (id.length === 0 || name.length === 0 || type.length === 0) {
      return { ok: false, errors: ['Each step requires id, type, and name.'] };
    }
    if (ids.has(id)) {
      return { ok: false, errors: [`Duplicate step id "${id}".`] };
    }
    ids.add(id);
    const description =
      typeof item.description === 'string' ? item.description : undefined;
    const position = parsePosition(item.position);
    const base = {
      id,
      name,
      ...(description === undefined || description.trim().length === 0
        ? {}
        : { description }),
      ...(position === undefined ? {} : { position }),
    };

    if (type === StepType.Request) {
      const requestId =
        typeof item.requestId === 'string' ? item.requestId.trim() : '';
      const requestFilePath =
        typeof item.requestFilePath === 'string' ? item.requestFilePath.trim() : '';
      const requestOffset =
        typeof item.requestOffset === 'number' && Number.isFinite(item.requestOffset)
          ? item.requestOffset
          : 0;
      const requestRef =
        typeof item.requestRef === 'string' ? item.requestRef.trim() : undefined;
      if (requestRef !== undefined && requestRef.length > 0) {
        const token = requestRef.startsWith('@') ? requestRef.slice(1).trim() : requestRef;
        if (parseDependRef(token) === undefined) {
          return {
            ok: false,
            errors: [`Request step "${id}" has invalid requestRef.`],
          };
        }
      }
      if (requestId.length === 0 && (requestRef === undefined || requestRef.length === 0)) {
        return {
          ok: false,
          errors: [`Request step "${id}" requires requestId or requestRef.`],
        };
      }
      const inputMappings = Array.isArray(item.inputMappings)
        ? item.inputMappings
            .filter(isRecord)
            .map((m) => ({
              variable: typeof m.variable === 'string' ? m.variable : '',
              requestVariable:
                typeof m.requestVariable === 'string' ? m.requestVariable : '',
            }))
            .filter((m) => m.variable.length > 0 && m.requestVariable.length > 0)
        : [];
      steps.push({
        ...base,
        type: StepType.Request,
        requestId: requestId.length > 0 ? requestId : requestRef ?? id,
        requestFilePath,
        requestOffset,
        inputMappings,
        ...(requestRef === undefined || requestRef.length === 0
          ? {}
          : { requestRef }),
      });
      continue;
    }

    if (type === StepType.Delay) {
      const durationMs =
        typeof item.durationMs === 'number' ? item.durationMs : NaN;
      if (!Number.isInteger(durationMs) || durationMs < 0) {
        return {
          ok: false,
          errors: [`Delay step "${id}" requires durationMs >= 0 integer.`],
        };
      }
      steps.push({ ...base, type: StepType.Delay, durationMs });
      continue;
    }

    if (type === StepType.Condition) {
      const expression =
        typeof item.expression === 'string' ? item.expression : undefined;
      const trueBranch =
        typeof item.trueBranch === 'string' ? item.trueBranch.trim() : '';
      const falseBranch =
        typeof item.falseBranch === 'string' ? item.falseBranch.trim() : '';
      if (trueBranch.length === 0 || falseBranch.length === 0) {
        return {
          ok: false,
          errors: [`Condition step "${id}" requires trueBranch and falseBranch.`],
        };
      }
      let condition: ConditionExpression | undefined;
      if (isRecord(item.condition)) {
        const left = typeof item.condition.left === 'string' ? item.condition.left : '';
        const right =
          typeof item.condition.right === 'string' ? item.condition.right : '';
        const operator =
          typeof item.condition.operator === 'string'
            ? item.condition.operator
            : '';
        if (left && right && operator) {
          condition = {
            left,
            right,
            operator: operator as ConditionOperator,
          };
        }
      }
      if ((expression === undefined || expression.trim().length === 0) && condition === undefined) {
        return {
          ok: false,
          errors: [`Condition step "${id}" requires expression or condition.`],
        };
      }
      if (expression !== undefined && expression.trim().length > 0) {
        const parsed = parseConditionExpression(expression);
        if (!parsed.ok) {
          return {
            ok: false,
            errors: [
              `Condition step "${id}" has invalid expression: ${parsed.errors.join('; ')}`,
            ],
          };
        }
      }
      steps.push({
        ...base,
        type: StepType.Condition,
        trueBranch,
        falseBranch,
        ...(condition === undefined ? {} : { condition }),
        ...(expression === undefined || expression.trim().length === 0
          ? {}
          : { expression }),
      });
      continue;
    }

    if (type === StepType.Variable) {
      if (!Array.isArray(item.assignments)) {
        return {
          ok: false,
          errors: [`Variable step "${id}" requires assignments array.`],
        };
      }
      const assignments = item.assignments
        .filter(isRecord)
        .map((a) => ({
          name: typeof a.name === 'string' ? a.name.trim() : '',
          value: typeof a.value === 'string' ? a.value : '',
        }))
        .filter((a) => VARIABLE_NAME_RE.test(a.name));
      if (assignments.length === 0) {
        return {
          ok: false,
          errors: [`Variable step "${id}" requires at least one assignment.`],
        };
      }
      steps.push({ ...base, type: StepType.Variable, assignments });
      continue;
    }

    if (type === StepType.Group) {
      const stepIds = Array.isArray(item.stepIds)
        ? item.stepIds.filter((s): s is string => typeof s === 'string')
        : [];
      steps.push({ ...base, type: StepType.Group, stepIds });
      continue;
    }

    return { ok: false, errors: [`Unsupported step type "${type}".`] };
  }

  if (steps.length === 0) {
    return { ok: false, errors: ['Scenario.steps must include at least one step.'] };
  }
  return { ok: true, steps };
}

function parseConnections(
  value: unknown,
  steps: readonly StepUnion[],
):
  | { readonly ok: true; readonly connections: readonly Connection[] }
  | { readonly ok: false; readonly errors: readonly string[] } {
  if (value === undefined) return { ok: true, connections: [] };
  if (!Array.isArray(value)) {
    return { ok: false, errors: ['Scenario.connections must be an array.'] };
  }
  const byId = new Map(steps.map((s) => [s.id, s]));
  const connections: Connection[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : crypto.randomUUID();
    const fromStepId =
      typeof item.fromStepId === 'string' ? item.fromStepId.trim() : '';
    const toStepId =
      typeof item.toStepId === 'string' ? item.toStepId.trim() : '';
    if (fromStepId.length === 0 || toStepId.length === 0) continue;
    const fromStep = byId.get(fromStepId);
    const toStep = byId.get(toStepId);
    if (!fromStep || !toStep) {
      return {
        ok: false,
        errors: [`Connection "${fromStepId}" -> "${toStepId}" references unknown step id.`],
      };
    }
    if (fromStep.type === StepType.Group || toStep.type === StepType.Group) {
      return {
        ok: false,
        errors: ['MVP does not support execution edges touching group nodes.'],
      };
    }
    connections.push({ id, fromStepId, toStepId });
  }
  return { ok: true, connections };
}

/** Parses and structurally validates a scenario JSON document. */
export function parseScenarioDocument(text: string): ParseScenarioDocumentResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['Scenario JSON is invalid (failed to parse).'] };
  }
  if (!isRecord(raw)) {
    return { ok: false, errors: ['Scenario JSON must be an object.'] };
  }

  const schemaVersion =
    typeof raw.schemaVersion === 'string' ? raw.schemaVersion : '';
  if (schemaVersion !== ScenarioSchemaVersion) {
    return {
      ok: false,
      errors: [`Unsupported scenario schemaVersion "${schemaVersion}".`],
    };
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (id.length === 0) {
    return { ok: false, errors: ['Scenario.id must be a non-empty string.'] };
  }
  if (name.length === 0) {
    return { ok: false, errors: ['Scenario.name must be a non-empty string.'] };
  }

  const description =
    typeof raw.description === 'string' ? raw.description : undefined;
  const variablesResult = parseVariables(raw.variables);
  if (!variablesResult.ok) return variablesResult;
  const stepsResult = parseSteps(raw.steps);
  if (!stepsResult.ok) return stepsResult;
  const connectionsResult = parseConnections(raw.connections, stepsResult.steps);
  if (!connectionsResult.ok) return connectionsResult;

  const executionSettings = isRecord(raw.executionSettings)
    ? {
        failurePolicy:
          typeof raw.executionSettings.failurePolicy === 'string'
            ? raw.executionSettings.failurePolicy
            : 'stop-on-first-error',
        ...(typeof raw.executionSettings.timeoutMs === 'number'
          ? { timeoutMs: raw.executionSettings.timeoutMs }
          : {}),
      }
    : { failurePolicy: 'stop-on-first-error' };

  const metadata = isRecord(raw.metadata)
    ? {
        createdAt:
          typeof raw.metadata.createdAt === 'string'
            ? raw.metadata.createdAt
            : new Date(0).toISOString(),
        updatedAt:
          typeof raw.metadata.updatedAt === 'string'
            ? raw.metadata.updatedAt
            : new Date(0).toISOString(),
      }
    : {
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };

  return {
    ok: true,
    scenario: {
      id,
      schemaVersion,
      name,
      ...(description === undefined || description.trim().length === 0
        ? {}
        : { description }),
      variables: variablesResult.variables,
      steps: stepsResult.steps,
      connections: connectionsResult.connections,
      executionSettings,
      metadata,
    },
  };
}
