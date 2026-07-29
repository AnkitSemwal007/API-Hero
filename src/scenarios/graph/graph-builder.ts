import type { Scenario } from '../models';
import type { ControlFlowGraph } from './control-flow-graph';
import type { ScenarioDataFlowGraph } from './data-flow-graph';
import { buildControlFlowGraph } from './control-flow-graph';
import { buildDataFlowGraph } from './data-flow-graph';

export interface ScenarioGraphBuildResult {
  readonly controlFlow: ControlFlowGraph;
  readonly dataFlow: ScenarioDataFlowGraph | undefined;
  readonly dataFlowErrors: readonly unknown[];
}

/**
 * Builds control-flow and data-flow graphs for one scenario.
 * Graph validation (dominance / referenced outputs, etc.) is owned by the
 * data-flow builder so callers can choose fail/continue behavior.
 */
export function buildScenarioGraphs(scenario: Scenario): ScenarioGraphBuildResult {
  const controlFlow = buildControlFlowGraph(scenario);
  const dataFlowResult = buildDataFlowGraph(scenario, controlFlow);
  return {
    controlFlow,
    dataFlow: dataFlowResult.graph,
    dataFlowErrors: dataFlowResult.errors,
  };
}

