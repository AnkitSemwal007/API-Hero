/**
 * Registers collection mutation commands for the Collections tree.
 *
 * Create Collection prompts for name (and optional description) before any
 * filesystem write. Create Folder still follows Explorer create-then-rename.
 * Name prompts use the shared CRUD webview dialog.
 */

import {
  Uri,
  commands,
  window,
  workspace,
  type Disposable,
  type TreeView,
} from 'vscode';

import { registerCommandWithLegacyAlias } from '../../commands';

import { COMMAND_IDS, REQUEST_EDITOR_VIEW_TYPE } from '../../constants';
import { describeFilesystemFailure, type Logger } from '../../shared';
import type { CollectionDiscoveryService } from '../discovery';
import type { Collection } from '../models';
import {
  CollectionMutationError,
  CollectionMutationService,
  allocateUniqueName,
  pathBasename,
  pathDirname,
  stripApiExtension,
  validateCollectionDirectoryName,
  validateDirectoryName,
  type CreateCollectionResult,
} from '../mutation';
import type { CollectionNameCollisionChoice } from '../transfer';
import type { CollectionTreeNode } from '../tree-projection';
import {
  findTreeNodeByCollectionId,
  findTreeNodeByFolderPath,
  findTreeNodeByRequestFilePath,
} from '../tree-projection';
import { openCrudPromptDialog } from './crud-prompt-dialog';
import { openDestinationPickerDialog } from './destination-picker-dialog';
import {
  buildNewRequestDestinations,
  openNewRequestDialog,
} from './new-request-dialog';
import { getActiveProjectStoreCoordinator } from '../../project-store/vscode';

export interface RegisterMutationCommandsOptions {
  readonly discovery: CollectionDiscoveryService;
  readonly mutation: CollectionMutationService;
  readonly treeView: TreeView<CollectionTreeNode>;
  readonly logger: Logger;
}

const CRUD_STATUS_MS = 3_000;

/** Brief status-bar feedback for successful collection CRUD (not modal toasts). */
function notifyCrudSuccess(message: string): void {
  window.setStatusBarMessage(message, CRUD_STATUS_MS);
}

