import type { Connection, ConditionExpression, Scenario, StepId } from '../models';
import type { ControlFlowGraph } from '../graph/control-flow-graph';
import { buildControlFlowGraph } from '../graph/control-flow-graph';
import { buildDataFlowGraph } from '../graph/data-flow-graph';
import { StepType as ScenarioStepType } from '../models';
import { parseConditionExpression } from '../condition-expression';
import { parseDependRef } from '../../dependencies';

export type ScenarioValidationIssueSeverity = 'error' | 'warning';

export type ScenarioValidationIssueCode =
  | 'MISSING_REQUEST_FILE'
  | 'INVALID_RETRY_POLICY'
  | 'INVALID_CONDITION_EXPRESSION'
  | 'CONTROL_FLOW_CYCLE'
  | 'CONTROL_FLOW_NO_ENTRY'
  | 'CONTROL_FLOW_MULTIPLE_ENTRY'
  | 'CONTROL_FLOW_UNREACHABLE_NODE'
  | 'DANGLING_CONNECTION'
  | 'INVALID_CONDITION_BRANCH'
  | 'DATA_FLOW';

export interface ScenarioValidationIssue {
  readonly severity: ScenarioValidationIssueSeverity;
  readonly code: ScenarioValidationIssueCode;
  readonly message: string;
  readonly stepId?: StepId;
  readonly connectionId?: string;
}

export interface ScenarioValidationResult {
  readonly ok: boolean;
  readonly errors: readonly ScenarioValidationIssue[];
  readonly warnings: readonly ScenarioValidationIssue[];
}

export interface ScenarioValidatorPorts {
  /**
   * Checks whether an absolute/URI path exists and is readable.
   * Core stays framework-free; adapters can provide VS Code `workspace.fs` etc.
   */
  readonly fileExists: (filePath: string) => boolean | Promise<boolean>;
}

function isSafeIntegerNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validateConditionExpression(expression: ConditionExpression): {
  readonly ok: boolean;
  readonly error?: string;
} {
  const validOperators = new Set([
    '==',
    '!=',
    '>',
    '<',
    '>=',
    '<=',
    'contains',
    'not-contains',
  ]);
  if (!validOperators.has(expression.operator)) {
    return { ok: false, error: `Invalid operator "${expression.operator}".` };
  }
  if (expression.left.trim().length === 0 || expression.right.trim().length === 0) {
    return { ok: false, error: 'Condition operands must be non-empty strings.' };
  }
  return { ok: true };
}

function validateRetryPolicy(policy: unknown): {
  readonly ok: boolean;
  readonly error?: string;
} {
  if (typeof policy !== 'object' || policy === null) {
    return { ok: false, error: 'Retry policy must be an object.' };
  }
  const p = policy as {
    maxRetries: unknown;
    delayMs: unknown;
    continueOnFailure: unknown;
    stopOnFailure: unknown;
  };

  if (!isSafeIntegerNonNegative(p.maxRetries)) {
    return { ok: false, error: 'RetryPolicy.maxRetries must be a non-negative safe integer.' };
  }
  if (!isSafeIntegerNonNegative(p.delayMs)) {
    return { ok: false, error: 'RetryPolicy.delayMs must be a non-negative safe integer.' };
  }
  if (typeof p.continueOnFailure !== 'boolean' || typeof p.stopOnFailure !== 'boolean') {
    return { ok: false, error: 'RetryPolicy flags must be booleans.' };
  }
  if (p.continueOnFailure === p.stopOnFailure) {
    return { ok: false, error: 'RetryPolicy must set exactly one of continueOnFailure/stopOnFailure.' };
  }
  return { ok: true };
}

function extractConnectionMap(connections: readonly Connection[]): ReadonlyMap<string, Connection> {
  return new Map(connections.map((c) => [c.id, c]));
}

/**
 * Validates one scenario definition for pre-run safety.
 * Does not execute any steps.
 */
