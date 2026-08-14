/**
 * Framework-free Collection Run Setup view model, validation, and target mapping.
 * No `vscode` import.
 */

import type {
  Collection,
  Folder,
  RequestReference,
  WorkspaceCollections,
} from '../collections';
import type { VariableDefinition } from '../models';
import { methodBadgeClass } from '../ui/webview';
import {
  AUTHENTICATION_UI_PER_REQUEST_OVERRIDE_HINT,
  buildAuthenticationUiState,
  type AuthenticationUiProfileSummary,
  type AuthenticationUiState,
} from '../auth';
import {
  DefaultVariableResolver,
  formatVariableScopeLabel,
  maskVariableValue,
} from '../variables';
import { CollectionRunMode, FailurePolicyKind, type FailurePolicyKind as FailurePolicyKindType } from './models';
import type { RunPlanTarget } from './plan-builder';
import type { CollectionRunAuthenticationPreference } from './run-variable-context';

export type { CollectionRunAuthenticationPreference };

/** V1 mutually exclusive run options shown in Setup. */
export type CollectionRunFailurePolicyChoice =
  | typeof FailurePolicyKind.ContinueOnError
  | typeof FailurePolicyKind.StopOnFirstError;

/** Sentinel id for the "No Environment" dropdown option. */
export const NO_ENVIRONMENT_OPTION_ID = '';

export interface CollectionRunSetupEnvironmentOption {
  readonly id: string;
  readonly label: string;
}

export interface CollectionRunSetupVariableRow {
  readonly name: string;
  readonly displayValue: string;
  readonly scopeLabel: string;
  readonly sensitive: boolean;
}

export interface CollectionRunSetupRequestNode {
  readonly kind: 'request';
  readonly id: string;
  readonly label: string;
  readonly method: string;
  readonly methodBadgeClass: string;
  readonly selected: boolean;
}

export interface CollectionRunSetupFolderNode {
  readonly kind: 'folder';
  readonly id: string;
  readonly label: string;
  readonly selected: boolean;
  readonly children: readonly CollectionRunSetupTreeNode[];
}

export type CollectionRunSetupTreeNode =
  | CollectionRunSetupFolderNode
  | CollectionRunSetupRequestNode;

export interface CollectionRunSetupAuthInfo {
  readonly collectionDefaultId?: string;
  readonly collectionDefaultLabel?: string;
  readonly workspaceDefaultId?: string;
  readonly workspaceDefaultLabel?: string;
  /** Secret-free profile summaries for the centralized Auth section. */
  readonly profiles?: readonly AuthenticationUiProfileSummary[];
}

export interface CollectionRunSetupModel {
  readonly collectionId: string;
  readonly collectionName: string;
  readonly description?: string;
  readonly requestCount: number;
  readonly requestCountLabel: string;
  readonly workspaceLabel?: string;
  readonly environments: readonly CollectionRunSetupEnvironmentOption[];
  /** Empty string means No Environment. */
  readonly selectedEnvironmentId: string;
  readonly hasEnvironment: boolean;
  readonly variables: readonly CollectionRunSetupVariableRow[];
  readonly authentication: {
    readonly collectionDefaultId?: string;
    readonly collectionDefaultLabel?: string;
    readonly workspaceDefaultId?: string;
    readonly workspaceDefaultLabel?: string;
    readonly preference: CollectionRunAuthenticationPreference;
    readonly collectionDefaultDisplay: string;
    readonly resolvedDisplay: string;
    readonly ui: AuthenticationUiState;
    readonly perRequestOverrideHint: string;
  };
  readonly failurePolicy: CollectionRunFailurePolicyChoice;
  readonly tree: readonly CollectionRunSetupTreeNode[];
  readonly selectedRequestIds: readonly string[];
  readonly selectedRequestCount: number;
  readonly allRequestsSelected: boolean;
  /** False when the collection is missing — Run must be disabled. */
  readonly canRun: boolean;
  readonly error?: string;
}

