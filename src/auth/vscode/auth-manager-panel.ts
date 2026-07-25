/**
 * Command-opened WebviewPanel host for Manage Authentication.
 */

import {
  ViewColumn,
  window,
  type Disposable,
  type WebviewPanel,
} from 'vscode';

import { createWebviewNonce } from '../../ui/webview';
import type { AuthenticationProfileManager } from '../authentication-profile-manager';
import type { AuthenticationSecretRepository } from '../authentication-resolver';
import type { AuthenticationProfile } from '../../models';
import {
  parseAuthManagerMessage,
  renderAuthManagerHtml,
  secretFieldsForProvider,
  validateAuthManagerState,
  type AuthManagerCredentialSource,
  type AuthManagerProfile,
  type AuthManagerProviderId,
  type AuthManagerState,
} from './auth-manager-html';
import {
  confirmAndClearAuthSecret,
  promptAndStoreAuthSecret,
} from './auth-secret-prompt';
import { writeAuthManagerState } from './auth-settings-writer';

const PANEL_VIEW_TYPE = 'apiRunner.authManager';
const PANEL_TITLE = 'Manage Authentication';

export interface AuthManagerPanelOptions {
  readonly profileManager: AuthenticationProfileManager;
  readonly secrets: AuthenticationSecretRepository;
}

/** Owns a singleton Manage Authentication panel. */
export class AuthManagerPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  private baselineProfiles: readonly AuthenticationProfile[];
  private readonly disposables: Disposable[] = [];

  public constructor(private readonly options: AuthManagerPanelOptions) {
    this.baselineProfiles = options.profileManager.list();
    this.disposables.push(
      options.profileManager.onDidChange(() => {
        this.baselineProfiles = options.profileManager.list();
        void this.postInit();
      }),
    );
  }

  /** Opens or reveals the Manage Authentication panel. */
  public show(selectedId?: string): void {
    if (this.panel !== undefined) {
      this.panel.reveal(ViewColumn.Beside, false);
      void this.postInit(selectedId);
      return;
    }

    const panel = window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      PANEL_TITLE,
      { viewColumn: ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );
    this.panel = panel;

    const nonce = createWebviewNonce();
    panel.webview.html = renderAuthManagerHtml(nonce);
    this.baselineProfiles = this.options.profileManager.list();

    const panelDisposables: Disposable[] = [
      panel.webview.onDidReceiveMessage((raw) => {
        void this.onMessage(raw);
      }),
      panel.onDidDispose(() => {
        for (const disposable of panelDisposables) {
          disposable.dispose();
        }
        this.panel = undefined;
      }),
    ];

    if (selectedId !== undefined) {
      void this.postInit(selectedId);
    }
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.panel?.dispose();
    this.panel = undefined;
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = parseAuthManagerMessage(raw);
    if (message === undefined || this.panel === undefined) {
      return;
    }
    if (message.type === 'ready') {
      await this.postInit();
      return;
    }
    if (message.type === 'setSecret') {
      const saved = await promptAndStoreAuthSecret(
        this.options.secrets,
        message.profileId,
        message.field,
      );
      if (saved) {
        await this.postInit(message.profileId);
      }
      return;
    }
    if (message.type === 'clearSecret') {
      const cleared = await confirmAndClearAuthSecret(
        this.options.secrets,
        message.profileId,
        message.field,
      );
      if (cleared) {
        await this.postInit(message.profileId);
      }
      return;
    }
    if (message.type === 'setDefault') {
      try {
        this.options.profileManager.selectDefault(message.profileId);
        await this.postInit(message.profileId);
      } catch (cause) {
        const text = cause instanceof Error ? cause.message : String(cause);
        await this.panel.webview.postMessage({
          type: 'error',
          message: text || 'Unable to set default profile.',
        });
      }
      return;
    }

    const error = validateAuthManagerState(message.state);
    if (error !== undefined) {
      await this.panel.webview.postMessage({ type: 'error', message: error });
      return;
    }

    try {
      const previousIds = new Set(
        this.baselineProfiles.map((profile) => profile.id),
      );
      const renamedPairs = findRenamedProfiles(
        this.baselineProfiles,
        message.state.profiles,
      );
      // Copy secrets under the new id first (leave old keys intact) so a failed
      // settings write can roll back without destroying the old secrets.
      for (const { fromId, toId } of renamedPairs) {
        await copyProfileSecrets(this.options.secrets, fromId, toId);
      }
      try {
        await writeAuthManagerState(message.state, this.baselineProfiles);
      } catch (writeError) {
        for (const { toId } of renamedPairs) {
          await this.clearProfileSecrets(toId);
        }
        throw writeError;
      }
      for (const { fromId } of renamedPairs) {
        await this.clearProfileSecrets(fromId);
      }
      const nextIds = new Set(message.state.profiles.map((profile) => profile.id));
      for (const id of previousIds) {
        if (!nextIds.has(id) && !renamedPairs.some((pair) => pair.fromId === id)) {
          await this.clearProfileSecrets(id);
        }
      }
      if (
        message.state.defaultProfileId !==
        this.options.profileManager.defaultProfileId
      ) {
        this.options.profileManager.selectDefault(message.state.defaultProfileId);
      }
      this.baselineProfiles = this.options.profileManager.list();
      await this.postInit(message.state.selectedId);
      window.setStatusBarMessage('API Hero: Authentication saved', 3_000);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      await this.panel.webview.postMessage({
        type: 'error',
        message: text || 'Unable to save authentication profiles.',
      });
    }
  }

  private async postInit(selectedId?: string): Promise<void> {
    if (this.panel === undefined) {
      return;
    }
    this.baselineProfiles = this.options.profileManager.list();
    const state = await snapshotFromManager(
      this.options.profileManager,
      this.options.secrets,
      selectedId,
    );
    await this.panel.webview.postMessage({ type: 'init', state });
  }

  private async clearProfileSecrets(profileId: string): Promise<void> {
    for (const providerId of ['basic', 'bearer', 'apiKey'] as const) {
      for (const field of secretFieldsForProvider(providerId)) {
        await this.options.secrets.delete(profileId, field.field);
      }
    }
  }
}