/** Registers mutation command handlers; returns disposables. */
export function registerMutationCommands(
  options: RegisterMutationCommandsOptions,
): Disposable[] {
  const { discovery, mutation, treeView, logger } = options;

  const run = async (
    label: string,
    action: () => Promise<void>,
  ): Promise<void> => {
    try {
      await action();
    } catch (error) {
      const message = userFacingMutationFailure(error);
      logger.warning(`Collections ${label} failed`, {
        message: error instanceof Error ? error.message : String(error),
      });
      void window.showErrorMessage(`API Hero: ${message}`);
    }
  };

  return [
    registerCommandWithLegacyAlias(COMMAND_IDS.createCollection, async () => {
      await run('createCollection', async () => {
        const workspaceRoot = await pickWorkspaceRootPath();
        if (workspaceRoot === undefined) {
          return;
        }
        const existing = listNativeCollectionNames(discovery, workspaceRoot);
        let collectionId: string | undefined;
        const submitted = await openCrudPromptDialog({
          title: 'Create Collection',
          subtitle:
            'Collections live under Collections/ in your workspace.',
          fieldLabel: 'Name',
          placeholder: 'My APIs',
          initialValue: '',
          submitLabel: 'Create',
          descriptionFieldLabel: 'Description',
          descriptionPlaceholder: 'Optional',
          initialDescription: '',
          validateName: (name) => {
            const validated = validateCollectionDirectoryName(name);
            return validated.error;
          },
          onSubmit: async (value, extras) => {
            const validated = validateCollectionDirectoryName(value);
            if (validated.value === undefined) {
              throw new Error(validated.error ?? 'Name is required.');
            }
            if (existing.includes(validated.value)) {
              throw new Error(
                `A collection named "${validated.value}" already exists.`,
              );
            }
            const projectStore = getActiveProjectStoreCoordinator();
            if (projectStore !== undefined) {
              // Initialize only after Create — Cancel must not write .apihero.
              // Never clone workspace settings into a user-picked (possibly secondary) folder.
              await projectStore.ensureInitialized(workspaceRoot);
            }
            const created = await mutation.createCollection(
              workspaceRoot,
              validated.value,
              extras?.description,
            );
            collectionId = created.collectionId;
            await revealCollectionNode(discovery, treeView, collectionId);
          },
        });
        if (submitted === undefined || collectionId === undefined) {
          return;
        }
        await revealCollectionNode(discovery, treeView, collectionId);
        notifyCrudSuccess('API Hero: Collection created');
      });
    }),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.renameCollection,
      async (target: unknown) => {
        await run('renameCollection', async () => {
          const node = asNode(target) ?? firstSelection(treeView, 'collection');
          const collection = resolveCollection(discovery, node);
          if (collection === undefined || collection.kind !== 'native') {
            void window.showWarningMessage(
              'Select a collection under Collections/ to rename.',
            );
            return;
          }
          let collectionId = collection.id;
          const previousLabel = collection.display.label;
          const submitted = await openCrudPromptDialog({
            title: 'Rename Collection',
            fieldLabel: 'Name',
            placeholder: previousLabel,
            initialValue: previousLabel,
            submitLabel: 'Rename',
            validateName: (name) => validateCollectionDirectoryName(name).error,
            onSubmit: async (value) => {
              if (value === previousLabel) {
                return;
              }
              const result = await mutation.renameCollection(
                collectionId,
                value,
              );
              collectionId = result.collectionId;
              await revealCollectionNode(discovery, treeView, collectionId);
            },
          });
          await revealCollectionNode(discovery, treeView, collectionId);
          if (submitted !== undefined && submitted !== previousLabel) {
            notifyCrudSuccess('API Hero: Collection renamed');
          }
        });
      },
    ),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.deleteCollection,
      async (target: unknown) => {
        await run('deleteCollection', async () => {
          const node = asNode(target) ?? firstSelection(treeView, 'collection');
          const collection = resolveCollection(discovery, node);
          if (collection === undefined || collection.kind !== 'native') {
            void window.showWarningMessage(
              'Select a collection under Collections/ to delete.',
            );
            return;
          }
          const confirm = await window.showWarningMessage(
            `Delete collection "${collection.display.label}" and all of its files?`,
            { modal: true },
            'Delete',
          );
          if (confirm !== 'Delete') {
            return;
          }
          await mutation.deleteCollection(collection.id);
          notifyCrudSuccess('API Hero: Collection deleted');
        });
      },
    ),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.duplicateCollection,
      async (target: unknown) => {
        await run('duplicateCollection', async () => {
          const node = asNode(target) ?? firstSelection(treeView, 'collection');
          const collection = resolveCollection(discovery, node);
          if (collection === undefined || collection.kind !== 'native') {
            void window.showWarningMessage(
              'Select a collection under Collections/ to duplicate.',
            );
            return;
          }
          const result = await mutation.duplicateCollection(collection.id);
          await revealCollectionNode(discovery, treeView, result.collectionId);
          notifyCrudSuccess('API Hero: Collection duplicated');
        });
      },
    ),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.exportCollection,
      async (target: unknown) => {
        await run('exportCollection', async () => {
          const node = asNode(target) ?? firstSelection(treeView, 'collection');
          const collection = resolveCollection(discovery, node);
          if (collection === undefined || collection.kind !== 'native') {
            void window.showWarningMessage(
              'Select a collection under Collections/ to export.',
            );
            return;
          }

          const picked = await window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Export Here',
            title: 'Export Collection — choose destination folder',
          });
          if (picked === undefined || picked.length === 0) {
            return;
          }

          const destinationParent = pathFromUri(picked[0]!);
          const preferredName = pathBasename(collection.rootPath);
          const collision = await promptCollisionIfExists(
            joinPath(destinationParent, preferredName),
            `A folder named "${preferredName}" already exists in the destination.`,
          );
          if (collision === 'abort') {
            return;
          }

          const result = await mutation.exportCollection(
            collection.id,
            destinationParent,
            { collision },
          );
          notifyCrudSuccess(
            `API Hero: Exported "${preferredName}" to ${result.exportPath}`,
          );
        });
      },
    ),
    registerCommandWithLegacyAlias(COMMAND_IDS.importCollection, async () => {
      await run('importCollection', async () => {
        const workspaceRoot = await pickWorkspaceRootPath();
        if (workspaceRoot === undefined) {
          return;
        }

        const picked = await window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: 'Import',
          title: 'Import Collection — choose a collection folder',
        });
        if (picked === undefined || picked.length === 0) {
          return;
        }

        const sourcePath = pathFromUri(picked[0]!);
        const result = await importCollectionWithCollisionPrompt(
          mutation,
          workspaceRoot,
          sourcePath,
        );
        if (result === undefined) {
          return;
        }
        notifyCrudSuccess(
          `API Hero: Imported collection into ${result.rootPath}`,
        );
      });
    }),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.createFolder,
      async (target: unknown) => {
        await run('createFolder', async () => {
          const destination = resolveCreateDestination(
            discovery,
            treeView,
            asNode(target),
          );
          if (destination === undefined) {
            void window.showWarningMessage(
              'Select a native collection or folder to create a folder in.',
            );
            return;
          }
          const existing = listSiblingFolderNames(
            discovery,
            destination.collectionId,
            destination.folderRelativePath,
          );
          const defaultName = allocateUniqueName(
            'New Folder',
            (candidate) => existing.includes(candidate),
          );
          const created = await mutation.createFolder(
            destination.collectionId,
            destination.folderRelativePath,
            defaultName,
          );
          let relativePath = created.relativePath;
          await revealFolderNode(
            discovery,
            treeView,
            destination.collectionId,
            relativePath,
          );
          const submitted = await openCrudPromptDialog({
            title: 'Rename Folder',
            subtitle: 'Rename now, or Cancel to keep the default name.',
            fieldLabel: 'Name',
            placeholder: defaultName,
            initialValue: defaultName,
            submitLabel: 'Rename',
            validateName: (name) => validateDirectoryName(name, 'Folder').error,
            onSubmit: async (value) => {
              if (value === defaultName) {
                return;
              }
              const result = await mutation.renameFolder(
                destination.collectionId,
                relativePath,
                value,
              );
              relativePath = result.relativePath;
              await revealFolderNode(
                discovery,
                treeView,
                destination.collectionId,
                relativePath,
              );
            },
          });
          await revealFolderNode(
            discovery,
            treeView,
            destination.collectionId,
            relativePath,
          );
          if (submitted !== undefined) {
            notifyCrudSuccess(
              submitted === defaultName
                ? 'API Hero: Folder created'
                : 'API Hero: Folder renamed',
            );
          }
        });
      },
    ),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.renameFolder,
      async (target: unknown) => {
        await run('renameFolder', async () => {
          const folder = resolveFolder(
            discovery,
            asNode(target) ?? firstSelection(treeView, 'folder'),
          );
          if (folder === undefined) {
            void window.showWarningMessage('Select a folder to rename.');
            return;
          }
          let relativePath = folder.relativePath;
          const previousLabel = folder.label;
          const submitted = await openCrudPromptDialog({
            title: 'Rename Folder',
            fieldLabel: 'Name',
            placeholder: previousLabel,
            initialValue: previousLabel,
            submitLabel: 'Rename',
            validateName: (name) => validateDirectoryName(name, 'Folder').error,
            onSubmit: async (value) => {
              if (value === previousLabel) {
                return;
              }
              const result = await mutation.renameFolder(
                folder.collectionId,
                relativePath,
                value,
              );
              relativePath = result.relativePath;
              await revealFolderNode(
                discovery,
                treeView,
                folder.collectionId,
                relativePath,
              );
            },
          });
          await revealFolderNode(
            discovery,
            treeView,
            folder.collectionId,
            relativePath,
          );
          if (submitted !== undefined && submitted !== previousLabel) {
            notifyCrudSuccess('API Hero: Folder renamed');
          }
        });
      },
    ),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.deleteFolder,
      async (target: unknown) => {
        await run('deleteFolder', async () => {
          const folder = resolveFolder(
            discovery,
            asNode(target) ?? firstSelection(treeView, 'folder'),
          );
          if (folder === undefined) {
            void window.showWarningMessage('Select a folder to delete.');
            return;
          }
          const confirm = await window.showWarningMessage(
            `Delete folder "${folder.label}" and all of its contents?`,
            { modal: true },
            'Delete',
          );
          if (confirm !== 'Delete') {
            return;
          }
          await mutation.deleteFolder(
            folder.collectionId,
            folder.relativePath,
          );
          notifyCrudSuccess('API Hero: Folder deleted');
        });
      },
    ),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.duplicateFolder,
      async (target: unknown) => {
        await run('duplicateFolder', async () => {
          const folder = resolveFolder(
            discovery,
            asNode(target) ?? firstSelection(treeView, 'folder'),
          );
          if (folder === undefined) {
            void window.showWarningMessage('Select a folder to duplicate.');
            return;
          }
          const result = await mutation.duplicateFolder(
            folder.collectionId,
            folder.relativePath,
          );
          await revealFolderNode(
            discovery,
            treeView,
            folder.collectionId,
            result.relativePath,
          );
          notifyCrudSuccess('API Hero: Folder duplicated');
        });
      },
    ),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.createRequest,
      async (target: unknown) => {
        await run('createRequest', async () => {
          const destination = resolveCreateDestination(
            discovery,
            treeView,
            asNode(target),
          );
          const aggregate = discovery.snapshot;
          const destinations = buildNewRequestDestinations(
            aggregate === undefined
              ? []
              : Object.values(aggregate.collections),
          );
          if (destinations.length === 0) {
            void window.showWarningMessage(
              'Create a collection first (New Collection), then add a request.',
            );
            return;
          }

          const created = await openNewRequestDialog({
            destinations,
            ...(destination !== undefined
              ? {
                  preselectedCollectionId: destination.collectionId,
                  preselectedFolderRelativePath:
                    destination.folderRelativePath,
                }
              : {}),
            onCreate: async (result) => {
              const written = await mutation.createRequestFromModel(
                result.collectionId,
                result.folderRelativePath,
                result.model,
              );
              await openApiFile(written.filePath);
              await revealRequestFileNode(
                discovery,
                treeView,
                written.filePath,
              );
            },
          });
          if (created) {
            notifyCrudSuccess('API Hero: Request created');
          }
        });
      },
    ),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.renameRequest,
      async (target: unknown) => {
        await run('renameRequest', async () => {
          const request = resolveRequest(
            discovery,
            asNode(target) ?? firstSelection(treeView, 'request'),
          );
          if (request === undefined) {
            void window.showWarningMessage('Select a request to rename.');
            return;
          }
          if (request.collectionKind !== 'native') {
            void window.showWarningMessage(
              'Rename is available for requests under Collections/. Move the file into a collection first.',
            );
            return;
          }
          const current = stripApiExtension(pathBasename(request.filePath));
          let filePath = request.filePath;
          const submitted = await openCrudPromptDialog({
            title: 'Rename Request',
            fieldLabel: 'Name',
            placeholder: current,
            initialValue: current,
            submitLabel: 'Rename',
            onSubmit: async (value) => {
              if (value === current) {
                return;
              }
              const result = await mutation.renameRequest(
                request.collectionId,
                filePath,
                value,
              );
              filePath = result.filePath;
              await openApiFile(filePath);
              await revealRequestFileNode(discovery, treeView, filePath);
            },
          });
          await revealRequestFileNode(discovery, treeView, filePath);
          if (submitted !== undefined && submitted !== current) {
            notifyCrudSuccess('API Hero: Request renamed');
          }
        });
      },
    ),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.duplicateRequest,
      async (target: unknown) => {
        await run('duplicateRequest', async () => {
          const request = resolveRequest(
            discovery,
            asNode(target) ?? firstSelection(treeView, 'request'),
          );
          if (request === undefined) {
            void window.showWarningMessage('Select a request to duplicate.');
            return;
          }
          if (request.collectionKind !== 'native') {
            void window.showWarningMessage(
              'Duplicate is available for requests under Collections/.',
            );
            return;
          }
          const result = await mutation.duplicateRequest(
            request.collectionId,
            request.filePath,
          );
          await openApiFile(result.filePath);
          await revealRequestFileNode(discovery, treeView, result.filePath);
          notifyCrudSuccess('API Hero: Request duplicated');
        });
      },
    ),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.deleteRequest,
      async (target: unknown) => {
        await run('deleteRequest', async () => {
          const request = resolveRequest(
            discovery,
            asNode(target) ?? firstSelection(treeView, 'request'),
          );
          if (request === undefined) {
            void window.showWarningMessage('Select a request to delete.');
            return;
          }
          const confirm = await window.showWarningMessage(
            `Delete request file "${pathBasename(request.filePath)}"?`,
            { modal: true },
            'Delete',
          );
          if (confirm !== 'Delete') {
            return;
          }
          await mutation.deleteRequest(
            request.collectionId,
            request.filePath,
          );
          notifyCrudSuccess('API Hero: Request deleted');
        });
      },
    ),
    registerCommandWithLegacyAlias(
      COMMAND_IDS.moveRequest,
      async (target: unknown) => {
        await run('moveRequest', async () => {
          const request = resolveRequest(
            discovery,
            asNode(target) ?? firstSelection(treeView, 'request'),
          );
          if (request === undefined) {
            void window.showWarningMessage('Select a request to move.');
            return;
          }
          const destinations = buildNewRequestDestinations(
            discovery.snapshot === undefined
              ? []
              : Object.values(discovery.snapshot.collections),
          );
          if (destinations.length === 0) {
            void window.showWarningMessage(
              'Create a collection under Collections/ before moving a request.',
            );
            return;
          }
          const moved = await openDestinationPickerDialog({
            title: 'Move Request',
            subtitle: 'Choose a collection folder for this request.',
            destinations,
            submitLabel: 'Move Here',
            onSubmit: async (destination) => {
              const result = await mutation.moveRequest(
                request.collectionId,
                request.filePath,
                destination.collectionId,
                destination.folderRelativePath,
              );
              await openApiFile(result.filePath);
              await revealRequestFileNode(
                discovery,
                treeView,
                result.filePath,
              );
            },
          });
          if (moved !== undefined) {
            notifyCrudSuccess('API Hero: Request moved');
          }
        });
      },
    ),
  ];
}

