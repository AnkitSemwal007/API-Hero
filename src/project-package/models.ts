import {
  PROJECT_PACKAGE_FORMAT,
  PROJECT_PACKAGE_FORMAT_VERSION,
  PROJECT_PACKAGE_KIND,
} from './constants';

export interface ProjectPackageFileEntry {
  readonly path: string;
  readonly sha256: string;
}

export interface ProjectPackageManifest {
  readonly format: typeof PROJECT_PACKAGE_FORMAT;
  readonly kind: typeof PROJECT_PACKAGE_KIND;
  readonly formatVersion: typeof PROJECT_PACKAGE_FORMAT_VERSION;
  readonly projectName: string;
  readonly createdAt: string;
  readonly apiHeroVersion: string;
  readonly collectionsDirectory: string;
  readonly files: readonly ProjectPackageFileEntry[];
}

export interface PackedProjectFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

export type ProjectPackageResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: import('./errors').ProjectPackageErrorCode;
      readonly message: string;
    };

export interface ExportProjectSuccess {
  readonly bytes: Uint8Array;
  readonly manifest: ProjectPackageManifest;
  readonly fileCount: number;
}

export interface ImportProjectSuccess {
  readonly projectName: string;
  readonly collectionsDirectory: string;
  readonly writtenPaths: readonly string[];
}

export interface ImportProjectOptions {
  /**
   * When true, replace packaged roots (collections directory and tracked
   * `.apihero` documents) while preserving `.apihero/local/`.
   */
  readonly overwrite?: boolean;
}
