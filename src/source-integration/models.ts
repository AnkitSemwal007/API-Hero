import type { Range } from '../parser/types';

/** Explicit mapping kinds authored in source comments. */
export type SourceAnnotationKind = 'name' | 'request' | 'id';

/** One `@api-hero` / `@apiHero` annotation on a source line. */
export interface SourceAnnotation {
  readonly kind: SourceAnnotationKind;
  readonly value: string;
}

/**
 * A source location that carries explicit API Hero annotations.
 * `line` is the first non-comment code line the CodeLens should attach to.
 */
export interface SourceAnnotationSite {
  readonly line: number;
  readonly character: number;
  readonly annotations: readonly SourceAnnotation[];
}

/** Parsed `@source` directive value. `line` is 0-based when present. */
export interface SourceLocationRef {
  readonly path: string;
  readonly line?: number;
}

/** Protocol-agnostic request metadata used for mapping, hover, and CodeLens. */
export interface CatalogRequest {
  readonly id: string;
  readonly filePath: string;
  readonly relativePath: string;
  readonly workspaceRootPath: string;
  readonly requestIndex: number;
  readonly method: string;
  readonly url: string;
  readonly name: string;
  /** Effective protocol. Missing `@protocol` is HTTP. */
  readonly protocol: string;
  readonly sourceRef?: string;
  readonly range: Range;
  readonly legacyAuthoredId?: string;
}

export type MappingResolveKind = 'match' | 'none' | 'ambiguous';

export type MappingResolveResult =
  | { readonly kind: 'match'; readonly request: CatalogRequest }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly count: number };

export interface AnnotationResolveContext {
  readonly sourceFilePath: string;
  readonly workspaceRoots: readonly string[];
}

export interface SourceCodeLensCommand {
  readonly id: string;
  readonly title: string;
  readonly argument: SourceMappingArgument;
}

export interface SourceCodeLensDescriptor {
  readonly line: number;
  readonly character: number;
  readonly command: SourceCodeLensCommand;
}

/** Serializable CodeLens / command payload pointing at a mapped `.api` request. */
export interface SourceMappingArgument {
  readonly uri: string;
  readonly position: {
    readonly line: number;
    readonly character: number;
  };
}