function asNode(target: unknown): CollectionTreeNode | undefined {
  if (
    target !== null &&
    typeof target === 'object' &&
    'kind' in target &&
    typeof (target as CollectionTreeNode).kind === 'string'
  ) {
    return target as CollectionTreeNode;
  }
  return undefined;
}

function firstSelection(
  treeView: TreeView<CollectionTreeNode>,
  kind: CollectionTreeNode['kind'],
): CollectionTreeNode | undefined {
  // Prefer the last selected node (active/focused item under multi-select).
  for (let index = treeView.selection.length - 1; index >= 0; index -= 1) {
    const node = treeView.selection[index];
    if (node?.kind === kind) {
      return node;
    }
  }
  return undefined;
}

function resolveCollection(
  discovery: CollectionDiscoveryService,
  node: CollectionTreeNode | undefined,
): Collection | undefined {
  if (node === undefined || node.kind !== 'collection') {
    return undefined;
  }
  return discovery.snapshot?.collections[node.id];
}

function resolveFolder(
  discovery: CollectionDiscoveryService,
  node: CollectionTreeNode | undefined,
):
  | {
      collectionId: string;
      relativePath: string;
      label: string;
    }
  | undefined {
  if (
    node === undefined ||
    node.kind !== 'folder' ||
    node.collectionId === undefined
  ) {
    return undefined;
  }
  const collection = discovery.snapshot?.collections[node.collectionId];
  const folder = collection?.folders[node.id];
  if (collection === undefined || folder === undefined) {
    return undefined;
  }
  if (collection.kind !== 'native') {
    return undefined;
  }
  return {
    collectionId: collection.id,
    relativePath: folder.relativePath,
    label: folder.display.label,
  };
}

