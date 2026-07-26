/**
 * Stable topological sort with original-membership-order tie-break (§6.6).
 * Framework-free. Callers must run {@link detectCycles} first — this module
 * assumes an acyclic graph and silently drops nodes it cannot schedule.
 */

import type { DependencyEdge } from '../collection-runner';

export interface TopoSortOptions {
  /** Node ids in original membership (DFS) order. */
  readonly nodes: readonly string[];
  readonly edges: readonly DependencyEdge[];
}

export interface TopoSortResult {
  readonly order: readonly string[];
  /** True when `order` differs from the original `nodes` order. */
  readonly reordered: boolean;
}

/** Kahn's algorithm; ties broken by ascending original ordinal. */
export function topoSort(options: TopoSortOptions): TopoSortResult {
  const { nodes, edges } = options;
  const ordinalById = new Map(nodes.map((id, index) => [id, index]));
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    adjacency.set(node, []);
    inDegree.set(node, 0);
  }
  for (const edge of edges) {
    if (!adjacency.has(edge.fromRequestId) || !inDegree.has(edge.toRequestId)) {
      continue;
    }
    adjacency.get(edge.fromRequestId)!.push(edge.toRequestId);
    inDegree.set(edge.toRequestId, (inDegree.get(edge.toRequestId) ?? 0) + 1);
  }

  const byOrdinal = (a: string, b: string): number =>
    (ordinalById.get(a) ?? Number.MAX_SAFE_INTEGER) -
    (ordinalById.get(b) ?? Number.MAX_SAFE_INTEGER);

  const ready = nodes.filter((node) => (inDegree.get(node) ?? 0) === 0);
  ready.sort(byOrdinal);

  const remaining = new Map(inDegree);
  const order: string[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    order.push(next);
    for (const successor of adjacency.get(next) ?? []) {
      const degree = (remaining.get(successor) ?? 0) - 1;
      remaining.set(successor, degree);
      if (degree === 0) {
        insertSorted(ready, successor, byOrdinal);
      }
    }
  }

  // Nodes left unscheduled indicate a cycle; append them in original order so
  // callers who skip cycle detection still get a total order rather than a
  // silently truncated one.
  if (order.length !== nodes.length) {
    const scheduled = new Set(order);
    for (const node of nodes) {
      if (!scheduled.has(node)) {
        order.push(node);
      }
    }
  }

  return { order, reordered: !arraysEqual(order, nodes) };
}

function insertSorted(
  list: string[],
  value: string,
  compare: (a: string, b: string) => number,
): void {
  let index = list.length;
  while (index > 0 && compare(list[index - 1]!, value) > 0) {
    index -= 1;
  }
  list.splice(index, 0, value);
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}
