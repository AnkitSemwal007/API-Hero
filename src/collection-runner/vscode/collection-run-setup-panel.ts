/**
 * Command-opened WebviewPanel host for Collection Run Setup.
 */

import {
  commands,
  ViewColumn,
  window,
  type Disposable,
  type WebviewPanel,
} from 'vscode';

import type { CollectionDiscoveryService } from '../../collections';
import { COMMAND_IDS } from '../../constants';
import type { VariableDefinition } from '../../models';
import type { AuthenticationUiProfileSummary } from '../../auth';
import { createWebviewNonce } from '../../ui/webview';
import type { CollectionVariableStore, EnvironmentManager } from '../../variables';
import {
  buildCollectionRunSetupModel,
  collectFolderTreeRequestIds,
  listCollectionRunSetupRequestIds,
  toExecuteConfig,
  type CollectionRunAuthenticationPreference,
  type CollectionRunExecuteConfig,
  type CollectionRunFailurePolicyChoice,
  type CollectionRunSetupLastSubmitted,
  type CollectionRunSetupModel,
} from '../index';
import type { RunPlanTarget } from '../plan-builder';
import {
  parseCollectionRunSetupMessage,
  renderCollectionRunSetupHtml,
} from './collection-run-setup-html';

const PANEL_VIEW_TYPE = 'apiHero.collectionRunSetup';

export interface CollectionRunSetupAuthSnapshot {
  readonly profiles: readonly AuthenticationUiProfileSummary[];
  readonly defaultProfileId?: string;
}

export interface CollectionRunSetupShowOptions {
  readonly target: RunPlanTarget;
  readonly restorePrevious?: boolean;
}

export interface CollectionRunSetupPanelOptions {
  readonly discovery: CollectionDiscoveryService;
  readonly environmentManager: EnvironmentManager;
  readonly collectionVariableStore: CollectionVariableStore;
  readonly getAuthenticationSnapshot?: () => CollectionRunSetupAuthSnapshot;
  /** Refreshes inherited Authentication labels when profiles change. */
  readonly onAuthenticationChanged?: (listener: () => void) => Disposable;
  readonly getDefaultFailurePolicy: () => CollectionRunFailurePolicyChoice;
  readonly executeRun: (
    config: CollectionRunExecuteConfig,
  ) => Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly message: string }
  >;
}

interface SetupDraft {
  originalTarget: RunPlanTarget;
  selectedEnvironmentId: string | undefined;
  authenticationPreference: CollectionRunAuthenticationPreference;
  failurePolicy: CollectionRunFailurePolicyChoice;
  selectedRequestIds: Set<string>;
  collectionVariables: readonly VariableDefinition[];
  dirty: boolean;
  /**
   * When true, the environment dropdown follows the session active environment.
   * Cleared when the user changes the dropdown. Restored Run Again configs stay
   * pinned even if other Setup fields are edited.
   */
  followActiveEnvironment: boolean;
}