export interface CollectionRunSetupModelInput {
  readonly aggregate: WorkspaceCollections;
  readonly target: RunPlanTarget;
  readonly environments: readonly { readonly id: string; readonly name: string }[];
  readonly activeEnvironmentId?: string;
  /** `undefined` = No Environment. */
  readonly selectedEnvironmentId?: string;
  readonly collectionVariables: readonly VariableDefinition[];
  readonly globalVariables: readonly VariableDefinition[];
  readonly workspaceVariables: readonly VariableDefinition[];
  readonly environmentVariables: readonly VariableDefinition[];
  readonly authentication: CollectionRunSetupAuthInfo;
  readonly authenticationPreference: CollectionRunAuthenticationPreference;
  readonly failurePolicy: CollectionRunFailurePolicyChoice;
  readonly selectedRequestIds: ReadonlySet<string> | readonly string[];
  readonly error?: string;
}

/** Last submitted setup (no variable values). */
export interface CollectionRunSetupLastSubmitted {
  readonly collectionId: string;
  readonly originalTarget: RunPlanTarget;
  readonly selectedEnvironmentId?: string;
  readonly authenticationPreference: CollectionRunAuthenticationPreference;
  readonly failurePolicy: CollectionRunFailurePolicyChoice;
  readonly selectedRequestIds: readonly string[];
}

export interface ValidateCollectionRunSetupInput {
  readonly aggregate: WorkspaceCollections;
  readonly originalTarget: RunPlanTarget;
  readonly environments: readonly { readonly id: string; readonly name: string }[];
  readonly selectedEnvironmentId?: string;
  readonly selectedRequestIds: ReadonlySet<string> | readonly string[];
  readonly failurePolicy: CollectionRunFailurePolicyChoice;
}

export type CollectionRunSetupValidationResult =
  | {
      readonly ok: true;
      readonly target: RunPlanTarget;
      readonly failurePolicy: FailurePolicyKindType;
    }
  | { readonly ok: false; readonly message: string };

export interface CollectionRunExecuteConfig {
  readonly target: RunPlanTarget;
  readonly failurePolicy: FailurePolicyKindType;
  readonly environmentOverride: { readonly environmentId?: string };
  readonly authenticationPreference: CollectionRunAuthenticationPreference;
}

export type CollectionRunExecuteConfigResult =
  | { readonly ok: true; readonly config: CollectionRunExecuteConfig }
  | { readonly ok: false; readonly message: string };

const variableResolver = new DefaultVariableResolver();

/** Builds the serializable Setup view model posted to the webview. */
export function buildCollectionRunSetupModel(
  input: CollectionRunSetupModelInput,
): CollectionRunSetupModel {
  const collection = input.aggregate.collections[input.target.collectionId];
  if (collection === undefined) {
    return freezeModel({
      collectionId: input.target.collectionId,
      collectionName: 'Unknown collection',
      requestCount: 0,
      requestCountLabel: '0 requests',
      environments: environmentOptions(input.environments),
      selectedEnvironmentId: NO_ENVIRONMENT_OPTION_ID,
      hasEnvironment: false,
      variables: [],
      authentication: authenticationView(
        input.authentication,
        input.authenticationPreference,
      ),
      failurePolicy: input.failurePolicy,
      tree: [],
      selectedRequestIds: [],
      selectedRequestCount: 0,
      allRequestsSelected: false,
      canRun: false,
      error: input.error ?? 'The selected collection is no longer available.',
    });
  }

  const targetRequestIds = listCollectionRunSetupRequestIds(
    input.aggregate,
    input.target,
  );
  const selectedSet = toSelectedSet(input.selectedRequestIds);
  const selectedInOrder = targetRequestIds.filter((id) => selectedSet.has(id));
  const tree = buildRequestTree(collection, input.target, selectedSet);
  const selectedEnvironmentId =
    input.selectedEnvironmentId !== undefined &&
    input.selectedEnvironmentId.length > 0
      ? input.selectedEnvironmentId
      : NO_ENVIRONMENT_OPTION_ID;
  const hasEnvironment = selectedEnvironmentId !== NO_ENVIRONMENT_OPTION_ID;
  const description = collection.metadata.description?.trim();
  const workspaceLabel = resolveWorkspaceLabel(input.aggregate, collection);

  return freezeModel({
    collectionId: collection.id,
    collectionName:
      collection.metadata.name.trim().length > 0
        ? collection.metadata.name
        : collection.display.label,
    ...(description !== undefined && description.length > 0
      ? { description }
      : {}),
    requestCount: targetRequestIds.length,
    requestCountLabel: formatRequestCount(targetRequestIds.length),
    ...(workspaceLabel === undefined ? {} : { workspaceLabel }),
    environments: environmentOptions(input.environments),
    selectedEnvironmentId,
    hasEnvironment,
    variables: buildVariableRows(input),
    authentication: authenticationView(
      input.authentication,
      input.authenticationPreference,
    ),
    failurePolicy: input.failurePolicy,
    tree,
    selectedRequestIds: selectedInOrder,
    selectedRequestCount: selectedInOrder.length,
    allRequestsSelected:
      targetRequestIds.length > 0 &&
      selectedInOrder.length === targetRequestIds.length,
    canRun: true,
    ...(input.error === undefined || input.error.trim().length === 0
      ? {}
      : { error: input.error }),
  });
}

