/**
 * Dependency graph domain (Phase 2). No `vscode` imports.
 */

export {
  parseDependsOnDirective,
  uniqueDependsOnNames,
  type ParseDependsOnDirectiveResult,
} from './parse-depends-on';
export type {
  DependenciesExtension,
  DependencyEdge,
  DependencyEdgeKind,
  DependencyGraph,
  DependencyNodeMeta,
  PlanEnrichmentResult,
  RequestDependencyAnalysis,
  VariablesPerRunExtension,
} from './models';
export { analyzeProducesConsumesForDocument } from './produces-consumes';
export {
  buildDependencyGraph,
  type BuildDependencyGraphOptions,
  type BuildDependencyGraphResult,
} from './graph-builder';
export { detectCycles, type CycleDetectionResult } from './cycle-detector';
export { topoSort, type TopoSortOptions, type TopoSortResult } from './topo-sort';
export {
  enrichRunPlanWithDependencies,
  type EnrichRunPlanOptions,
} from './plan-enricher';
export {
  analyzeRunPlanDependencies,
  type AnalyzeRunPlanDependenciesPorts,
} from './analyze-plan';
