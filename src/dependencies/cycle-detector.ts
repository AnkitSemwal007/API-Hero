/**
 * Cycle detection over a {@link DependencyGraph} (§6.5). Framework-free.
 */

import type { DependencyGraph } from './models';

export interface CycleDetectionResult {
  readonly hasCycle: boolean;
  /** Each entry is a closed path, e.g. `['A', 'B', 'A']`. Deduplicated by node set. */
  readonly cycles: readonly (readonly string[])[];
}

type VisitState = 'unvisited' | 'in-stack' | 'done';

/** Detects all simple cycles reachable from every node via DFS back-edges. */
export function detectCycles(graph: DependencyGraph): CycleDetectionResult {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(node, []);
  }
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.fromRequestId);
    if (list !== undefined && adjacency.has(edge.toRequestId)) {
      list.push(edge.toRequestId);
    }
  }

  const state = new Map<string, VisitState>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();

  const visit = (node: string): void => {
    state.set(node, 'in-stack');
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const nextState: VisitState = state.get(next) ?? 'unvisited';
      if (nextState === 'unvisited') {
        visit(next);
      } else if (nextState === 'in-stack') {
        const startIndex = stack.indexOf(next);
        const cyclePath = [...stack.slice(startIndex), next];
        const key = normalizeCycleKey(cyclePath);
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          cycles.push(cyclePath);
        }
      }
    }
    stack.pop();
    state.set(node, 'done');
  };

  for (const node of graph.nodes) {
    if ((state.get(node) ?? 'unvisited') === 'unvisited') {
      visit(node);
    }
  }

  return { hasCycle: cycles.length > 0, cycles };
}

function normalizeCycleKey(cyclePath: readonly string[]): string {
  return [...cyclePath.slice(0, -1)].sort().join('\u0000');
}