/** Target request ids in the same DFS order as `buildRunPlan` / `getTreeChildren`. */
export function listCollectionRunSetupRequestIds(
  aggregate: WorkspaceCollections,
  target: RunPlanTarget,
): readonly string[] {
  const collection = aggregate.collections[target.collectionId];
  if (collection === undefined) {
    return [];
  }
  switch (target.mode) {
    case CollectionRunMode.Collection:
      return collectCollectionRequests(collection).map((request) => request.id);
    case CollectionRunMode.Folder: {
      const folder = collection.folders[target.folderId];
      if (folder === undefined) {
        return [];
      }
      return collectFolderRequests(collection, folder).map(
        (request) => request.id,
      );
    }
    case CollectionRunMode.SelectedRequests:
      return selectRequests(collection, target.requestIds).map(
        (request) => request.id,
      );
    default:
      return [];
  }
}

export function collectTreeRequestIds(
  nodes: readonly CollectionRunSetupTreeNode[],
): readonly string[] {
  const ids: string[] = [];
  const walk = (node: CollectionRunSetupTreeNode): void => {
    if (node.kind === 'request') {
      ids.push(node.id);
      return;
    }
    for (const child of node.children) {
      walk(child);
    }
  };
  for (const node of nodes) {
    walk(node);
  }
  return ids;
}

export function collectFolderTreeRequestIds(
  nodes: readonly CollectionRunSetupTreeNode[],
  folderId: string,
): readonly string[] | undefined {
  for (const node of nodes) {
    if (node.kind === 'folder') {
      if (node.id === folderId) {
        return collectTreeRequestIds([node]);
      }
      const nested = collectFolderTreeRequestIds(node.children, folderId);
      if (nested !== undefined) {
        return nested;
      }
    }
  }
  return undefined;
}

export function mapSelectionToRunPlanTarget(
  aggregate: WorkspaceCollections,
  originalTarget: RunPlanTarget,
  selectedRequestIds: ReadonlySet<string> | readonly string[],
): RunPlanTarget {
  const collection = aggregate.collections[originalTarget.collectionId];
  if (collection === undefined) {
    return originalTarget;
  }
  const ordered = listCollectionRunSetupRequestIds(aggregate, originalTarget);
  const selectedSet = toSelectedSet(selectedRequestIds);
  const selectedInOrder = ordered.filter((id) => selectedSet.has(id));
  if (
    originalTarget.mode === CollectionRunMode.Collection &&
    ordered.length > 0 &&
    selectedInOrder.length === ordered.length
  ) {
    return {
      mode: CollectionRunMode.Collection,
      collectionId: originalTarget.collectionId,
    };
  }
  if (
    originalTarget.mode === CollectionRunMode.Folder &&
    ordered.length > 0 &&
    selectedInOrder.length === ordered.length
  ) {
    return {
      mode: CollectionRunMode.Folder,
      collectionId: originalTarget.collectionId,
      folderId: originalTarget.folderId,
    };
  }
  return {
    mode: CollectionRunMode.SelectedRequests,
    collectionId: originalTarget.collectionId,
    requestIds: selectedInOrder,
  };
}

