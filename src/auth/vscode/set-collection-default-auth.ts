/**
 * Sets `defaultAuthenticationId` on a collection marker (shallow inheritance).
 * Profile selection uses the Collection Authentication webview.
 */

import { Uri, window, workspace } from 'vscode';

import {
  COLLECTION_MARKER_FILENAME,
  parseCollectionMarker,
  serializeCollectionMarker,
  type Collection,
  type CollectionDiscoveryService,
  type CollectionTreeNode,
} from '../../collections';
import type { AuthenticationProfileManager } from '../authentication-profile-manager';
import type { CollectionAuthPanel } from './collection-auth-panel';

function isVsCodeUri(value: unknown): value is Uri {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Uri).scheme === 'string' &&
    typeof (value as Uri).fsPath === 'string' &&
    typeof (value as Uri).toString === 'function'
  );
}

/** Interactive command: pick collection, then open Collection Authentication UI. */
export async function runSetCollectionDefaultAuthenticationCommand(options: {
  readonly discovery: CollectionDiscoveryService;
  readonly profileManager: AuthenticationProfileManager;
  readonly panel: CollectionAuthPanel;
  /** Tree item / URI / collection id when invoked from Collections context. */
  readonly collectionArg?: unknown;
}): Promise<void> {
  const snapshot = options.discovery.snapshot;
  if (snapshot === undefined) {
    void window.showWarningMessage('No collections discovered yet.');
    return;
  }
  const collections = Object.values(snapshot.collections).filter(
    (collection) => collection.kind === 'native',
  );
  if (collections.length === 0) {
    void window.showWarningMessage('No native collections available.');
    return;
  }

  const fromContext = resolveCollectionFromContext(
    collections,
    options.collectionArg,
  );
  let collection: Collection;
  if (fromContext !== undefined) {
    collection = fromContext;
  } else {
    const collectionPick = await window.showQuickPick(
      collections.map((entry) => ({
        label: entry.display.label,
        description: entry.metadata.defaultAuthenticationId
          ? `Default Authentication: ${entry.metadata.defaultAuthenticationId}`
          : 'Default Authentication: None',
        detail: entry.metadata.workspacePath,
        collection: entry,
      })),
      {
        title: 'Collection for default Authentication',
        placeHolder: 'Choose a collection',
        ignoreFocusOut: true,
        matchOnDescription: true,
      },
    );
    if (collectionPick === undefined) {
      return;
    }
    collection = collectionPick.collection;
  }

  try {
    options.panel.show(collection);
  } catch {
    await pickCollectionDefaultViaQuickPick({
      collection,
      discovery: options.discovery,
      profileManager: options.profileManager,
    });
  }
}

/**
 * Writes `defaultAuthenticationId` on the collection marker.
 * Omits the key when `profileId` is undefined (None).
 * Does not store secrets on the marker.
 */
export async function writeCollectionDefaultAuthenticationId(options: {
  readonly collection: Collection;
  readonly profileId: string | undefined;
  readonly discovery: CollectionDiscoveryService;
}): Promise<void> {
  const root = options.collection.rootPath;
  const markerUri = Uri.joinPath(Uri.parse(root), COLLECTION_MARKER_FILENAME);
  let existing = {};
  try {
    const bytes = await workspace.fs.readFile(markerUri);
    const parsed = parseCollectionMarker(Buffer.from(bytes).toString('utf8'));
    if (parsed !== undefined) {
      existing = parsed;
    }
  } catch {
    // Create a fresh marker when missing.
  }
  const next = {
    ...existing,
    name:
      (existing as { name?: string }).name ?? options.collection.metadata.name,
    ...(options.profileId === undefined
      ? { defaultAuthenticationId: undefined }
      : { defaultAuthenticationId: options.profileId }),
  };
  const document =
    options.profileId === undefined
      ? (() => {
          const { defaultAuthenticationId, ...rest } = next as {
            defaultAuthenticationId?: string;
          } & Record<string, unknown>;
          void defaultAuthenticationId;
          return rest;
        })()
      : next;
  await workspace.fs.writeFile(
    markerUri,
    Buffer.from(serializeCollectionMarker(document as never), 'utf8'),
  );
  await options.discovery.refresh();
  void window.showInformationMessage(
    options.profileId === undefined
      ? `Cleared default Authentication for "${options.collection.display.label}".`
      : `Set default Authentication "${options.profileId}" for "${options.collection.display.label}".`,
  );
}

