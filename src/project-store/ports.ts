/**
 * Filesystem port for the project store.
 * Reuses the collections mutation port — one VS Code `workspace.fs` adapter.
 */

export type {
  CollectionDirectoryEntry as ProjectStoreDirectoryEntry,
  CollectionFilesystem as ProjectStoreFilesystem,
} from '../collections/mutation/ports';
