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
import {
  deriveAuthenticationHealth,
  SESSION_SECRET_FIELDS,
  type AuthenticationSessionStore,
  type LoginApiConfig,
} from '../authentication-session';
import type { AuthenticationProfile } from '../../models';
import {
  parseAuthManagerMessage,
  renderAuthManagerHtml,
  secretFieldsForProvider,
  validateAuthManagerState,
  type AuthManagerCredentialSource,
  type AuthManagerLoginConfig,
  type AuthManagerProfile,
  type AuthManagerProviderId,
  type AuthManagerState,
} from './auth-manager-html';
import {
  confirmAndClearAuthSecret,
  promptAndStoreAuthSecret,
  storeAuthSecret,
} from './auth-secret-prompt';
import { writeAuthManagerState } from './auth-settings-writer';
import {
  applyLoginTokensFromWizard,
  runAuthenticationLoginFromWizard,
  runTestAuthenticationCommand,
} from './auth-commands';

const PANEL_VIEW_TYPE = 'apiHero.authManager';
const PANEL_TITLE = 'Manage Authentication';

export interface AuthManagerPanelOptions {
  readonly profileManager: AuthenticationProfileManager;
  readonly secrets: AuthenticationSecretRepository;
  readonly sessions?: AuthenticationSessionStore;
  readonly authServices?: () => import('./auth-commands').AuthCommandServices;
}

/** Owns a singleton Manage Authentication panel. */
export class AuthManagerPanel implements Disposable {
  private panel: WebviewPanel | undefined;
  private baselineProfiles: readonly AuthenticationProfile[];
  private readonly disposables: Disposable[] = [];
  /** Last login JSON body held only on the host for token apply (never in webview). */
  private lastLoginBodies = new Map<string, unknown>();

  public constructor(private readonly options: AuthManagerPanelOptions) {
    this.baselineProfiles = options.profileManager.list();
    this.disposables.push(
      options.profileManager.onDidChange(() => {
        this.baselineProfiles = options.profileManager.list();
        void this.postInit();
      }),
    );
    if (options.sessions !== undefined) {
      this.disposables.push(
        options.sessions.onDidChange(() => {
          void this.postInit();
        }),
      );
    }
  }