function resolveRequest(
  discovery: CollectionDiscoveryService,
  node: CollectionTreeNode | undefined,
):
  | {
      collectionId: string;
      collectionKind: Collection['kind'];
      filePath: string;
    }
  | undefined {
  if (
    node === undefined ||
    node.kind !== 'request' ||
    node.collectionId === undefined ||
    node.requestId === undefined
  ) {
    return undefined;
  }
  const collection = discovery.snapshot?.collections[node.collectionId];
  const request = collection?.requests[node.requestId];
  if (collection === undefined || request === undefined) {
    return undefined;
  }
  return {
    collectionId: collection.id,
    collectionKind: collection.kind,
    filePath: request.filePath,
  };
}

function resolveCreateDestination(
  discovery: CollectionDiscoveryService,
  treeView: TreeView<CollectionTreeNode>,
  target: CollectionTreeNode | undefined,
): { collectionId: string; folderRelativePath: string } | undefined {
  const node =
    target ??
    firstSelection(treeView, 'folder') ??
    firstSelection(treeView, 'collection');
  if (node === undefined) {
    return undefined;
  }
  if (node.kind === 'collection') {
    const collection = discovery.snapshot?.collections[node.id];
    if (collection === undefined || collection.kind !== 'native') {
      return undefined;
    }
    return { collectionId: collection.id, folderRelativePath: '' };
  }
  if (node.kind === 'folder' && node.collectionId !== undefined) {
    const collection = discovery.snapshot?.collections[node.collectionId];
    const folder = collection?.folders[node.id];
    if (
      collection === undefined ||
      folder === undefined ||
      collection.kind !== 'native'
    ) {
      return undefined;
    }
    return {
      collectionId: collection.id,
      folderRelativePath: folder.relativePath,
    };
  }
  if (
    node.kind === 'request' &&
    node.collectionId !== undefined &&
    node.requestId !== undefined
  ) {
    const collection = discovery.snapshot?.collections[node.collectionId];
    const request = collection?.requests[node.requestId];
    if (collection === undefined || request === undefined) {
      return undefined;
    }
    if (collection.kind !== 'native') {
      return undefined;
    }
    const folderRelativePath =
      request.folderId !== undefined
        ? collection.folders[request.folderId]?.relativePath ?? ''
        : '';
    return { collectionId: collection.id, folderRelativePath };
  }
  return undefined;
}

