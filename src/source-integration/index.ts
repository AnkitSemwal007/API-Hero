export { parseAnnotationLine, parseSourceAnnotations } from './annotation';
export {
  buildSourceIntegrationCatalog,
} from './catalog';
export type { SourceIntegrationCatalog } from './catalog';
export {
  catalogFromWorkspace,
  catalogRequestsFromSnapshot,
} from './from-workspace';
export type { CatalogDocumentOverlay } from './from-workspace';
export {
  createApiFileSourceCodeLensDescriptors,
  createSourceFileCodeLensDescriptors,
} from './codelens';
export { formatProtocol, formatRequestHover, sanitizeHoverLabel } from './hover';
export {
  collidingGeneratedTypeNames,
  collectExportedTypeNames,
  prepareGeneratedTypeInsertion,
} from './type-insertion';
export {
  parseSourceDirectiveValue,
  sourcePathMatches,
} from './source-ref';
export type {
  AnnotationResolveContext,
  CatalogRequest,
  MappingResolveResult,
  SourceAnnotation,
  SourceAnnotationKind,
  SourceAnnotationSite,
  SourceCodeLensCommand,
  SourceCodeLensDescriptor,
  SourceLocationRef,
  SourceMappingArgument,
} from './models';
export type { RequestHoverContent } from './hover';