  /** Opens or reveals the Manage Authentication panel. */
  public show(
    selectedId?: string,
    options?: { readonly focusSecretField?: string; readonly openLoginWizard?: boolean },
  ): void {
    if (this.panel !== undefined) {
      this.panel.reveal(ViewColumn.Beside, false);
      void this.postInit(selectedId, options);
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
        this.lastLoginBodies.clear();
        for (const disposable of panelDisposables) {
          disposable.dispose();
        }
        this.panel = undefined;
      }),
    ];

    void this.postInit(selectedId, options);
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.lastLoginBodies.clear();
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
    if (message.type === 'storeSecret') {
      const saved = await storeAuthSecret(
        this.options.secrets,
        message.profileId,
        message.field,
        message.value,
      );
      if (saved) {
        await this.postInit(message.profileId);
      }
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
          message: text || 'Unable to set default Authentication.',
        });
      }
      return;
    }
    if (message.type === 'testAuth') {
      const services = this.options.authServices?.();
      if (services === undefined) {
        await this.panel.webview.postMessage({
          type: 'error',
          message: 'Test Authentication is not available.',
        });
        return;
      }
      const result = await runTestAuthenticationCommand(
        services,
        message.profileId,
        { testUrl: message.testUrl, silent: true },
      );
      if (result !== undefined) {
        await this.panel.webview.postMessage({
          type: 'testResult',
          profileId: message.profileId,
          result,
        });
      }
      await this.postInit(message.profileId);
      return;
    }
    if (message.type === 'saveLoginConfig') {
      const sessions = this.options.sessions;
      if (sessions === undefined) {
        return;
      }
      const login = toLoginApiConfig(message.login);
      sessions.patch(message.profileId, {
        status: sessions.get(message.profileId)?.status ?? 'unknown',
        login,
      });
      await this.postInit(message.profileId);
      return;
    }
    if (message.type === 'runLogin') {
      const services = this.options.authServices?.();
      if (services === undefined) {
        await this.panel.webview.postMessage({
          type: 'error',
          message: 'Login is not available.',
        });
        return;
      }
      if (message.login !== undefined) {
        services.sessions.patch(message.profileId, {
          status: services.sessions.get(message.profileId)?.status ?? 'unknown',
          login: toLoginApiConfig(message.login),
        });
      }
      if (message.username !== undefined && message.username.length > 0) {
        await storeAuthSecret(
          this.options.secrets,
          message.profileId,
          SESSION_SECRET_FIELDS.loginUsername,
          message.username,
        );
      }
      if (message.password !== undefined && message.password.length > 0) {
        await storeAuthSecret(
          this.options.secrets,
          message.profileId,
          SESSION_SECRET_FIELDS.loginPassword,
          message.password,
        );
      }
      const outcome = await runAuthenticationLoginFromWizard(
        services,
        message.profileId,
      );
      if (outcome.body !== undefined) {
        this.lastLoginBodies.set(message.profileId, outcome.body);
      }
      await this.panel.webview.postMessage({
        type: 'loginResult',
        profileId: message.profileId,
        result: outcome.result,
      });
      await this.postInit(message.profileId);
      return;
    }
    if (message.type === 'applyLoginTokens') {
      const services = this.options.authServices?.();
      const body = this.lastLoginBodies.get(message.profileId);
      if (services === undefined || body === undefined) {
        await this.panel.webview.postMessage({
          type: 'error',
          message: 'No login response available to create a Session.',
        });
        return;
      }
      const existing = services.sessions.get(message.profileId);
      if (
        existing?.accessTokenPresent === true &&
        message.confirmOverwrite !== true
      ) {
        await this.panel.webview.postMessage({
          type: 'error',
          message: 'Confirm overwrite to replace the existing Session.',
        });
        return;
      }
      await applyLoginTokensFromWizard(services, {
        profileId: message.profileId,
        body,
        accessTokenPath: message.accessTokenPath,
        refreshTokenPath: message.refreshTokenPath,
      });
      this.lastLoginBodies.delete(message.profileId);
      await this.postInit(message.profileId);
      return;
    }
    if (message.type === 'cancelLoginWizard') {
      this.lastLoginBodies.delete(message.profileId);
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
      for (const { fromId, toId } of renamedPairs) {
        await copyProfileSecrets(this.options.secrets, fromId, toId);
        remountSession(this.options.sessions, fromId, toId);
      }
      try {
        await writeAuthManagerState(message.state, this.baselineProfiles);
      } catch (writeError) {
        for (const { toId } of renamedPairs) {
          await this.clearProfileSecrets(toId);
          this.options.sessions?.delete(toId);
        }
        throw writeError;
      }
      for (const { fromId } of renamedPairs) {
        await this.clearProfileSecrets(fromId);
        this.options.sessions?.delete(fromId);
        this.lastLoginBodies.delete(fromId);
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
        message: text || 'Unable to save Authentication.',
      });
    }
  }

  private async postInit(
    selectedId?: string,
    options?: { readonly focusSecretField?: string; readonly openLoginWizard?: boolean },
  ): Promise<void> {
    if (this.panel === undefined) {
      return;
    }
    this.baselineProfiles = this.options.profileManager.list();
    const state = await snapshotFromManager(
      this.options.profileManager,
      this.options.secrets,
      selectedId,
      this.options.sessions,
      options,
    );
    await this.panel.webview.postMessage({ type: 'init', state });
  }

  private async clearProfileSecrets(profileId: string): Promise<void> {
    for (const providerId of ['basic', 'bearer', 'apiKey'] as const) {
      for (const field of secretFieldsForProvider(providerId)) {
        await this.options.secrets.delete(profileId, field.field);
      }
    }
    for (const field of Object.values(SESSION_SECRET_FIELDS)) {
      await this.options.secrets.delete(profileId, field);
    }
  }
}

function toLoginApiConfig(login: AuthManagerLoginConfig): LoginApiConfig {
  return {
    method: login.method,
    url: login.url,
    sendAs: login.sendAs,
    ...(login.bodyTemplate !== undefined
      ? { bodyTemplate: login.bodyTemplate }
      : {}),
    ...(login.contentType !== undefined
      ? { contentType: login.contentType }
      : {}),
    ...(login.tokenPath !== undefined ? { tokenPath: login.tokenPath } : {}),
    ...(login.refreshTokenPath !== undefined
      ? { refreshTokenPath: login.refreshTokenPath }
      : {}),
  };
}