async function pickWorkspaceRootPath(): Promise<string | undefined> {
  const folders = workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    void window.showErrorMessage(
      'Open a workspace folder before creating a collection.',
    );
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0]!.uri.toString();
  }
  const selected = await window.showWorkspaceFolderPick({
    placeHolder: 'Select the workspace folder for the new collection',
  });
  return selected?.uri.toString();
}

function listNativeCollectionNames(
  discovery: CollectionDiscoveryService,
  workspaceRootPath: string,
): string[] {
  const aggregate = discovery.snapshot;
  if (aggregate === undefined) {
    return [];
  }
  const names: string[] = [];
  for (const collection of Object.values(aggregate.collections)) {
    if (
      collection.kind === 'native' &&
      collection.workspaceRootPath === workspaceRootPath
    ) {
      names.push(pathBasename(collection.rootPath));
    }
  }
  return names;
}

function listSiblingFolderNames(
  discovery: CollectionDiscoveryService,
  collectionId: string,
  parentRelativePath: string,
): string[] {
  const collection = discovery.snapshot?.collections[collectionId];
  if (collection === undefined) {
    return [];
  }
  const parent = parentRelativePath
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const names: string[] = [];
  for (const folder of Object.values(collection.folders)) {
    if (pathDirname(folder.relativePath) === parent) {
      names.push(pathBasename(folder.relativePath));
    }
  }
  return names;
}