export function validateCollectionRunSetup(
  input: ValidateCollectionRunSetupInput,
): CollectionRunSetupValidationResult {
  const collection = input.aggregate.collections[input.originalTarget.collectionId];
  if (collection === undefined) {
    return {
      ok: false,
      message: 'The selected collection is no longer available.',
    };
  }

  if (
    input.failurePolicy !== FailurePolicyKind.ContinueOnError &&
    input.failurePolicy !== FailurePolicyKind.StopOnFirstError
  ) {
    return { ok: false, message: 'Choose a run option.' };
  }

  const selectedEnvironmentId = input.selectedEnvironmentId;
  if (
    selectedEnvironmentId !== undefined &&
    selectedEnvironmentId.length > 0 &&
    !input.environments.some((environment) => environment.id === selectedEnvironmentId)
  ) {
    return {
      ok: false,
      message: 'The selected environment is no longer available.',
    };
  }

  const selectedIds = [...toSelectedSet(input.selectedRequestIds)];
  if (selectedIds.length === 0) {
    return { ok: false, message: 'Select at least one request to run.' };
  }

  const allowedIds = new Set(
    listCollectionRunSetupRequestIds(input.aggregate, input.originalTarget),
  );
  for (const requestId of selectedIds) {
    if (
      collection.requests[requestId] === undefined ||
      !allowedIds.has(requestId)
    ) {
      return {
        ok: false,
        message: 'One or more selected requests are no longer in this collection.',
      };
    }
  }

  const target = mapSelectionToRunPlanTarget(
    input.aggregate,
    input.originalTarget,
    input.selectedRequestIds,
  );
  return {
    ok: true,
    target,
    failurePolicy: input.failurePolicy,
  };
}

/** Maps a validated Setup draft onto the execute config (including env/auth). */
export function toExecuteConfig(input: {
  readonly aggregate: WorkspaceCollections;
  readonly originalTarget: RunPlanTarget;
  readonly environments: readonly { readonly id: string; readonly name: string }[];
  readonly selectedEnvironmentId?: string;
  readonly selectedRequestIds: ReadonlySet<string> | readonly string[];
  readonly failurePolicy: CollectionRunFailurePolicyChoice;
  readonly authenticationPreference: CollectionRunAuthenticationPreference;
}): CollectionRunExecuteConfigResult {
  const validated = validateCollectionRunSetup(input);
  if (!validated.ok) {
    return validated;
  }
  const environmentId =
    input.selectedEnvironmentId !== undefined &&
    input.selectedEnvironmentId.length > 0
      ? input.selectedEnvironmentId
      : undefined;
  return {
    ok: true,
    config: {
      target: validated.target,
      failurePolicy: validated.failurePolicy,
      environmentOverride:
        environmentId === undefined ? {} : { environmentId },
      authenticationPreference: input.authenticationPreference,
    },
  };
}

function environmentOptions(
  environments: readonly { readonly id: string; readonly name: string }[],
): readonly CollectionRunSetupEnvironmentOption[] {
  return [
    { id: NO_ENVIRONMENT_OPTION_ID, label: 'No Environment' },
    ...environments.map((environment) => ({
      id: environment.id,
      label: environment.name,
    })),
  ];
}

