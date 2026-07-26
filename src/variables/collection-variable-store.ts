/**
 * Filesystem-backed store for collection-scope variables.
 *
 * Non-sensitive values live in `Collections/<Name>/api-hero.variables.json`;
 * sensitive values live in the `variables.local.json` overlay under
 * `collections[collectionId][name]`. Domain-only — no `vscode` imports.
 */

import { COLLECTION_VARIABLES_FILENAME } from '../collections/constants';
import { collectionIdForRoot, joinPathKey } from '../collections/models';
import type { VariableDefinition } from '../models';
import {
  emptyCollectionVariablesDocument,
  parseCollectionVariablesDocument,
  serializeCollectionVariablesDocument,
  type CollectionVariablesDocument,
} from './collection-variables-document';

export interface CollectionVariableStore {
  /**
   * Absolute collection root path (folder containing marker).
   *
   * `collectionId`, when provided, is used as the overlay lookup key instead
   * of `collectionIdForRoot(collectionRootPath)`. Callers running against a
   * legacy (workspace-root) collection must pass the plan's
   * `collection:legacy:…` id so sensitive values written during that run can
   * be read back — the overlay is keyed by whatever id `upsert` was called
   * with, not by the root path.
   */
  load(
    collectionRootPath: string,
    collectionId?: string,
  ): Promise<readonly VariableDefinition[]>;

  /**
   * Upsert one variable (non-sensitive value in api-hero.variables.json;
   * sensitive value in variables.local.json collections[collectionId]).
   */
  upsert(
    collectionRootPath: string,
    collectionId: string,
    variable: {
      readonly name: string;
      readonly value: string;
      readonly sensitive: boolean;
    },
  ): Promise<void>;

  /** Re-read from disk (after external edit). See `load` re: `collectionId`. */
  refresh(
    collectionRootPath: string,
    collectionId?: string,
  ): Promise<readonly VariableDefinition[]>;
}

export interface CollectionVariableStorePorts {
  readonly readText: (path: string) => Promise<string>;
  readonly writeText: (path: string, text: string) => Promise<void>;
  readonly exists: (path: string) => Promise<boolean>;
  readonly createDirectory: (path: string) => Promise<void>;
  /** Sensitive overlay read/write for collections map. */
  readonly readLocalOverlay: () => Promise<{
    readonly collections: Readonly<Record<string, Readonly<Record<string, string>>>>;
  }>;
  /**
   * Resolves `true` once the overlay was actually written, `false` when the
   * write was a no-op (e.g. no workspace folder to write it to). `upsert`
   * uses this to fail sensitive writes instead of silently redacting the
   * tracked file while losing the cleartext value.
   */
  readonly writeLocalOverlay: (
    collections: Readonly<Record<string, Readonly<Record<string, string>>>>,
  ) => Promise<boolean>;
}

/** Builds the on-disk path for a collection's `api-hero.variables.json`. */
export function collectionVariablesDocumentPath(
  collectionRootPath: string,
): string {
  return joinPathKey(collectionRootPath, COLLECTION_VARIABLES_FILENAME);
}