/**
 * When `path` already exists, prompts Rename / Overwrite / Cancel.
 * Returns `rename` when the path is free (no collision).
 */
async function promptCollisionIfExists(
  path: string,
  message: string,
): Promise<CollectionNameCollisionChoice> {
  if (!(await pathExists(path))) {
    return 'rename';
  }
  return promptCollisionChoice(message);
}

async function promptCollisionChoice(
  message: string,
): Promise<CollectionNameCollisionChoice> {
  const choice = await window.showWarningMessage(
    message,
    { modal: true },
    'Rename',
    'Overwrite',
  );
  if (choice === 'Rename') {
    return 'rename';
  }
  if (choice === 'Overwrite') {
    return 'overwrite';
  }
  return 'abort';
}

async function importCollectionWithCollisionPrompt(
  mutation: CollectionMutationService,
  workspaceRoot: string,
  sourcePath: string,
): Promise<CreateCollectionResult | undefined> {
  try {
    return await mutation.importCollection(workspaceRoot, sourcePath, {
      collision: 'abort',
    });
  } catch (error) {
    if (!(error instanceof CollectionMutationError)) {
      throw error;
    }
    if (!/already exists/iu.test(error.message)) {
      throw error;
    }
    const collision = await promptCollisionChoice(error.message);
    if (collision === 'abort') {
      return undefined;
    }
    return mutation.importCollection(workspaceRoot, sourcePath, {
      collision,
    });
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await workspace.fs.stat(toUri(path));
    return true;
  } catch {
    return false;
  }
}