function buildVariableRows(
  input: CollectionRunSetupModelInput,
): readonly CollectionRunSetupVariableRow[] {
  const analysis = variableResolver.analyze({
    definitions: [
      ...input.globalVariables,
      ...input.workspaceVariables,
      ...input.collectionVariables,
      ...input.environmentVariables,
    ],
  });
  const names = [...analysis.values.keys()].sort((left, right) =>
    left.localeCompare(right),
  );
  return names.flatMap((name) => {
    const value = analysis.values.get(name);
    if (value === undefined) {
      return [];
    }
    return [
      {
        name: value.name,
        displayValue: maskVariableValue(value),
        scopeLabel: formatVariableScopeLabel(value.scope),
        sensitive: value.sensitive,
      },
    ];
  });
}

function authenticationView(
  authentication: CollectionRunSetupAuthInfo,
  preference: CollectionRunAuthenticationPreference,
): CollectionRunSetupModel['authentication'] {
  const collectionDefaultId = normalizeOptionalId(
    authentication.collectionDefaultId,
  );
  const collectionDefaultLabel = authentication.collectionDefaultLabel?.trim();
  const workspaceDefaultId = normalizeOptionalId(
    authentication.workspaceDefaultId,
  );
  const workspaceDefaultLabel = authentication.workspaceDefaultLabel?.trim();
  const collectionDefaultDisplay =
    collectionDefaultLabel !== undefined && collectionDefaultLabel.length > 0
      ? collectionDefaultLabel
      : collectionDefaultId ?? 'None';
  const resolvedDisplay =
    workspaceDefaultLabel !== undefined && workspaceDefaultLabel.length > 0
      ? workspaceDefaultLabel
      : 'Resolved authentication';
  const ui = buildAuthenticationUiState({
    surface: 'run-setup',
    profiles: authentication.profiles ?? [],
    ...(collectionDefaultId === undefined
      ? {}
      : { collectionDefaultId }),
    ...(workspaceDefaultId === undefined ? {} : { workspaceDefaultId }),
    authenticationPreference: preference,
  });
  return {
    ...(collectionDefaultId === undefined ? {} : { collectionDefaultId }),
    ...(collectionDefaultLabel !== undefined && collectionDefaultLabel.length > 0
      ? { collectionDefaultLabel }
      : {}),
    ...(workspaceDefaultId === undefined ? {} : { workspaceDefaultId }),
    ...(workspaceDefaultLabel !== undefined && workspaceDefaultLabel.length > 0
      ? { workspaceDefaultLabel }
      : {}),
    preference,
    collectionDefaultDisplay,
    resolvedDisplay,
    ui,
    perRequestOverrideHint: AUTHENTICATION_UI_PER_REQUEST_OVERRIDE_HINT,
  };
}

function buildRequestTree(
  collection: Collection,
  target: RunPlanTarget,
  selected: ReadonlySet<string>,
): readonly CollectionRunSetupTreeNode[] {
  if (target.mode === CollectionRunMode.Folder) {
    const folder = collection.folders[target.folderId];
    if (folder === undefined) {
      return [];
    }
    const node = projectFolderNode(collection, folder, selected, undefined);
    return node === undefined ? [] : [node];
  }
  const allowed =
    target.mode === CollectionRunMode.SelectedRequests
      ? new Set(target.requestIds)
      : undefined;
  return projectRootNodes(collection, selected, allowed);
}

function projectRootNodes(
  collection: Collection,
  selected: ReadonlySet<string>,
  allowed: ReadonlySet<string> | undefined,
): CollectionRunSetupTreeNode[] {
  const nodes: CollectionRunSetupTreeNode[] = [];
  for (const folderId of collection.rootFolderIds) {
    const folder = collection.folders[folderId];
    if (folder === undefined) {
      continue;
    }
    const node = projectFolderNode(collection, folder, selected, allowed);
    if (node !== undefined) {
      nodes.push(node);
    }
  }
  for (const requestId of collection.rootRequestIds) {
    const request = collection.requests[requestId];
    if (request === undefined) {
      continue;
    }
    if (allowed !== undefined && !allowed.has(request.id)) {
      continue;
    }
    nodes.push(projectRequestNode(request, selected));
  }
  return nodes;
}