async function snapshotFromManager(
  manager: AuthenticationProfileManager,
  secrets: AuthenticationSecretRepository,
  selectedId?: string,
  sessions?: AuthenticationSessionStore,
  options?: { readonly focusSecretField?: string; readonly openLoginWizard?: boolean },
): Promise<AuthManagerState> {
  const profiles = await Promise.all(
    manager.list().map((profile) => toManagerProfile(profile, secrets, sessions)),
  );
  return {
    profiles,
    ...(manager.defaultProfileId === undefined
      ? {}
      : { defaultProfileId: manager.defaultProfileId }),
    ...(selectedId === undefined ? {} : { selectedId }),
    ...(options?.focusSecretField !== undefined
      ? { focusSecretField: options.focusSecretField }
      : {}),
    ...(options?.openLoginWizard === true ? { openLoginWizard: true } : {}),
  };
}

async function toManagerProfile(
  profile: AuthenticationProfile,
  secrets: AuthenticationSecretRepository,
  sessions?: AuthenticationSessionStore,
): Promise<AuthManagerProfile> {
  const providerId = normalizeProviderId(profile.providerId);
  const meta = secretFieldsForProvider(providerId);
  const data = profile as Readonly<Record<string, unknown>>;
  const secretFields = [];
  const credentialSources: AuthManagerCredentialSource[] = [];
  let profileSecretPresent: boolean | undefined;
  for (const entry of meta) {
    const source = data[entry.field];
    if (isSecretSource(source)) {
      const present = await secrets.get(profile.id, entry.field);
      const status = (present === undefined ? 'missing' : 'set') as
        | 'set'
        | 'missing';
      secretFields.push({
        field: entry.field,
        label: entry.label,
        status,
      });
      if (profileSecretPresent !== false) {
        profileSecretPresent = status === 'set';
      }
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
  const session = sessions?.get(profile.id);
  const health = deriveAuthenticationHealth({
    session,
    ...(profileSecretPresent === undefined
      ? {}
      : { profileSecretPresent }),
  });
  const loginUsername = await secrets.get(
    profile.id,
    SESSION_SECRET_FIELDS.loginUsername,
  );
  const loginPassword = await secrets.get(
    profile.id,
    SESSION_SECRET_FIELDS.loginPassword,
  );
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
    healthLabel: health.label,
    healthDetail: health.detail,
    healthStatus: health.status,
    ...(session?.accessTokenPresent === true
      ? { sessionAccessTokenPresent: true }
      : {}),
    ...(session?.refreshTokenPresent === true
      ? { sessionRefreshTokenPresent: true }
      : {}),
    ...(session?.expiresAt !== undefined
      ? { sessionExpiresAt: session.expiresAt }
      : {}),
    ...(session?.lastTestSummary !== undefined
      ? { lastTestSummary: session.lastTestSummary }
      : {}),
    ...(session?.login !== undefined
      ? {
          login: {
            method: session.login.method,
            url: session.login.url,
            sendAs: session.login.sendAs,
            ...(session.login.bodyTemplate !== undefined
              ? { bodyTemplate: session.login.bodyTemplate }
              : {}),
            ...(session.login.contentType !== undefined
              ? { contentType: session.login.contentType }
              : {}),
            ...(session.login.tokenPath !== undefined
              ? { tokenPath: session.login.tokenPath }
              : {}),
            ...(session.login.refreshTokenPath !== undefined
              ? { refreshTokenPath: session.login.refreshTokenPath }
              : {}),
          },
        }
      : {}),
    loginUsernameStatus: loginUsername === undefined ? 'missing' : 'set',
    loginPasswordStatus: loginPassword === undefined ? 'missing' : 'set',
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
  for (const field of Object.values(SESSION_SECRET_FIELDS)) {
    const value = await secrets.get(fromId, field);
    if (value === undefined) {
      continue;
    }
    await secrets.store(toId, field, value);
  }
}

/** Copies session metadata to the new Authentication id (secret-free fields only). */
function remountSession(
  sessions: AuthenticationSessionStore | undefined,
  fromId: string,
  toId: string,
): void {
  if (sessions === undefined) {
    return;
  }
  const previous = sessions.get(fromId);
  if (previous === undefined) {
    return;
  }
  sessions.set({
    ...previous,
    authenticationId: toId,
  });
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
