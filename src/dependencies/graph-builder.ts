/**
 * Builds a directed {@link DependencyGraph} from produces/consumes analyses
 * plus explicit `@depends-on` human refs (ADR 0002 Option C).
 * Framework-free.
 */

import type { DependencyEdge } from '../collection-runner';
import {
  parseDependRef,
  resolveDependRef,
  type DependRefIndexEntry,
} from './depend-ref';
import type { DependencyGraph, RequestDependencyAnalysis } from './models';

export interface BuildDependencyGraphOptions {
  /** Analyses aligned to the membership plan; order does not matter here. */
  readonly analyses: readonly RequestDependencyAnalysis[];
  /** Display label (authored `@name`) for every request id in the plan. */
  readonly labelByRequestId: ReadonlyMap<string, string>;
  /**
   * Folder `relativePath` for every plan member (`''` for collection root).
   * Used to resolve qualified `Folder/Name` depend refs.
   */
  readonly folderPathByRequestId?: ReadonlyMap<string, string>;
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
 * every consumer of `v` (§6.4), plus one explicit edge per resolved
 * `@depends-on` token. Tokens resolve as bare names or `Folder/Name`
 * (ADR 0002). Unknown or ambiguous targets fail closed.
 */
export function buildDependencyGraph(
  options: BuildDependencyGraphOptions,
): BuildDependencyGraphResult {
  const { analyses, labelByRequestId } = options;
  const folderPathByRequestId = options.folderPathByRequestId ?? new Map();
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

  const index: DependRefIndexEntry[] = [];
  for (const [requestId, label] of labelByRequestId) {
    index.push({
      requestId,
      name: label,
      folderPath: folderPathByRequestId.get(requestId) ?? '',
    });
  }

  for (const analysis of analyses) {
    for (const token of analysis.dependsOnNames) {
      const resolved = resolveDependsOnToken(token, index);
      if (!resolved.ok) {
        return resolved;
      }
      const target = resolved.requestId;
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

type ResolveTokenResult =
  | { readonly ok: true; readonly requestId: string }
  | {
      readonly ok: false;
      readonly code: 'AMBIGUOUS_DEPENDS_ON' | 'UNKNOWN_DEPENDS_ON_TARGET';
      readonly message: string;
    };

function resolveDependsOnToken(
  token: string,
  index: readonly DependRefIndexEntry[],
): ResolveTokenResult {
  const ref = parseDependRef(token);
  if (ref === undefined) {
    return {
      ok: false,
      code: 'UNKNOWN_DEPENDS_ON_TARGET',
      message: `Invalid @depends-on token "${token}".`,
    };
  }

  const resolved = resolveDependRef(ref, index);
  if (resolved.ok) {
    return { ok: true, requestId: resolved.requestId };
  }

  if (resolved.code === 'ambiguous') {
    const hint =
      ref.kind === 'bare' && resolved.candidates.length > 0
        ? ` Use a qualified ref such as ${resolved.candidates
            .map((c) => `"${c.folderPath}/${c.name}"`)
            .join(' or ')}.`
        : '';
    return {
      ok: false,
      code: 'AMBIGUOUS_DEPENDS_ON',
      message:
        ref.kind === 'bare'
          ? `Multiple requests in this plan are named "${ref.name}"; @depends-on target is ambiguous.${hint}`
          : `Multiple requests in this plan match "${token}"; @depends-on target is ambiguous.`,
    };
  }

  return {
    ok: false,
    code: 'UNKNOWN_DEPENDS_ON_TARGET',
    message:
      ref.kind === 'bare'
        ? `No request named "${ref.name}" was found in this run's plan.`
        : `No request matching "${token}" was found in this run's plan.`,
  };
}

