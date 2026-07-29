import type { ScenarioStepRunner, ScenarioStepRunnerExecutionResult } from '../step-registry';
import type { ScenarioExecutionContext } from '../execution-context';
import type { VariableStep } from '../../models';
import {
  StepCapability,
  StepRunStatus as StepRunStates,
  StepType as ScenarioStepType,
} from '../../models';
import type { ScenarioVariableResolver } from '../../variables/scenario-variable-resolver';

export interface VariableStepRunnerPorts {
  readonly now: () => number;
  readonly scenarioVariableResolver: ScenarioVariableResolver;
}

/**
 * Executes one variable assignment step (no external IO).
 */
export class VariableStepRunner implements ScenarioStepRunner {
  public readonly stepType = ScenarioStepType.Variable;
  public readonly capabilities = [StepCapability.Validation, StepCapability.Outputs] as const;

  public constructor(private readonly ports: VariableStepRunnerPorts) {}

  public async run(
    step: VariableStep,
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

    try {
      for (const assignment of step.assignments) {
        if (context.signal.aborted) {
          const endTime = this.ports.now();
          return {
            stepResult: {
              stepId: step.id,
              stepName: step.name,
              status: StepRunStates.Cancelled,
              startTime,
              endTime,
              durationMs: endTime - startTime,
              attempt: 0,
            },
          };
        }
        const value = this.ports.scenarioVariableResolver.resolveStringTemplate(
          assignment.value,
          { variables: context.variables, outputs: context.outputs },
        );
        context.variables.set(assignment.name, value);
      }

      const outputsPairs: { readonly name: string; readonly value: string }[] = [];
      const outputModels = step.outputs ?? [];
      if (outputModels.length > 0) {
        const stepOutputs = context.outputs.get(step.id) ?? new Map<string, string>();
        for (const output of outputModels) {
          const value = output.source.includes('{{')
            ? this.ports.scenarioVariableResolver.resolveStringTemplate(
                output.source,
                { variables: context.variables, outputs: context.outputs },
              )
            : output.source;
          stepOutputs.set(output.name, value);
          outputsPairs.push({ name: output.name, value });
          if (output.targetVariable !== undefined) {
            context.variables.set(output.targetVariable, value);
          }
        }
        context.outputs.set(step.id, stepOutputs);
      }

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
          ...(outputsPairs.length > 0 ? { outputs: outputsPairs } : {}),
        },
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
            message: 'Variable resolution failed.',
            cause,
          },
        },
      };
    }
  }
}

