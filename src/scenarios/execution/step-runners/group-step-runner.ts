import type { ScenarioStepRunner, ScenarioStepRunnerExecutionResult } from '../step-registry';
import type { ScenarioExecutionContext } from '../execution-context';
import type { GroupStep } from '../../models';
import {
  StepRunStatus as StepRunStates,
  StepType as ScenarioStepType,
} from '../../models';

export interface GroupStepRunnerPorts {
  readonly now: () => number;
}

/**
 * Visual grouping step: no execution semantics beyond participation in the
 * control-flow graph (engine treats it as pass-through).
 */
export class GroupStepRunner implements ScenarioStepRunner {
  public readonly stepType = ScenarioStepType.Group;
  public readonly capabilities = [] as const;

  public constructor(private readonly ports: GroupStepRunnerPorts) {}

  public async run(
    step: GroupStep,
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
      },
    };
  }
}

