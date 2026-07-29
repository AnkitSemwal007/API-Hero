import type { ScenarioStepRunner, ScenarioStepRunnerExecutionResult } from '../step-registry';
import type { ConditionStep } from '../../models';
import {
  StepCapability,
  StepRunStatus as StepRunStates,
  StepType as ScenarioStepType,
  type ConditionOperator,
} from '../../models';
import type { ScenarioExecutionContext } from '../execution-context';
import type { ScenarioVariableResolver } from '../../variables/scenario-variable-resolver';
import { evaluateConditionExpression } from '../../condition-expression';

export interface ConditionStepRunnerPorts {
  readonly now: () => number;
  readonly scenarioVariableResolver: ScenarioVariableResolver;
}

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : undefined;
}

function evaluateStructuredCondition(options: {
  readonly operator: ConditionOperator;
  readonly left: string;
  readonly right: string;
}): boolean {
  const { operator, left, right } = options;
  switch (operator) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
    case '<':
    case '>=':
    case '<=': {
      const l = parseNumber(left);
      const r = parseNumber(right);
      if (l === undefined || r === undefined) return false;
      if (operator === '>') return l > r;
      if (operator === '<') return l < r;
      if (operator === '>=') return l >= r;
      return l <= r;
    }
    case 'contains':
      return left.includes(right);
    case 'not-contains':
      return !left.includes(right);
  }
}

/**
 * Executes one conditional step and selects which outgoing connection
 * should be followed by the scenario engine.
 */
export class ConditionStepRunner implements ScenarioStepRunner {
  public readonly stepType = ScenarioStepType.Condition;
  public readonly capabilities = [StepCapability.Branches] as const;

  public constructor(private readonly ports: ConditionStepRunnerPorts) {}

  public async run(
    step: ConditionStep,
    context: ScenarioExecutionContext,
  ): Promise<ScenarioStepRunnerExecutionResult> {
    const startTime = this.ports.now();
    if (context.signal.aborted) {
      return {
        stepResult: {
          stepId: step.id,
          stepName: step.name,
          status: StepRunStates.Cancelled,
          startTime,
          endTime: startTime,
          durationMs: 0,
          attempt: 0,
        },
      };
    }

    const resolveOperand = (operand: string): string => {
      if (operand.includes('{{')) {
        return this.ports.scenarioVariableResolver.resolveStringTemplate(operand, {
          variables: context.variables,
          outputs: context.outputs,
        });
      }
      return operand;
    };

    try {
      let passed: boolean;
      if (step.expression !== undefined && step.expression.trim().length > 0) {
        const evaluated = evaluateConditionExpression(step.expression, {
          statusCode: context.lastResponse?.statusCode,
          headers: context.lastResponse?.headers,
          variables: context.variables,
        });
        if (evaluated.result === undefined && !evaluated.ok) {
          throw new Error(evaluated.errors.join('; ') || 'Condition expression failed.');
        }
        passed = evaluated.result === true;
      } else if (step.condition !== undefined) {
        const leftValue = resolveOperand(step.condition.left);
        const rightValue = resolveOperand(step.condition.right);
        passed = evaluateStructuredCondition({
          operator: step.condition.operator,
          left: leftValue,
          right: rightValue,
        });
      } else {
        throw new Error('Condition step requires expression or condition.');
      }

      const chosen = passed ? step.trueBranch : step.falseBranch;
      const endTime = this.ports.now();
      return {
        stepResult: {
          stepId: step.id,
          stepName: step.name,
          status: StepRunStates.Completed,
          startTime,
          endTime,
          durationMs: endTime - startTime,
          attempt: 1,
          outputs: [{ name: 'result', value: passed ? 'true' : 'false' }],
        },
        nextConnectionIds: [chosen],
      };
    } catch (cause) {
      const endTime = this.ports.now();
      return {
        stepResult: {
          stepId: step.id,
          stepName: step.name,
          status: StepRunStates.Failed,
          startTime,
          endTime,
          durationMs: endTime - startTime,
          attempt: 1,
          error: {
            message: 'Condition evaluation failed.',
            cause,
          },
        },
      };
    }
  }
}
