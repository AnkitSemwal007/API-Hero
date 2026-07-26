/**
 * Dependency-graph domain models (Phase 2). Framework-free — no `vscode`
 * imports. `DependencyEdge` / `DependencyNodeMeta` are canonically defined on
 * `collection-runner/models.ts` (the typed `RunPlan.extensions.dependencies`
 * bag) and re-exported here so callers can depend on this module alone.
 */

import type { RunPlan } from '../collection-runner';

export type {
  DependenciesExtension,
  DependencyEdge,
  DependencyEdgeKind,
  DependencyNodeMeta,
  VariablesPerRunExtension,
} from '../collection-runner';

/** Produces/consumes/depends-on analysis for one planned request. */
export interface RequestDependencyAnalysis {
  readonly requestId: string;
  readonly produces: readonly string[];
  readonly consumes: readonly string[];
  /**
   * Tokens from `@depends-on` in authored order — bare `@name` or
   * `Folder/Name` human refs (ADR 0002). Never discovery path#index or `req_*`.
   */
  readonly dependsOnNames: readonly string[];
}

/** Directed dependency graph over a plan's request ids. */
export interface DependencyGraph {
  readonly nodes: readonly string[];
  readonly edges: readonly import('../collection-runner').DependencyEdge[];
}

/**
 * Result of `enrichRunPlanWithDependencies`. Failure codes are fail-closed:
 * the caller must not start the run when `ok` is false.
 */
export type PlanEnrichmentResult =
  | {
      readonly ok: true;
      readonly plan: RunPlan;
      readonly graph: DependencyGraph;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'DEPENDENCY_CYCLE'
        | 'AMBIGUOUS_DEPENDS_ON'
        | 'UNKNOWN_DEPENDS_ON_TARGET';
      readonly message: string;
      readonly cycles?: readonly (readonly string[])[];
    };
