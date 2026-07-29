import type { ScenarioStepRunner, ScenarioStepRunnerExecutionResult } from '../step-registry';
import type { DelayStep } from '../../models';
import { StepCapability, StepRunStatus as StepRunStates, StepType as ScenarioStepType } from '../../models';
import type { ScenarioExecutionContext } from '../execution-context';

export interface DelayStepRunnerPorts {
  readonly now: () => number;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Executes a delay step by awaiting `durationMs` while respecting cancellation.
 */
export class DelayStepRunner implements ScenarioStepRunner {
  public readonly stepType = ScenarioStepType.Delay;
  public readonly capabilities = [StepCapability.Cancellation] as const;

  public constructor(private readonly ports: DelayStepRunnerPorts) {}

  public async run(
    step: DelayStep,
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
      await this.ports.sleep(step.durationMs, context.signal);
    } catch (cause) {
      const endTime = this.ports.now();
      if (context.signal.aborted) {
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
            message: 'Delay step failed unexpectedly.',
            cause,
          },
        },
      };
    }

    const endTime = this.ports.now();
    if (context.signal.aborted) {
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

    return {
      stepResult: {
        stepId: step.id,
        stepName: step.name,
        status: StepRunStates.Completed,
        startTime,
        endTime,
        durationMs: endTime - startTime,
        attempt: 1,
      },
    };
  }
}

