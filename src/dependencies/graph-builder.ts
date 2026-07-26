/**
 * Builds a directed {@link DependencyGraph} from produces/consumes analyses
 * plus explicit `@depends-on` names (§6.3–6.4). Framework-free.
 */

import type { DependencyEdge } from '../collection-runner';
import type { DependencyGraph, RequestDependencyAnalysis } from './models';

export interface BuildDependencyGraphOptions {
  /** Analyses aligned to the membership plan; order does not matter here. */
  readonly analyses: readonly RequestDependencyAnalysis[];
  /** Display label (authored `@name`) for every request id in the plan. */
  readonly labelByRequestId: ReadonlyMap<string, string>;
}

export type BuildDependencyGraphResult =
  | {
      readonly ok: true;
      readonly graph: DependencyGraph;
      readonly unresolvedConsumes: readonly {
        readonly requestId: string;
        readonly variable: string;
      }[];
    }
  | {
      readonly ok: false;
      readonly code: 'AMBIGUOUS_DEPENDS_ON' | 'UNKNOWN_DEPENDS_ON_TARGET';
      readonly message: string;
    };

/**
 * Builds nodes/edges: an implicit edge from every in-plan producer of `v` to
 * every consumer of `v` (§6.4, deterministic — topo sort + last-write-wins at
 * runtime resolve any ordering ambiguity among multiple producers), plus one
 * explicit edge per resolved `@depends-on` name. Unknown or ambiguous
 * `@depends-on` targets fail closed (§6.3).
 */
export function buildDependencyGraph(
  options: BuildDependencyGraphOptions,
): BuildDependencyGraphResult {
  const { analyses, labelByRequestId } = options;
  const nodes = analyses.map((analysis) => analysis.requestId);
  const edges: DependencyEdge[] = [];

  const producersByVariable = new Map<string, string[]>();
  for (const analysis of analyses) {
    for (const variable of analysis.produces) {
      const list = producersByVariable.get(variable) ?? [];
      list.push(analysis.requestId);
      producersByVariable.set(variable, list);
    }
  }

  const unresolvedConsumes: { requestId: string; variable: string }[] = [];
  for (const consumer of analyses) {
    for (const variable of consumer.consumes) {
      const producers = producersByVariable.get(variable) ?? [];
      const inPlanProducers = producers.filter((id) => id !== consumer.requestId);
      if (inPlanProducers.length === 0) {
        unresolvedConsumes.push({ requestId: consumer.requestId, variable });
        continue;
      }
      for (const producer of inPlanProducers) {
        edges.push({
          fromRequestId: producer,
          toRequestId: consumer.requestId,
          kind: 'implicit',
          variable,
        });
      }
    }
  }

  const requestIdsByLabel = new Map<string, string[]>();
  for (const [requestId, label] of labelByRequestId) {
    const list = requestIdsByLabel.get(label) ?? [];
    list.push(requestId);
    requestIdsByLabel.set(label, list);
  }

  for (const analysis of analyses) {
    for (const name of analysis.dependsOnNames) {
      const matches = requestIdsByLabel.get(name) ?? [];
      if (matches.length > 1) {
        return {
          ok: false,
          code: 'AMBIGUOUS_DEPENDS_ON',
          message: `Multiple requests in this plan are named "${name}"; @depends-on target is ambiguous.`,
        };
      }
      if (matches.length === 0) {
        return {
          ok: false,
          code: 'UNKNOWN_DEPENDS_ON_TARGET',
          message: `No request named "${name}" was found in this run's plan.`,
        };
      }
      const target = matches[0]!;
      if (target === analysis.requestId) {
        continue;
      }
      edges.push({
        fromRequestId: target,
        toRequestId: analysis.requestId,
        kind: 'explicit',
      });
    }
  }

  return { ok: true, graph: { nodes, edges }, unresolvedConsumes };
}
