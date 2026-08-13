/**
 * VS Code commands for API Hero Project Package v1 export and import.
 */

import {
  commands,
  Uri,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
} from 'vscode';

import { registerCommandWithLegacyAlias } from '../../commands';
import { COMMAND_IDS } from '../../constants';
import { describeFilesystemFailure, type Logger } from '../../shared';
import {
  PROJECT_PACKAGE_FILE_EXTENSION,
  exportProjectPackage,
  importProjectPackage,
  inspectProjectPackage,
  sanitizeProjectName,
} from '../index';
import { VsCodePackageFilesystem } from './package-filesystem';
import { VsCodeCollectionFilesystem } from '../../collections/vscode/mutation-filesystem';
import { ensureProjectStoreGitignore } from '../../project-store';
import { getActiveProjectStoreCoordinator } from '../../project-store/vscode';

export interface RegisterProjectPackageOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
}

export function registerProjectPackage(
  options: RegisterProjectPackageOptions,
): { readonly disposables: readonly Disposable[] } {
  const filesystem = new VsCodePackageFilesystem();
  const textFilesystem = new VsCodeCollectionFilesystem();

  const exportCommand = registerCommandWithLegacyAlias(
    COMMAND_IDS.exportProject,
    async () => {
      const folder = await pickWorkspaceFolder('Export Project');
      if (folder === undefined) {
        return;
      }
      const result = await exportProjectPackage(
        filesystem,
        folder.uri.fsPath,
        folder.name,
      );
      if (!result.ok) {
        await window.showErrorMessage(result.message);
        return;
      }
      const defaultName = `${sanitizeProjectName(folder.name)}${PROJECT_PACKAGE_FILE_EXTENSION}`;
      const uri = await window.showSaveDialog({
        defaultUri: Uri.joinPath(folder.uri, defaultName),
        saveLabel: 'Export Project',
        filters: { 'API Hero Project': ['apihero'] },
      });
      if (uri === undefined) {
        return;
      }
      const packageUri = ensureApiHeroUri(uri);
      try {
        await filesystem.writeBytes(packageUri.fsPath, result.value.bytes);
      } catch (error: unknown) {
        const permission = describeFilesystemFailure(error);
        await window.showErrorMessage(
          permission ?? 'API Hero could not write the project package.',
        );
        return;
      }
      await window.showInformationMessage(
        `Exported ${result.value.manifest.projectName} (${result.value.fileCount} files).`,
      );
    },
  );

  const importCommand = registerCommandWithLegacyAlias(
    COMMAND_IDS.importProject,
    async () => {
      const picked = await window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'API Hero Project': ['apihero'] },
        openLabel: 'Import Project',
      });
      const packageUri = picked?.[0];
      if (packageUri === undefined) {
        return;
      }
      let bytes: Uint8Array;
      try {
        bytes = await filesystem.readBytes(packageUri.fsPath);
      } catch (error: unknown) {
        const permission = describeFilesystemFailure(error);
        await window.showErrorMessage(
          permission ?? 'API Hero could not read the project package.',
        );
        return;
      }
      const inspected = await inspectProjectPackage(bytes);
      if (!inspected.ok) {
        await window.showErrorMessage(inspected.message);
        return;
      }
      const destination = await window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Destination Folder',
        title: 'Import API Hero Project',
      });
      const destinationUri = destination?.[0];
      if (destinationUri === undefined) {
        return;
      }
      let imported = await importProjectPackage(
        filesystem,
        destinationUri.fsPath,
        bytes,
      );
      if (!imported.ok && imported.code === 'destination-conflict') {
        const choice = await window.showWarningMessage(
          'The selected folder already contains an API Hero project. Replace packaged Collections and project configuration? Local secrets in .apihero/local/ are kept.',
          { modal: true },
          'Overwrite',
        );
        if (choice !== 'Overwrite') {
          return;
        }
        imported = await importProjectPackage(
          filesystem,
          destinationUri.fsPath,
          bytes,
          { overwrite: true },
        );
      }
      if (!imported.ok) {
        await window.showErrorMessage(imported.message);
        return;
      }
      try {
        await ensureProjectStoreGitignore(textFilesystem, destinationUri.fsPath);
      } catch (error: unknown) {
        options.logger.warning('Could not update .gitignore after import', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const current = workspace.workspaceFolders?.[0]?.uri.fsPath;
      const sameFolder =
        current !== undefined &&
        normalize(current) === normalize(destinationUri.fsPath);
      if (sameFolder) {
        await getActiveProjectStoreCoordinator()?.refreshCache(
          destinationUri.fsPath,
        );
        await commands.executeCommand(COMMAND_IDS.refreshCollections);
        await window.showInformationMessage(
          `Imported ${imported.value.projectName}.`,
        );
        return;
      }
      const open = await window.showInformationMessage(
        `Imported ${imported.value.projectName}. Open the folder now?`,
        'Open Folder',
      );
      if (open === 'Open Folder') {
        await commands.executeCommand('vscode.openFolder', destinationUri);
      }
    },
  );

  const disposables = [exportCommand, importCommand];
  options.context.subscriptions.push(...disposables);
  return { disposables };
}

async function pickWorkspaceFolder(
  title: string,
): Promise<{ name: string; uri: Uri } | undefined> {
  const folders = workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    await window.showWarningMessage(
      'Open a folder workspace to export an API Hero project.',
    );
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }
  const picked = await window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    { title, placeHolder: 'Select a workspace folder' },
  );
  return picked?.folder;
}

function normalize(path: string): string {
  return path.replace(/\\/gu, '/').replace(/\/+$/u, '');
}

function ensureApiHeroUri(uri: Uri): Uri {
  const path = uri.fsPath;
  if (path.toLowerCase().endsWith(PROJECT_PACKAGE_FILE_EXTENSION)) {
    return uri;
  }
  return Uri.file(`${path}${PROJECT_PACKAGE_FILE_EXTENSION}`);
}