/** Owns a singleton Collection Run Setup panel opened via Run commands. */
export class CollectionRunSetupPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  private draft: SetupDraft | undefined;
  private currentModel: CollectionRunSetupModel | undefined;
  private readonly lastSubmitted = new Map<string, CollectionRunSetupLastSubmitted>();
  private readonly disposables: Disposable[] = [];
  private loadGeneration = 0;

  public constructor(private readonly options: CollectionRunSetupPanelOptions) {
    this.disposables.push(
      options.environmentManager.onDidChange(() => {
        void this.onEnvironmentsChanged();
      }),
      options.discovery.onDidChange(() => {
        void this.onExternalContextChanged();
      }),
    );
    if (options.onAuthenticationChanged !== undefined) {
      this.disposables.push(
        options.onAuthenticationChanged(() => {
          void this.onExternalContextChanged();
        }),
      );
    }
  }

  /** Opens or reveals the Run Setup panel for the given target. */
  public show(options: CollectionRunSetupShowOptions): void {
    this.ensurePanel();
    void this.loadAndPost(options);
  }

  public dispose(): void {
    this.loadGeneration += 1;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.panel?.dispose();
    this.panel = undefined;
    this.draft = undefined;
    this.currentModel = undefined;
    this.lastSubmitted.clear();
  }

  private ensurePanel(): void {
    if (this.panel !== undefined) {
      this.panel.reveal(ViewColumn.Active, false);
      return;
    }

    const panel = window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      'Run Setup',
      { viewColumn: ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );
    this.panel = panel;
    const nonce = createWebviewNonce();
    panel.webview.html = renderCollectionRunSetupHtml(nonce);

    const panelDisposables: Disposable[] = [
      panel.webview.onDidReceiveMessage((raw) => {
        void this.onMessage(raw);
      }),
      panel.onDidDispose(() => {
        for (const disposable of panelDisposables) {
          disposable.dispose();
        }
        this.panel = undefined;
        this.draft = undefined;
        this.currentModel = undefined;
        this.loadGeneration += 1;
      }),
    ];
  }

  private closePanel(): void {
    this.loadGeneration += 1;
    this.panel?.dispose();
    this.panel = undefined;
    this.draft = undefined;
    this.currentModel = undefined;
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = parseCollectionRunSetupMessage(raw);
    if (message === undefined || this.panel === undefined) {
      return;
    }

    if (message.type === 'ready') {
      if (this.currentModel !== undefined) {
        await this.postInit(this.currentModel);
      }
      return;
    }

    if (message.type === 'cancel') {
      this.closePanel();
      return;
    }

    if (message.type === 'focusCollections') {
      await commands.executeCommand(COMMAND_IDS.focusCollections);
      return;
    }

    if (this.draft === undefined) {
      return;
    }

    if (message.type === 'selectEnvironment') {
      this.draft.dirty = true;
      this.draft.followActiveEnvironment = false;
      this.draft.selectedEnvironmentId =
        message.environmentId.trim().length === 0
          ? undefined
          : message.environmentId;
      await this.postDraft();
      return;
    }

    if (message.type === 'setAuthenticationPreference') {
      this.draft.dirty = true;
      this.draft.authenticationPreference = message.preference;
      await this.postDraft();
      return;
    }

    if (message.type === 'setFailurePolicy') {
      this.draft.dirty = true;
      this.draft.failurePolicy = message.failurePolicy;
      await this.postDraft();
      return;
    }

    if (message.type === 'toggleRequest') {
      this.draft.dirty = true;
      if (this.draft.selectedRequestIds.has(message.requestId)) {
        this.draft.selectedRequestIds.delete(message.requestId);
      } else {
        this.draft.selectedRequestIds.add(message.requestId);
      }
      await this.postDraft();
      return;
    }

    if (message.type === 'toggleFolder') {
      this.draft.dirty = true;
      this.toggleFolder(message.folderId);
      await this.postDraft();
      return;
    }

    if (message.type === 'toggleAllRequests') {
      this.draft.dirty = true;
      this.toggleAllRequests();
      await this.postDraft();
      return;
    }

    if (message.type === 'run') {
      await this.onRun();
    }
  }

  private toggleFolder(folderId: string): void {
    if (this.draft === undefined || this.currentModel === undefined) {
      return;
    }
    const descendantIds = collectFolderTreeRequestIds(
      this.currentModel.tree,
      folderId,
    );
    if (descendantIds === undefined || descendantIds.length === 0) {
      return;
    }
    const allSelected = descendantIds.every((id) =>
      this.draft!.selectedRequestIds.has(id),
    );
    if (allSelected) {
      for (const id of descendantIds) {
        this.draft.selectedRequestIds.delete(id);
      }
      return;
    }
    for (const id of descendantIds) {
      this.draft.selectedRequestIds.add(id);
    }
  }

  private toggleAllRequests(): void {
    if (this.draft === undefined) {
      return;
    }
    const aggregate = this.options.discovery.snapshot;
    if (aggregate === undefined) {
      return;
    }
    const ids = listCollectionRunSetupRequestIds(
      aggregate,
      this.draft.originalTarget,
    );
    const allSelected =
      ids.length > 0 && ids.every((id) => this.draft!.selectedRequestIds.has(id));
    this.draft.selectedRequestIds = allSelected ? new Set() : new Set(ids);
  }

  private async onRun(): Promise<void> {
    const draft = this.draft;
    const model = this.currentModel;
    if (
      draft === undefined ||
      model === undefined ||
      model.canRun === false ||
      draft.originalTarget.collectionId !== model.collectionId
    ) {
      return;
    }
    const aggregate =
      this.options.discovery.snapshot ?? (await this.options.discovery.refresh());
    if (
      this.draft !== draft ||
      this.currentModel?.collectionId !== draft.originalTarget.collectionId
    ) {
      return;
    }
    const environments = this.options.environmentManager.list().map((environment) => ({
      id: environment.id,
      name: environment.name,
    }));
    const mapped = toExecuteConfig({
      aggregate,
      originalTarget: draft.originalTarget,
      environments,
      selectedEnvironmentId: draft.selectedEnvironmentId,
      selectedRequestIds: draft.selectedRequestIds,
      failurePolicy: draft.failurePolicy,
      authenticationPreference: draft.authenticationPreference,
    });
    if (!mapped.ok) {
      await this.postDraft(mapped.message);
      return;
    }

    this.lastSubmitted.set(draft.originalTarget.collectionId, {
      collectionId: draft.originalTarget.collectionId,
      originalTarget: draft.originalTarget,
      ...(draft.selectedEnvironmentId === undefined
        ? {}
        : { selectedEnvironmentId: draft.selectedEnvironmentId }),
      authenticationPreference: draft.authenticationPreference,
      failurePolicy: draft.failurePolicy,
      selectedRequestIds: [...draft.selectedRequestIds],
    });

    const result = await this.options.executeRun(mapped.config);
    if (result.ok) {
      this.closePanel();
      return;
    }
    await this.postDraft(result.message);
  }

  private async loadAndPost(options: CollectionRunSetupShowOptions): Promise<void> {
    const generation = this.loadGeneration + 1;
    this.loadGeneration = generation;
    this.draft = undefined;
    const aggregate = await this.options.discovery.refresh();
    if (generation !== this.loadGeneration) {
      return;
    }
    const previous =
      options.restorePrevious === true
        ? this.lastSubmitted.get(options.target.collectionId)
        : undefined;
    let target = previous?.originalTarget ?? options.target;
    const collectionForTarget = aggregate.collections[target.collectionId];
    if (
      target.mode === 'folder' &&
      (collectionForTarget === undefined ||
        collectionForTarget.folders[target.folderId] === undefined)
    ) {
      target = { mode: 'collection', collectionId: target.collectionId };
    }
    const collection = aggregate.collections[target.collectionId];
    if (collection === undefined) {
      this.currentModel = buildCollectionRunSetupModel({
        aggregate,
        target: options.target,
        environments: this.environmentList(),
        collectionVariables: [],
        globalVariables: [],
        workspaceVariables: [],
        environmentVariables: [],
        authentication: {},
        authenticationPreference: 'collection-default',
        failurePolicy: this.options.getDefaultFailurePolicy(),
        selectedRequestIds: [],
        error: 'The selected collection is no longer available.',
      });
      this.updateTitle(this.currentModel.collectionName);
      await this.postInit(this.currentModel);
      return;
    }

    let collectionVariables: readonly VariableDefinition[];
    try {
      collectionVariables = await this.options.collectionVariableStore.load(
        collection.rootPath,
        collection.id,
      );
    } catch {
      collectionVariables = [];
    }
    if (generation !== this.loadGeneration) {
      return;
    }

    const targetRequestIds = listCollectionRunSetupRequestIds(aggregate, target);
    const restoredIds = previous?.selectedRequestIds.filter((id) =>
      targetRequestIds.includes(id),
    );
    const selectedRequestIds =
      restoredIds !== undefined && restoredIds.length > 0
        ? restoredIds
        : targetRequestIds;

    const activeId = this.options.environmentManager.activeId;
    const environments = this.environmentList();
    const restoredEnv = previous?.selectedEnvironmentId;
    const selectedEnvironmentId =
      previous !== undefined
        ? restoredEnv !== undefined &&
          environments.some((environment) => environment.id === restoredEnv)
          ? restoredEnv
          : undefined
        : activeId !== undefined &&
            environments.some((environment) => environment.id === activeId)
          ? activeId
          : undefined;

    this.draft = {
      originalTarget: target,
      selectedEnvironmentId,
      authenticationPreference: previous?.authenticationPreference ?? 'collection-default',
      failurePolicy: previous?.failurePolicy ?? this.options.getDefaultFailurePolicy(),
      selectedRequestIds: new Set(selectedRequestIds),
      collectionVariables,
      dirty: false,
      followActiveEnvironment: previous === undefined,
    };
    this.currentModel = this.buildModel(aggregate);
    this.updateTitle(this.currentModel.collectionName);
    await this.postInit(this.currentModel);
  }

  private async onEnvironmentsChanged(): Promise<void> {
    if (this.panel === undefined || this.draft === undefined) {
      return;
    }
    const environments = this.environmentList();
    const selected = this.draft.selectedEnvironmentId;
    if (
      selected !== undefined &&
      !environments.some((environment) => environment.id === selected)
    ) {
      this.draft.selectedEnvironmentId = undefined;
    }
    if (this.draft.followActiveEnvironment) {
      const activeId = this.options.environmentManager.activeId;
      this.draft.selectedEnvironmentId =
        activeId !== undefined &&
        environments.some((environment) => environment.id === activeId)
          ? activeId
          : undefined;
    }
    await this.postDraft();
  }

  private async onExternalContextChanged(): Promise<void> {
    if (this.panel === undefined || this.draft === undefined) {
      return;
    }
    const aggregate =
      this.options.discovery.snapshot ??
      (await this.options.discovery.refresh());
    const collection = aggregate.collections[this.draft.originalTarget.collectionId];
    if (collection !== undefined) {
      try {
        this.draft.collectionVariables =
          await this.options.collectionVariableStore.load(
            collection.rootPath,
            collection.id,
          );
      } catch {
        this.draft.collectionVariables = [];
      }
    }
    await this.postDraft();
  }

  private async postDraft(error?: string): Promise<void> {
    const aggregate =
      this.options.discovery.snapshot ?? (await this.options.discovery.refresh());
    if (this.draft === undefined) {
      return;
    }
    this.currentModel = this.buildModel(aggregate, error);
    await this.postInit(this.currentModel);
  }

  private buildModel(
    aggregate: Awaited<ReturnType<CollectionDiscoveryService['refresh']>>,
    error?: string,
  ): CollectionRunSetupModel {
    const draft = this.draft;
    const capture = this.options.environmentManager.capture();
    const environments = this.environmentList();
    const selectedEnv =
      draft === undefined || draft.selectedEnvironmentId === undefined
        ? undefined
        : this.options.environmentManager
            .list()
            .find((environment) => environment.id === draft.selectedEnvironmentId);
    const collection =
      draft === undefined
        ? undefined
        : aggregate.collections[draft.originalTarget.collectionId];
    const authSnapshot = this.options.getAuthenticationSnapshot?.();
    const collectionDefaultId = collection?.metadata.defaultAuthenticationId;
    const collectionDefaultLabel = profileLabel(
      authSnapshot,
      collectionDefaultId,
    );
    const workspaceDefaultId = authSnapshot?.defaultProfileId;
    const workspaceDefaultLabel = profileLabel(authSnapshot, workspaceDefaultId);

    return buildCollectionRunSetupModel({
      aggregate,
      target:
        draft?.originalTarget ?? {
          mode: 'collection',
          collectionId: '',
        },
      environments,
      selectedEnvironmentId: draft?.selectedEnvironmentId,
      collectionVariables: draft?.collectionVariables ?? [],
      globalVariables: capture.globalVariables,
      workspaceVariables: capture.workspaceVariables,
      environmentVariables: selectedEnv?.variables ?? [],
      authentication: {
        ...(collectionDefaultId === undefined ? {} : { collectionDefaultId }),
        ...(collectionDefaultLabel === undefined
          ? {}
          : { collectionDefaultLabel }),
        ...(workspaceDefaultId === undefined ? {} : { workspaceDefaultId }),
        ...(workspaceDefaultLabel === undefined
          ? {}
          : { workspaceDefaultLabel }),
        ...(authSnapshot === undefined ? {} : { profiles: authSnapshot.profiles }),
      },
      authenticationPreference: draft?.authenticationPreference ?? 'collection-default',
      failurePolicy: draft?.failurePolicy ?? this.options.getDefaultFailurePolicy(),
      selectedRequestIds: draft?.selectedRequestIds ?? [],
      ...(error === undefined ? {} : { error }),
    });
  }

  private environmentList(): readonly { readonly id: string; readonly name: string }[] {
    return this.options.environmentManager.list().map((environment) => ({
      id: environment.id,
      name: environment.name,
    }));
  }

  private updateTitle(collectionName: string): void {
    if (this.panel !== undefined) {
      this.panel.title = `Run Setup: ${collectionName}`;
    }
  }

  private async postInit(model: CollectionRunSetupModel): Promise<void> {
    if (this.panel === undefined) {
      return;
    }
    await this.panel.webview.postMessage({ type: 'init', model });
  }
}

function profileLabel(
  snapshot: CollectionRunSetupAuthSnapshot | undefined,
  id: string | undefined,
): string | undefined {
  if (snapshot === undefined || id === undefined || id.trim().length === 0) {
    return undefined;
  }
  const label = snapshot.profiles.find((profile) => profile.id === id)?.label?.trim();
  return label !== undefined && label.length > 0 ? label : undefined;
}