function pathFromUri(uri: Uri): string {
  return uri.scheme === 'file' ? uri.fsPath.replace(/\\/g, '/') : uri.toString();
}

function toUri(path: string): Uri {
  return path.includes('://') ? Uri.parse(path) : Uri.file(path);
}

function joinPath(...segments: string[]): string {
  return segments
    .map((segment) => segment.replace(/\\/g, '/').replace(/\/+$/, ''))
    .filter((segment) => segment.length > 0)
    .join('/');
}

/** Opens a `.api` file in the Request Editor (same path as tree open). */
async function openApiFile(filePath: string): Promise<void> {
  const uri = filePath.includes('://')
    ? Uri.parse(filePath)
    : Uri.file(filePath);
  await commands.executeCommand(
    'vscode.openWith',
    uri,
    REQUEST_EDITOR_VIEW_TYPE,
  );
}

async function revealCollectionNode(
  discovery: CollectionDiscoveryService,
  treeView: TreeView<CollectionTreeNode>,
  collectionId: string,
): Promise<void> {
  const aggregate = discovery.snapshot;
  if (aggregate === undefined) {
    return;
  }
  const node = findTreeNodeByCollectionId(aggregate, collectionId);
  if (node === undefined) {
    return;
  }
  await treeView.reveal(node, { select: true, focus: true, expand: true });
}

async function revealFolderNode(
  discovery: CollectionDiscoveryService,
  treeView: TreeView<CollectionTreeNode>,
  collectionId: string,
  relativePath: string,
): Promise<void> {
  const aggregate = discovery.snapshot;
  if (aggregate === undefined) {
    return;
  }
  const node = findTreeNodeByFolderPath(aggregate, collectionId, relativePath);
  if (node === undefined) {
    return;
  }
  await treeView.reveal(node, { select: true, focus: true, expand: true });
}

async function revealRequestFileNode(
  discovery: CollectionDiscoveryService,
  treeView: TreeView<CollectionTreeNode>,
  filePath: string,
): Promise<void> {
  const aggregate = discovery.snapshot;
  if (aggregate === undefined) {
    return;
  }
  const node = findTreeNodeByRequestFilePath(aggregate, filePath);
  if (node === undefined) {
    return;
  }
  // Keep editor focus when callers open the `.api` file after create/rename/move.
  await treeView.reveal(node, { select: true, focus: false, expand: true });
}

function userFacingMutationFailure(error: unknown): string {
  if (error instanceof CollectionMutationError) {
    return error.message;
  }
  return (
    describeFilesystemFailure(error) ??
    'Something went wrong while updating collections. Check the output log for details.'
  );
}
