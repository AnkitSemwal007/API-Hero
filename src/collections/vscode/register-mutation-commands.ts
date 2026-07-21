/**
 * Registers collection mutation commands (CRUD dialogs) for the Collections tree.
 */

import {
  Uri,
  commands,
  window,
  workspace,
  type Disposable,
  type TreeView,
} from 'vscode';

import { COMMAND_IDS, REQUEST_EDITOR_VIEW_TYPE } from '../../constants';
import type { Logger } from '../../shared';
import type { CollectionDiscoveryService } from '../discovery';
import type { Collection } from '../models';
import {
  CollectionMutationError,
  CollectionMutationService,
  pathBasename,
  stripApiExtension,
  type CreateCollectionResult,
} from '../mutation';
import type { CollectionNameCollisionChoice } from '../transfer';
import type { CollectionTreeNode } from '../tree-projection';
import {
  buildNewRequestDestinations,
  openNewRequestDialog,
} from './new-request-dialog';

export interface RegisterMutationCommandsOptions {
  readonly discovery: CollectionDiscoveryService;
  readonly mutation: CollectionMutationService;
  readonly treeView: TreeView<CollectionTreeNode>;
  readonly logger: Logger;
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
      const message =
        error instanceof Error ? error.message : String(error);
      logger.warning(`Collections ${label} failed`, { message });
      void window.showErrorMessage(`API Hero: ${message}`);
    }
  };

  return [
    commands.registerCommand(COMMAND_IDS.createCollection, async () => {
      await run('createCollection', async () => {
        const workspaceRoot = await pickWorkspaceRootPath();
        if (workspaceRoot === undefined) {
          return;
        }
        const name = await promptName('Collection name', 'My APIs');
        if (name === undefined) {
          return;
        }
        await mutation.createCollection(workspaceRoot, name);
        void window.showInformationMessage(
          `API Hero: Created collection "${name}".`,
        );
      });
    }),
    commands.registerCommand(
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
          const next = await promptName(
            'Rename collection',
            collection.display.label,
            collection.display.label,
          );
          if (next === undefined) {
            return;
          }
          await mutation.renameCollection(collection.id, next);
        });
      },
    ),
    commands.registerCommand(
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
        });
      },
    ),
    commands.registerCommand(
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
          await mutation.duplicateCollection(collection.id);
        });
      },
    ),
    commands.registerCommand(
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
          void window.showInformationMessage(
            `API Hero: Exported "${preferredName}" to ${result.exportPath}.`,
          );
        });
      },
    ),
    commands.registerCommand(COMMAND_IDS.importCollection, async () => {
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
        void window.showInformationMessage(
          `API Hero: Imported collection into ${result.rootPath}.`,
        );
      });
    }),
    commands.registerCommand(
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
          const name = await promptName('Folder name', 'New Folder');
          if (name === undefined) {
            return;
          }
          await mutation.createFolder(
            destination.collectionId,
            destination.folderRelativePath,
            name,
          );
        });
      },
    ),
    commands.registerCommand(
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
          const next = await promptName(
            'Rename folder',
            folder.label,
            folder.label,
          );
          if (next === undefined) {
            return;
          }
          await mutation.renameFolder(
            folder.collectionId,
            folder.relativePath,
            next,
          );
        });
      },
    ),
    commands.registerCommand(
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
        });
      },
    ),
    commands.registerCommand(
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
          await mutation.duplicateFolder(
            folder.collectionId,
            folder.relativePath,
          );
        });
      },
    ),
    commands.registerCommand(
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
              'Create a collection under Collections/ before adding a request.',
            );
            return;
          }

          try {
            await openNewRequestDialog({
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
              },
            });
          } catch (error) {
            logger.warning('New Request dialog failed; using InputBox fallback', {
              message: error instanceof Error ? error.message : String(error),
            });
            await createRequestViaInputBox(
              mutation,
              destination ?? {
                collectionId: destinations[0]!.collectionId,
                folderRelativePath: destinations[0]!.folderRelativePath,
              },
            );
          }
        });
      },
    ),
    commands.registerCommand(
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
          const next = await promptName('Rename request', current, current);
          if (next === undefined) {
            return;
          }
          const result = await mutation.renameRequest(
            request.collectionId,
            request.filePath,
            next,
          );
          await openApiFile(result.filePath);
        });
      },
    ),
    commands.registerCommand(
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
        });
      },
    ),
    commands.registerCommand(
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
        });
      },
    ),
    commands.registerCommand(
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
          const destination = await pickNativeFolderDestination(discovery);
          if (destination === undefined) {
            return;
          }
          const result = await mutation.moveRequest(
            request.collectionId,
            request.filePath,
            destination.collectionId,
            destination.folderRelativePath,
          );
          await openApiFile(result.filePath);
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
  return treeView.selection.find((node) => node.kind === kind);
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

async function pickNativeFolderDestination(
  discovery: CollectionDiscoveryService,
): Promise<{ collectionId: string; folderRelativePath: string } | undefined> {
  const aggregate = discovery.snapshot;
  if (aggregate === undefined) {
    return undefined;
  }
  type PickItem = {
    label: string;
    description?: string;
    collectionId: string;
    folderRelativePath: string;
  };
  const items: PickItem[] = [];
  for (const collection of Object.values(aggregate.collections)) {
    if (collection.kind !== 'native') {
      continue;
    }
    items.push({
      label: collection.display.label,
      description: '(collection root)',
      collectionId: collection.id,
      folderRelativePath: '',
    });
    for (const folder of Object.values(collection.folders)) {
      items.push({
        label: `${collection.display.label} / ${folder.relativePath}`,
        collectionId: collection.id,
        folderRelativePath: folder.relativePath,
      });
    }
  }
  if (items.length === 0) {
    void window.showWarningMessage(
      'Create a collection under Collections/ before moving a request.',
    );
    return undefined;
  }
  const selected = await window.showQuickPick(items, {
    placeHolder: 'Move request to…',
  });
  return selected;
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

async function promptName(
  prompt: string,
  placeHolder: string,
  value?: string,
): Promise<string | undefined> {
  const result = await window.showInputBox({
    prompt,
    placeHolder,
    value,
    ignoreFocusOut: true,
    validateInput: (text) =>
      text.trim().length === 0 ? 'Name is required' : undefined,
  });
  return result?.trim();
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

async function createRequestViaInputBox(
  mutation: CollectionMutationService,
  destination: { collectionId: string; folderRelativePath: string },
): Promise<void> {
  const name = await promptName('Request name', 'New Request');
  if (name === undefined) {
    return;
  }
  const result = await mutation.createRequest(
    destination.collectionId,
    destination.folderRelativePath,
    name,
  );
  await openApiFile(result.filePath);
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
