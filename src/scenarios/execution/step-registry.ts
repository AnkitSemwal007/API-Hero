import type {
  StepCapability,
  StepType,
  StepUnion,
  StepRunResult,
  ConnectionId,
} from '../models';

/**
 * Runner for one scenario step type.
 * Implementations are framework-free and contain their own dependency wiring.
 */
export interface ScenarioStepRunner {
  readonly stepType: StepType;
  readonly capabilities: readonly StepCapability[];
  /**
   * Executes one step and returns a detached, immutable run result.
   * Implementations must not mutate the `context` object except via the maps
   * owned by it (`context.variables`, `context.outputs`, `context.timeline`).
   */
  run(
    step: StepUnion,
    context: import('./execution-context').ScenarioExecutionContext,
  ): Promise<ScenarioStepRunnerExecutionResult>;
}

export interface ScenarioStepRegistry {
  register(runner: ScenarioStepRunner): void;
  get(stepType: StepType): ScenarioStepRunner;
}

/**
 * One runner execution result for engine consumption.
 * `nextConnectionIds` is used by the engine for condition-branch activation.
 */
export interface ScenarioStepRunnerExecutionResult {
  readonly stepResult: StepRunResult;
  /**
   * Optional override for condition steps.
   * When undefined, the engine uses the step's control-flow connections normally.
   */
  readonly nextConnectionIds?: readonly ConnectionId[];
}

/**
 * Simple map-backed registry from {@link StepType} to a runner.
 * Not thread-safe; intended for engine construction time only.
 */
export class DefaultScenarioStepRegistry implements ScenarioStepRegistry {
  private readonly byType = new Map<StepType, ScenarioStepRunner>();

  public register(runner: ScenarioStepRunner): void {
    if (this.byType.has(runner.stepType)) {
      throw new Error(`Scenario step runner already registered for type "${runner.stepType}".`);
    }
    this.byType.set(runner.stepType, runner);
  }

  public get(stepType: StepType): ScenarioStepRunner {
    const runner = this.byType.get(stepType);
    if (!runner) {
      throw new Error(`No scenario step runner registered for type "${stepType}".`);
    }
    return runner;
  }
}

