/**
 * Registers automatic `.apihero` migration on activate and folder changes.
 */

import {
  commands,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
} from 'vscode';

import { COMMAND_IDS } from '../../constants';
import { fireAndForget, type Logger } from '../../shared';
import { VsCodeCollectionFilesystem } from '../../collections/vscode/mutation-filesystem';
import { SecretStorageService } from '../../storage';
import {
  ProjectStoreCoordinator,
  setActiveProjectStoreCoordinator,
} from './project-store-coordinator';
import { readLegacySettingsSnapshot } from './settings-snapshot';

export interface ProjectStoreRegistration {
  readonly coordinator: ProjectStoreCoordinator;
  readonly disposables: readonly Disposable[];
}

/**
 * Migrates each workspace folder (awaited), then watches folder changes.
 * Must run before Environment Manager / Auth first capture when possible.
 *
 * Settings migration owner is always `workspaceFolders[0]` (primary).
 * Secondary folders may get an empty store when Collections/ exist, but never
 * receive a clone of workspace settings.
 */
export async function registerProjectStore(
  context: ExtensionContext,
  logger: Logger,
): Promise<ProjectStoreRegistration> {
  const filesystem = new VsCodeCollectionFilesystem();
  const secretStorage = new SecretStorageService(context.secrets);
  const coordinator = new ProjectStoreCoordinator(
    filesystem,
    logger,
    secretStorage,
  );
  setActiveProjectStoreCoordinator(coordinator);

  await migrateAllFolders(coordinator, logger);

  const folderWatcher = workspace.onDidChangeWorkspaceFolders((event) => {
    for (const folder of event.added) {
      fireAndForget(
        migrateOneFolder(coordinator, folder.uri.fsPath, isPrimaryFolder(folder.uri.fsPath), logger),
        (error: unknown) => {
          logger.warning('Project store migration failed after folder change', {
            folder: folder.uri.fsPath,
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
    }
  });

  const initializeCommand = commands.registerCommand(
    COMMAND_IDS.initializeProjectStore,
    async () => {
      const folder =
        workspace.workspaceFolders?.[0] ??
        (await pickFolder());
      if (folder === undefined) {
        return;
      }
      const rootPath = typeof folder === 'string' ? folder : folder.uri.fsPath;
      try {
        // Primary may receive settings migration; ensureInitialized never clones.
        if (isPrimaryFolder(rootPath)) {
          await coordinator.migrateFolder({
            workspaceRootPath: rootPath,
            settings: readLegacySettingsSnapshot(),
            allowSettingsMigration: true,
          });
        }
        await coordinator.ensureInitialized(rootPath);
        void window.showInformationMessage(
          `API Hero: Project store ready at ${rootPath}/.apihero`,
        );
      } catch (error) {
        logger.error('Failed to initialize project store', error, {
          workspaceRootPath: rootPath,
        });
        void window.showErrorMessage(
          `API Hero: Failed to initialize project store — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  );

  const disposables: Disposable[] = [
    folderWatcher,
    initializeCommand,
    {
      dispose: () => {
        setActiveProjectStoreCoordinator(undefined);
      },
    },
  ];
  context.subscriptions.push(...disposables);

  return { coordinator, disposables };
}

async function migrateAllFolders(
  coordinator: ProjectStoreCoordinator,
  logger: Logger,
): Promise<void> {
  const folders = workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return;
  }
  const settings = readLegacySettingsSnapshot();
  for (let index = 0; index < folders.length; index += 1) {
    const folder = folders[index];
    if (folder === undefined) {
      continue;
    }
    try {
      // Primary (index 0) only: allowSettingsMigration true.
      await migrateOneFolder(
        coordinator,
        folder.uri.fsPath,
        index === 0,
        logger,
        settings,
      );
    } catch (error) {
      logger.warning('Project store migration failed', {
        folder: folder.uri.fsPath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function migrateOneFolder(
  coordinator: ProjectStoreCoordinator,
  workspaceRootPath: string,
  allowSettingsMigration: boolean,
  logger: Logger,
  settings = readLegacySettingsSnapshot(),
): Promise<void> {
  try {
    await coordinator.migrateFolder({
      workspaceRootPath,
      settings,
      allowSettingsMigration,
    });
  } catch (error) {
    logger.warning('Project store migration failed', {
      folder: workspaceRootPath,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function isPrimaryFolder(fsPath: string): boolean {
  const primary = workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (primary === undefined) {
    return false;
  }
  return normalize(primary) === normalize(fsPath);
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

async function pickFolder(): Promise<{ uri: { fsPath: string } } | undefined> {
  const folders = workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    void window.showWarningMessage(
      'API Hero: Open a folder workspace to initialize the project store.',
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
    { title: 'Initialize Project Store', placeHolder: 'Select a workspace folder' },
  );
  return picked?.folder;
}