export class FilesystemCollectionVariableStore
  implements CollectionVariableStore
{
  public constructor(private readonly ports: CollectionVariableStorePorts) {}

  public async load(
    collectionRootPath: string,
    collectionId?: string,
  ): Promise<readonly VariableDefinition[]> {
    const document = await this.readDocument(collectionRootPath);
    const overlay = await this.readOverlaySafe();
    const resolvedId = collectionId ?? collectionIdForRoot(collectionRootPath);
    return toVariableDefinitions(document, overlay[resolvedId] ?? {});
  }

  public async refresh(
    collectionRootPath: string,
    collectionId?: string,
  ): Promise<readonly VariableDefinition[]> {
    return this.load(collectionRootPath, collectionId);
  }

  public async upsert(
    collectionRootPath: string,
    collectionId: string,
    variable: {
      readonly name: string;
      readonly value: string;
      readonly sensitive: boolean;
    },
  ): Promise<void> {
    // Overlay first: if this throws, the tracked file is left untouched so a
    // sensitive value is never redacted on disk without its cleartext safely
    // persisted in the overlay.
    const overlay = (await this.ports.readLocalOverlay()).collections;
    const nextOverlay = upsertOverlayEntry(
      overlay,
      collectionId,
      variable.name,
      variable.sensitive ? variable.value : undefined,
    );
    const overlayWritten = await this.ports.writeLocalOverlay(nextOverlay);
    if (variable.sensitive && !overlayWritten) {
      throw new Error(
        'Cannot persist sensitive collection variable: no workspace folder is available to write the local overlay.',
      );
    }

    const document = await this.readDocument(collectionRootPath);
    const nextVariables = upsertTrackedVariable(document.variables, variable);
    await this.writeDocument(collectionRootPath, {
      schemaVersion: document.schemaVersion,
      variables: nextVariables,
    });
  }

  private async readDocument(
    collectionRootPath: string,
  ): Promise<CollectionVariablesDocument> {
    const path = collectionVariablesDocumentPath(collectionRootPath);
    if (!(await this.ports.exists(path))) {
      return emptyCollectionVariablesDocument();
    }
    try {
      const text = await this.ports.readText(path);
      return (
        parseCollectionVariablesDocument(text) ??
        emptyCollectionVariablesDocument()
      );
    } catch {
      return emptyCollectionVariablesDocument();
    }
  }

  private async writeDocument(
    collectionRootPath: string,
    document: CollectionVariablesDocument,
  ): Promise<void> {
    await this.ports.createDirectory(collectionRootPath);
    await this.ports.writeText(
      collectionVariablesDocumentPath(collectionRootPath),
      serializeCollectionVariablesDocument(document),
    );
  }

  private async readOverlaySafe(): Promise<
    Readonly<Record<string, Readonly<Record<string, string>>>>
  > {
    try {
      return (await this.ports.readLocalOverlay()).collections;
    } catch {
      return {};
    }
  }
}

function toVariableDefinitions(
  document: CollectionVariablesDocument,
  overlayValues: Readonly<Record<string, string>>,
): readonly VariableDefinition[] {
  return document.variables.map((variable): VariableDefinition => {
    if (variable.sensitive !== true) {
      return {
        name: variable.name,
        value: variable.value,
        scope: 'collection',
        sensitive: false,
      };
    }
    return {
      name: variable.name,
      value: overlayValues[variable.name] ?? variable.value,
      scope: 'collection',
      sensitive: true,
    };
  });
}

function upsertTrackedVariable(
  variables: readonly {
    readonly name: string;
    readonly value: string;
    readonly sensitive?: boolean;
  }[],
  variable: { readonly name: string; readonly value: string; readonly sensitive: boolean },
): readonly {
  readonly name: string;
  readonly value: string;
  readonly sensitive?: boolean;
}[] {
  const tracked = variable.sensitive
    ? { name: variable.name, value: '', sensitive: true as const }
    : { name: variable.name, value: variable.value };
  const index = variables.findIndex((entry) => entry.name === variable.name);
  if (index < 0) {
    return [...variables, tracked];
  }
  const next = [...variables];
  next[index] = tracked;
  return next;
}

function upsertOverlayEntry(
  overlay: Readonly<Record<string, Readonly<Record<string, string>>>>,
  collectionId: string,
  name: string,
  sensitiveValue: string | undefined,
): Readonly<Record<string, Readonly<Record<string, string>>>> {
  const next: Record<string, Record<string, string>> = {};
  for (const [id, values] of Object.entries(overlay)) {
    next[id] = { ...values };
  }
  const bucket = { ...(next[collectionId] ?? {}) };
  if (sensitiveValue === undefined) {
    delete bucket[name];
  } else {
    bucket[name] = sensitiveValue;
  }
  if (Object.keys(bucket).length === 0) {
    delete next[collectionId];
  } else {
    next[collectionId] = bucket;
  }
  return next;
}
