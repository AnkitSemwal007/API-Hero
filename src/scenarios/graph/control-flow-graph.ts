import type { ConnectionId, Scenario, StepId } from '../models';
import { detectCycles } from '../../dependencies/cycle-detector';
import { topoSort } from '../../dependencies/topo-sort';

/**
 * Directed control-flow edge (connection) rendered as one step-to-step edge.
 */
export interface ControlFlowEdge {
  readonly connectionId: ConnectionId;
  readonly fromStepId: StepId;
  readonly toStepId: StepId;
}

export interface ControlFlowGraph {
  readonly nodes: readonly StepId[];
  readonly edges: readonly ControlFlowEdge[];
  /**
   * Entry node if a single entry step can be inferred (no incoming edges).
   * Undefined when there are zero or multiple entry nodes.
   */
  readonly entryStepId?: StepId;
  /**
   * Kahn-style topological order with stable ties by scenario step order.
   * When cycles exist, any unscheduled nodes are appended to produce a
   * deterministic total order (callers must fail-closed using cycle data).
   */
  readonly executionOrder: readonly StepId[];
  /** Detected simple cycles. Each entry is a closed path (`['A','B','A']`). */
  readonly cycles: readonly (readonly StepId[])[];
  /**
   * Set of nodes reachable from {@link entryStepId}.
   * Empty when no unique entry exists.
   */
  readonly reachableFromEntry: ReadonlySet<StepId>;
}

/**
 * Builds the control-flow graph for scenario execution.
 * Framework-free and deterministic.
 */
export function buildControlFlowGraph(scenario: Scenario): ControlFlowGraph {
  const nodes = scenario.steps.map((step) => step.id);
  const nodeSet = new Set(nodes);
  const edges: ControlFlowEdge[] = [];
  for (const connection of scenario.connections) {
    if (
      nodeSet.has(connection.fromStepId) &&
      nodeSet.has(connection.toStepId)
    ) {
      edges.push({
        connectionId: connection.id,
        fromStepId: connection.fromStepId,
        toStepId: connection.toStepId,
      });
    }
  }

  const adjacency = new Map<StepId, StepId[]>();
  const inDegree = new Map<StepId, number>();
  for (const node of nodes) {
    adjacency.set(node, []);
    inDegree.set(node, 0);
  }
  for (const edge of edges) {
    adjacency.get(edge.fromStepId)!.push(edge.toStepId);
    inDegree.set(edge.toStepId, (inDegree.get(edge.toStepId) ?? 0) + 1);
  }

  const entryCandidates = nodes.filter((node) => (inDegree.get(node) ?? 0) === 0);
  const entryStepId = entryCandidates.length === 1 ? entryCandidates[0] : undefined;

  const dependencyEdges = edges.map((edge) => ({
    fromRequestId: edge.fromStepId,
    toRequestId: edge.toStepId,
    kind: 'implicit' as const,
  }));

  const cycleResult = detectCycles({
    nodes,
    edges: dependencyEdges,
  });

  const topo = topoSort({
    nodes,
    edges: dependencyEdges,
  });

  const reachableFromEntry = new Set<StepId>();
  if (entryStepId !== undefined) {
    const stack: StepId[] = [entryStepId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (reachableFromEntry.has(current)) continue;
      reachableFromEntry.add(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!reachableFromEntry.has(next)) {
          stack.push(next);
        }
      }
    }
  }

  return {
    nodes,
    edges,
    entryStepId,
    executionOrder: topo.order,
    cycles: cycleResult.cycles,
    reachableFromEntry,
  };
}

