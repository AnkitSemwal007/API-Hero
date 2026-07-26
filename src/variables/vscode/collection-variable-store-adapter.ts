/**
 * VS Code filesystem + `.apihero/local/variables.local.json` overlay ports
 * for {@link FilesystemCollectionVariableStore} (§3.2). Sensitive collection
 * values live in the same workspace-root-scoped overlay file as environment
 * and workspace variables; entries are keyed by the (globally unique)
 * collectionId, so binding to one workspace root — the primary folder,
 * mirroring the settings-migration-owner rule in `resolve-project-folder.ts`
 * — is sufficient even for multi-root workspaces.
 */

import { VsCodeCollectionFilesystem } from '../../collections/vscode';
import {
  readVariablesLocalOverlay,
  writeVariablesLocalOverlay,
} from '../../project-store';
import { resolveProjectStoreFolderPath } from '../../project-store/vscode';
import type { CollectionVariableStorePorts } from '../collection-variable-store';

/** Builds ports for {@link FilesystemCollectionVariableStore} over `workspace.fs`. */
export function createCollectionVariableStorePorts(): CollectionVariableStorePorts {
  const filesystem = new VsCodeCollectionFilesystem();
  return {
    readText: (path) => filesystem.readText(path),
    writeText: (path, text) => filesystem.writeText(path, text),
    exists: (path) => filesystem.exists(path),
    createDirectory: (path) => filesystem.createDirectory(path),
    readLocalOverlay: async () => {
      const folder = resolveProjectStoreFolderPath();
      if (folder === undefined) {
        return { collections: {} };
      }
      const document = await readVariablesLocalOverlay(filesystem, folder);
      return { collections: document.collections ?? {} };
    },
    writeLocalOverlay: async (collections) => {
      const folder = resolveProjectStoreFolderPath();
      if (folder === undefined) {
        return false;
      }
      const existing = await readVariablesLocalOverlay(filesystem, folder);
      await writeVariablesLocalOverlay(filesystem, folder, {
        ...existing,
        collections,
      });
      return true;
    },
  };
}