async function pickCollectionDefaultViaQuickPick(options: {
  readonly collection: Collection;
  readonly discovery: CollectionDiscoveryService;
  readonly profileManager: AuthenticationProfileManager;
}): Promise<void> {
  const profiles = options.profileManager.list();
  const noneItem = {
    label: '$(circle-slash) None',
    description: 'Clear collection default Authentication',
    detail: 'Requests fall back to workspace/session default',
    id: undefined as string | undefined,
  };
  const profilePick = await window.showQuickPick(
    [
      noneItem,
      ...profiles.map((profile) => ({
        label: profile.label ?? profile.id,
        description: profile.id,
        detail:
          profile.providerId === 'none'
            ? 'No authentication'
            : `Method: ${profile.providerId}`,
        id: profile.id as string | undefined,
      })),
    ],
    {
      title: 'Default Authentication',
      placeHolder: 'None + Authentication list',
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (profilePick === undefined) {
    return;
  }
  await writeCollectionDefaultAuthenticationId({
    collection: options.collection,
    profileId: profilePick.id,
    discovery: options.discovery,
  });
}

/**
 * Resolves a native collection from Collections tree context (node / id / URI).
 * Returns undefined when the palette path should show the collection QuickPick.
 */
function resolveCollectionFromContext(
  collections: readonly Collection[],
  arg: unknown,
): Collection | undefined {
  if (arg === undefined || arg === null) {
    return undefined;
  }

  if (typeof arg === 'string') {
    const trimmed = arg.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const byId = collections.find((collection) => collection.id === trimmed);
    if (byId !== undefined) {
      return byId;
    }
    return collections.find((collection) =>
      collectionRootMatches(collection.rootPath, trimmed),
    );
  }

  if (typeof arg !== 'object') {
    return undefined;
  }

  if (isVsCodeUri(arg)) {
    return collections.find((collection) =>
      collectionRootMatches(collection.rootPath, arg),
    );
  }

  const node = arg as Partial<CollectionTreeNode> & {
    readonly collectionId?: string;
    readonly id?: string;
    readonly resourceUri?: Uri;
  };

  if (node.kind === 'collection') {
    const id = node.collectionId ?? node.id;
    if (typeof id === 'string') {
      return collections.find((collection) => collection.id === id);
    }
  }

  if (typeof node.collectionId === 'string') {
    const byCollectionId = collections.find(
      (collection) => collection.id === node.collectionId,
    );
    if (byCollectionId !== undefined) {
      return byCollectionId;
    }
  }

  if (typeof node.id === 'string' && node.id.startsWith('collection:')) {
    return collections.find((collection) => collection.id === node.id);
  }

  if (isVsCodeUri(node.resourceUri)) {
    return resolveCollectionFromContext(collections, node.resourceUri);
  }

  return undefined;
}

function collectionRootMatches(
  rootPath: string,
  candidate: string | Uri,
): boolean {
  const candidateUri = isVsCodeUri(candidate) ? candidate : undefined;
  const candidateText = candidateUri?.toString() ?? String(candidate);
  if (rootPath === candidateText) {
    return true;
  }
  try {
    const rootUri = Uri.parse(rootPath);
    if (rootUri.toString() === candidateText) {
      return true;
    }
    if (candidateUri !== undefined && rootUri.fsPath === candidateUri.fsPath) {
      return true;
    }
    if (typeof candidate === 'string' && rootUri.fsPath === candidate) {
      return true;
    }
  } catch {
    // Fall through.
  }
  return typeof candidate === 'string' && rootPath === candidate;
}
