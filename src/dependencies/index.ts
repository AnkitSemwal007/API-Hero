/**
 * Dependency graph domain (Phase 2). No `vscode` imports.
 */

export {
  parseDependRef,
  formatDependRef,
  isMinimalUniqueRef,
  minimalDependRefFor,
  resolveDependRef,
  nameContainsPathSeparator,
  buildDependRefIndex,
  type DependRef,
  type DependRefIndexEntry,
  type ResolveDependRefResult,
} from './depend-ref';
export {
  planDependRefRewrites,
  rewriteDependsOnTokens,
  tokenTargetsRenamedRequest,
  dependRefAfterRename,
  type RenameDependRefsIdentity,
  type DependOnDocumentSnapshot,
  type DependOnRewrite,
} from './rename-depend-refs';
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
export {
  analyzeCollectionDependencies,
  contentFingerprint,
  isProjectionFailure,
  projectVariableDependencies,
  type AmbiguousProducerView,
  type AnalyzeCollectionDependenciesOptions,
  type AutoDependencyView,
  type CollectionDependencyRequestRef,
  type ManualDependencyView,
  type ProjectVariableDependenciesOptions,
  type ProjectVariableDependenciesResult,
  type VariableDependencyProjection,
} from './variable-dependency-facade';

