/**
 * Wraps a membership `RunPlan` (DFS order from `buildRunPlan`) with dependency
 * analysis: builds the graph, blocks on cycles, topo-sorts, and rewrites
 * `plan.requests` / `plan.extensions.dependencies` (§3.5–3.6, §6). Framework-free.
 */

import {
  freezeRunPlan,
  type DependencyNodeMeta,
  type PlannedRequest,
  type RunPlan,
} from '../collection-runner';
import { buildDependencyGraph } from './graph-builder';
import { detectCycles } from './cycle-detector';
import { topoSort } from './topo-sort';
import type { PlanEnrichmentResult, RequestDependencyAnalysis } from './models';

export interface EnrichRunPlanOptions {
  readonly membershipPlan: RunPlan;
  /** Parsed analyses; order does not need to match `membershipPlan.requests`. */
  readonly analyses: readonly RequestDependencyAnalysis[];
  /**
   * When true (default), auto-reorder via topo sort. Silent reorder; UI
   * toast reports the count.
   */
  readonly autoReorder?: boolean;
}

/**
 * Enriches a membership plan with a dependency graph and (by default)
 * reorders `plan.requests` into topological order. Returns `ok: false` when
 * the graph has a cycle or an `@depends-on` ref cannot be resolved uniquely
 * — callers must not start the run in that case (§6.5).
 */
export function enrichRunPlanWithDependencies(
  options: EnrichRunPlanOptions,
): PlanEnrichmentResult {
  const { membershipPlan, analyses } = options;
  const autoReorder = options.autoReorder ?? true;

  const analysisByRequestId = new Map(
    analyses.map((analysis) => [analysis.requestId, analysis]),
  );
  const labelByRequestId = new Map(
    membershipPlan.requests.map((request) => [request.requestId, request.label]),
  );
  const folderPathByRequestId = new Map(
    membershipPlan.requests.map((request) => [
      request.requestId,
      request.folderRelativePath ?? '',
    ]),
  );
  const originalOrder = membershipPlan.requests.map((request) => request.requestId);

  const graphResult = buildDependencyGraph({
    analyses,
    labelByRequestId,
    folderPathByRequestId,
  });
  if (!graphResult.ok) {
    return { ok: false, code: graphResult.code, message: graphResult.message };
  }
  const { graph, unresolvedConsumes } = graphResult;

  const cycleResult = detectCycles(graph);
  if (cycleResult.hasCycle) {
    const labelCounts = countLabelOccurrences(labelByRequestId);
    return {
      ok: false,
      code: 'DEPENDENCY_CYCLE',
      message: `Dependency cycle detected: ${cycleResult.cycles
        .map((cycle) =>
          formatCyclePath(cycle, labelByRequestId, labelCounts),
        )
        .join('; ')}`,
      cycles: cycleResult.cycles,
    };
  }

  const sortResult = autoReorder
    ? topoSort({ nodes: graph.nodes, edges: graph.edges })
    : { order: graph.nodes, reordered: false };
  const executionOrder = sortResult.order;

  const plannedById = new Map(
    membershipPlan.requests.map((request) => [request.requestId, request]),
  );

  const dependsOnRequestIdsByRequest = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'explicit') {
      continue;
    }
    const list = dependsOnRequestIdsByRequest.get(edge.toRequestId) ?? [];
    list.push(edge.fromRequestId);
    dependsOnRequestIdsByRequest.set(edge.toRequestId, list);
  }

  const reorderedRequests: PlannedRequest[] = executionOrder.map(
    (requestId, index) => {
      const planned = plannedById.get(requestId);
      if (planned === undefined) {
        throw new Error(
          `Dependency enrichment produced an unknown request id "${requestId}".`,
        );
      }
      const analysis = analysisByRequestId.get(requestId);
      const dependsOnRequestIds = dependsOnRequestIdsByRequest.get(requestId);
      return {
        ...planned,
        ordinal: index,
        ...(analysis === undefined
          ? {}
          : { produces: analysis.produces, consumes: analysis.consumes }),
        ...(dependsOnRequestIds === undefined ? {} : { dependsOnRequestIds }),
      };
    },
  );

  const nodes: DependencyNodeMeta[] = analyses.map((analysis) => ({
    requestId: analysis.requestId,
    produces: analysis.produces,
    consumes: analysis.consumes,
    dependsOnNames: analysis.dependsOnNames,
  }));

  const producedByRequest: Record<string, readonly string[]> = {};
  for (const analysis of analyses) {
    producedByRequest[analysis.requestId] = analysis.produces;
  }

  const plan: RunPlan = freezeRunPlan({
    ...membershipPlan,
    requests: reorderedRequests,
    extensions: {
      ...membershipPlan.extensions,
      dependencies: {
        nodes,
        edges: graph.edges,
        reordered: !arraysEqual(executionOrder, originalOrder),
        originalOrder,
        executionOrder,
        cycles: [],
        unresolvedConsumes,
      },
      variablesPerRun: {
        storeKind: 'in-memory',
        producedByRequest,
      },
    },
  });

  return { ok: true, plan, graph };
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

/** Counts how often each `@name` label appears in the plan (for cycle-path UX). */
function countLabelOccurrences(
  labelByRequestId: ReadonlyMap<string, string>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const label of labelByRequestId.values()) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

/**
 * Formats a cycle as `Login → Products → Login`. When the same `@name` is
 * shared by multiple requests, appends a short request id so the path stays
 * unambiguous (implicit-edge cycles are not blocked by AMBIGUOUS_DEPENDS_ON).
 */
function formatCyclePath(
  cycle: readonly string[],
  labelByRequestId: ReadonlyMap<string, string>,
  labelCounts: ReadonlyMap<string, number>,
): string {
  return cycle
    .map((requestId) => {
      const label = labelByRequestId.get(requestId) ?? requestId;
      if ((labelCounts.get(label) ?? 0) > 1) {
        return `${label} (${requestId})`;
      }
      return label;
    })
    .join(' → ');
}

