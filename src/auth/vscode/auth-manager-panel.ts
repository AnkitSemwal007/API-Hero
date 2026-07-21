/**
 * Command-opened WebviewPanel host for the Auth Profiles Manager.
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
const PANEL_TITLE = 'Auth Profiles Manager';

export interface AuthManagerPanelOptions {
  readonly profileManager: AuthenticationProfileManager;
  readonly secrets: AuthenticationSecretRepository;
}

/** Owns a singleton Auth Profiles Manager panel. */
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

  /** Opens or reveals the Auth Profiles Manager panel. */
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
      await writeAuthManagerState(message.state, this.baselineProfiles);
      const nextIds = new Set(message.state.profiles.map((profile) => profile.id));
      for (const id of previousIds) {
        if (!nextIds.has(id)) {
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
  for (const entry of meta) {
    const source = data[entry.field];
    if (!isSecretSource(source)) {
      continue;
    }
    const present = await secrets.get(profile.id, entry.field);
    secretFields.push({
      field: entry.field,
      label: entry.label,
      status: (present === undefined ? 'missing' : 'set') as 'set' | 'missing',
    });
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
  };
}

function isSecretSource(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'secret'
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