export async function validateScenario(
  scenario: Scenario,
  ports: ScenarioValidatorPorts,
): Promise<ScenarioValidationResult> {
  const errors: ScenarioValidationIssue[] = [];
  const warnings: ScenarioValidationIssue[] = [];

  const stepsById = new Map(scenario.steps.map((s) => [s.id, s]));

  for (const connection of scenario.connections) {
    const fromExists = stepsById.has(connection.fromStepId);
    const toExists = stepsById.has(connection.toStepId);
    if (!fromExists || !toExists) {
      errors.push({
        severity: 'error',
        code: 'DANGLING_CONNECTION',
        message: `Connection "${connection.id}" references missing steps.`,
        connectionId: connection.id,
      });
    }
  }

  const controlFlow: ControlFlowGraph = buildControlFlowGraph(scenario);

  if (controlFlow.entryStepId === undefined) {
    // Distinguish between no-entry and multiple-entry when possible.
    const indegree = new Map<StepId, number>();
    for (const node of controlFlow.nodes) indegree.set(node, 0);
    for (const edge of controlFlow.edges) {
      indegree.set(edge.toStepId, (indegree.get(edge.toStepId) ?? 0) + 1);
    }
    const entries = controlFlow.nodes.filter((node) => (indegree.get(node) ?? 0) === 0);
    errors.push({
      severity: 'error',
      code:
        entries.length === 0 ? 'CONTROL_FLOW_NO_ENTRY' : 'CONTROL_FLOW_MULTIPLE_ENTRY',
      message:
        entries.length === 0
          ? 'Scenario must have exactly one entry step (no incoming edges). Found none.'
          : `Scenario must have exactly one entry step (no incoming edges). Found ${entries.length}.`,
    });
  }

  if (controlFlow.cycles.length > 0) {
    errors.push({
      severity: 'error',
      code: 'CONTROL_FLOW_CYCLE',
      message: `Control-flow cycle detected: ${controlFlow.cycles[0]!.join(' -> ')}.`,
    });
  }

  if (controlFlow.entryStepId !== undefined) {
    for (const node of controlFlow.nodes) {
      if (!controlFlow.reachableFromEntry.has(node)) {
        errors.push({
          severity: 'error',
          code: 'CONTROL_FLOW_UNREACHABLE_NODE',
          message: `Step "${stepsById.get(node)?.name ?? node}" is unreachable from the entry step.`,
          stepId: node,
        });
      }
    }
  }

  // Request file existence check.
  for (const step of scenario.steps) {
    if (step.type !== ScenarioStepType.Request) continue;
    const exists = await ports.fileExists(step.requestFilePath);
    if (!exists) {
      errors.push({
        severity: 'error',
        code: 'MISSING_REQUEST_FILE',
        message: `Request step "${step.name}" refers to missing file "${step.requestFilePath}".`,
        stepId: step.id,
      });
    }
  }

  // Condition expression / branch validation.
  const connectionMap = extractConnectionMap(scenario.connections);
  for (const step of scenario.steps) {
    if (step.type !== ScenarioStepType.Condition) continue;

    const hasExpression =
      step.expression !== undefined && step.expression.trim().length > 0;
    const hasStructured = step.condition !== undefined;
    if (!hasExpression && !hasStructured) {
      errors.push({
        severity: 'error',
        code: 'INVALID_CONDITION_EXPRESSION',
        message: `Condition step "${step.name}" requires expression or condition.`,
        stepId: step.id,
      });
    }
    if (hasExpression) {
      const parsed = parseConditionExpression(step.expression!);
      if (!parsed.ok) {
        errors.push({
          severity: 'error',
          code: 'INVALID_CONDITION_EXPRESSION',
          message: `Condition step "${step.name}" has invalid expression: ${parsed.errors.join('; ')}.`,
          stepId: step.id,
        });
      }
    }
    if (hasStructured) {
      const conditionResult = validateConditionExpression(step.condition!);
      if (!conditionResult.ok) {
        errors.push({
          severity: 'error',
          code: 'INVALID_CONDITION_EXPRESSION',
          message: `Condition step "${step.name}" has invalid condition: ${conditionResult.error}.`,
          stepId: step.id,
        });
      }
    }

    const trueConnection = connectionMap.get(step.trueBranch);
    const falseConnection = connectionMap.get(step.falseBranch);
    if (trueConnection === undefined || falseConnection === undefined) {
      errors.push({
        severity: 'error',
        code: 'INVALID_CONDITION_BRANCH',
        message: `Condition step "${step.name}" references an unknown connection id.`,
        stepId: step.id,
      });
      continue;
    }
    if (trueConnection.fromStepId !== step.id || falseConnection.fromStepId !== step.id) {
      errors.push({
        severity: 'error',
        code: 'INVALID_CONDITION_BRANCH',
        message: `Condition step "${step.name}" must branch using outgoing connections.`,
        stepId: step.id,
      });
    }
  }

  // RequestRef token shape (when present).
  for (const step of scenario.steps) {
    if (step.type !== ScenarioStepType.Request) continue;
    if (step.requestRef === undefined) continue;
    const token = step.requestRef.trim().startsWith('@')
      ? step.requestRef.trim().slice(1).trim()
      : step.requestRef.trim();
    if (parseDependRef(token) === undefined) {
      errors.push({
        severity: 'error',
        code: 'MISSING_REQUEST_FILE',
        message: `Request step "${step.name}" has invalid requestRef "${step.requestRef}".`,
        stepId: step.id,
      });
    }
  }

  // Retry policy validation.
  for (const step of scenario.steps) {
    if (step.retryPolicy === undefined) continue;
    const result = validateRetryPolicy(step.retryPolicy);
    if (!result.ok) {
      errors.push({
        severity: 'error',
        code: 'INVALID_RETRY_POLICY',
        message: `Step "${step.name}" has invalid retry policy: ${result.error}.`,
        stepId: step.id,
      });
    }
  }

  // Data-flow dominance / variable validation.
  const dataFlowResult = buildDataFlowGraph(scenario, controlFlow);
  if (dataFlowResult.errors.length > 0) {
    errors.push(
      ...dataFlowResult.errors.map((issue) => ({
        severity: 'error' as const,
        code: 'DATA_FLOW' as const,
        message: issue.message,
        stepId: issue.stepId,
      })),
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