function projectFolderNode(
  collection: Collection,
  folder: Folder,
  selected: ReadonlySet<string>,
  allowed: ReadonlySet<string> | undefined,
): CollectionRunSetupFolderNode | undefined {
  const children: CollectionRunSetupTreeNode[] = [];
  for (const childId of folder.folderIds) {
    const child = collection.folders[childId];
    if (child === undefined) {
      continue;
    }
    const nested = projectFolderNode(collection, child, selected, allowed);
    if (nested !== undefined) {
      children.push(nested);
    }
  }
  for (const requestId of folder.requestIds) {
    const request = collection.requests[requestId];
    if (request === undefined) {
      continue;
    }
    if (allowed !== undefined && !allowed.has(request.id)) {
      continue;
    }
    children.push(projectRequestNode(request, selected));
  }
  if (allowed !== undefined && children.length === 0) {
    return undefined;
  }
  const descendantIds = collectTreeRequestIds(children);
  const selectedCount = descendantIds.filter((id) => selected.has(id)).length;
  return {
    kind: 'folder',
    id: folder.id,
    label: folder.display.label,
    selected: descendantIds.length > 0 && selectedCount === descendantIds.length,
    children,
  };
}

function projectRequestNode(
  request: RequestReference,
  selected: ReadonlySet<string>,
): CollectionRunSetupRequestNode {
  const method = request.method.trim().toUpperCase();
  const name = request.display.label.trim();
  return {
    kind: 'request',
    id: request.id,
    label: name.length > 0 ? name : 'Request',
    method,
    methodBadgeClass: methodBadgeClass(method),
    selected: selected.has(request.id),
  };
}

function collectCollectionRequests(collection: Collection): RequestReference[] {
  const out: RequestReference[] = [];
  for (const folderId of collection.rootFolderIds) {
    const folder = collection.folders[folderId];
    if (folder !== undefined) {
      out.push(...collectFolderRequests(collection, folder));
    }
  }
  for (const requestId of collection.rootRequestIds) {
    const request = collection.requests[requestId];
    if (request !== undefined) {
      out.push(request);
    }
  }
  return out;
}

function collectFolderRequests(
  collection: Collection,
  folder: Folder,
): RequestReference[] {
  const out: RequestReference[] = [];
  for (const childId of folder.folderIds) {
    const child = collection.folders[childId];
    if (child !== undefined) {
      out.push(...collectFolderRequests(collection, child));
    }
  }
  for (const requestId of folder.requestIds) {
    const request = collection.requests[requestId];
    if (request !== undefined) {
      out.push(request);
    }
  }
  return out;
}

function selectRequests(
  collection: Collection,
  requestIds: readonly string[],
): RequestReference[] {
  const out: RequestReference[] = [];
  for (const id of requestIds) {
    const request = collection.requests[id];
    if (request !== undefined) {
      out.push(request);
    }
  }
  return out;
}

function resolveWorkspaceLabel(
  aggregate: WorkspaceCollections,
  collection: Collection,
): string | undefined {
  if (aggregate.workspaceRoots.length <= 1) {
    return undefined;
  }
  const root = aggregate.workspaceRoots.find((item) =>
    item.collectionIds.includes(collection.id),
  );
  const label = root?.display.label.trim();
  if (label !== undefined && label.length > 0) {
    return label;
  }
  const path = collection.metadata.workspacePath.trim();
  return path.length > 0 ? path : undefined;
}

function formatRequestCount(count: number): string {
  return count === 1 ? '1 request' : `${count} requests`;
}

function toSelectedSet(
  selected: ReadonlySet<string> | readonly string[],
): ReadonlySet<string> {
  return selected instanceof Set ? selected : new Set(selected);
}

function normalizeOptionalId(id: string | undefined): string | undefined {
  if (id === undefined) {
    return undefined;
  }
  const trimmed = id.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function freezeModel(model: CollectionRunSetupModel): CollectionRunSetupModel {
  return Object.freeze(model);
}