async function snapshotFromManager(
  manager: AuthenticationProfileManager,
  secrets: AuthenticationSecretRepository,
  selectedId?: string,
): Promise<AuthManagerState> {
  const profiles = await Promise.all(
    manager.list().map((profile) => toManagerProfile(profile, secrets)),
  );
  return {
    profiles,
    ...(manager.defaultProfileId === undefined
      ? {}
      : { defaultProfileId: manager.defaultProfileId }),
    ...(selectedId === undefined ? {} : { selectedId }),
  };
}

async function toManagerProfile(
  profile: AuthenticationProfile,
  secrets: AuthenticationSecretRepository,
): Promise<AuthManagerProfile> {
  const providerId = normalizeProviderId(profile.providerId);
  const meta = secretFieldsForProvider(providerId);
  const data = profile as Readonly<Record<string, unknown>>;
  const secretFields = [];
  const credentialSources: AuthManagerCredentialSource[] = [];
  for (const entry of meta) {
    const source = data[entry.field];
    if (isSecretSource(source)) {
      const present = await secrets.get(profile.id, entry.field);
      secretFields.push({
        field: entry.field,
        label: entry.label,
        status: (present === undefined ? 'missing' : 'set') as 'set' | 'missing',
      });
      continue;
    }
    if (isVariableSource(source)) {
      credentialSources.push({
        field: entry.field,
        label: entry.label,
        kind: 'variable',
        detail: source.name,
      });
      continue;
    }
    if (isLiteralSource(source)) {
      credentialSources.push({
        field: entry.field,
        label: entry.label,
        kind: 'literal',
        detail: '(literal value)',
      });
    }
  }
  return {
    id: profile.id,
    label: profile.label?.trim() || profile.id,
    providerId,
    ...(providerId === 'apiKey' && typeof data.name === 'string'
      ? { apiKeyName: data.name }
      : {}),
    ...(providerId === 'apiKey' &&
    (data.location === 'header' || data.location === 'query')
      ? { apiKeyLocation: data.location }
      : {}),
    secretFields,
    credentialSources,
  };
}

function findRenamedProfiles(
  baseline: readonly AuthenticationProfile[],
  next: readonly AuthManagerProfile[],
): readonly { readonly fromId: string; readonly toId: string }[] {
  if (baseline.length !== next.length) {
    return [];
  }
  const pairs: { fromId: string; toId: string }[] = [];
  for (let index = 0; index < baseline.length; index += 1) {
    const from = baseline[index]!;
    const to = next[index]!;
    if (from.id !== to.id) {
      const fromStillPresent = next.some((profile) => profile.id === from.id);
      const toWasPresent = baseline.some((profile) => profile.id === to.id);
      if (!fromStillPresent && !toWasPresent) {
        pairs.push({ fromId: from.id, toId: to.id });
      }
    }
  }
  return pairs;
}

/** Copies secret values to a new profile id without deleting the old keys. */
async function copyProfileSecrets(
  secrets: AuthenticationSecretRepository,
  fromId: string,
  toId: string,
): Promise<void> {
  for (const providerId of ['basic', 'bearer', 'apiKey'] as const) {
    for (const field of secretFieldsForProvider(providerId)) {
      const value = await secrets.get(fromId, field.field);
      if (value === undefined) {
        continue;
      }
      await secrets.store(toId, field.field, value);
    }
  }
}

function isSecretSource(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'secret'
  );
}

function isVariableSource(
  value: unknown,
): value is { readonly kind: 'variable'; readonly name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'variable' &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

function isLiteralSource(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'literal'
  );
}

function normalizeProviderId(value: string): AuthManagerProviderId {
  if (
    value === 'none' ||
    value === 'basic' ||
    value === 'bearer' ||
    value === 'apiKey'
  ) {
    return value;
  }
  return 'none';
}
