/**
 * Registers Manage Authentication command, panel, missing-secret code actions,
 * and Authentication Evolution commands (test / login / save-as / use-token).
 */

import {
  CodeAction,
  CodeActionKind,
  languages,
  window,
  type CodeActionProvider,
  type Diagnostic,
  type Disposable,
  type ExtensionContext,
  type TextDocument,
  type Range,
  type CodeActionContext,
} from 'vscode';

import { registerCommandWithLegacyAlias } from '../../commands';
import { COMMAND_IDS } from '../../constants';
import type { RequestExecutor } from '../../execution';
import type { CollectionDiscoveryService } from '../../collections';
import type { AuthenticationProfileManager } from '../authentication-profile-manager';
import type { AuthenticationSecretRepository } from '../authentication-resolver';
import {
  AuthenticationSessionStore,
  type AuthenticationSession,
} from '../authentication-session';
import type { EphemeralAuthenticationBinding } from '../ephemeral-authentication';
import {
  runAuthenticationLoginCommand,
  runSaveAsAuthenticationCommand,
  runTestAuthenticationCommand,
  runUseResponseAsAuthenticationCommand,
  type AuthCommandServices,
} from './auth-commands';
import { AuthManagerPanel } from './auth-manager-panel';
import { runSetCollectionDefaultAuthenticationCommand } from './set-collection-default-auth';

/** Matches language-support `authentication.missing-secret` diagnostics. */
const MISSING_SECRET_DIAGNOSTIC_CODE = 'authentication.missing-secret';
const API_LANGUAGE_ID = 'api';
const SESSIONS_STATE_KEY = 'apiHero.authentication.sessions';

export interface RegisterAuthOptions {
  readonly context: ExtensionContext;
  readonly profileManager: AuthenticationProfileManager;
  readonly secrets: AuthenticationSecretRepository;
  readonly executor: RequestExecutor;
  readonly sessions?: AuthenticationSessionStore;
  readonly discovery?: CollectionDiscoveryService;
}

export interface AuthRegistration {
  readonly disposables: readonly Disposable[];
  readonly panel: AuthManagerPanel;
  readonly sessions: AuthenticationSessionStore;
  readonly services: AuthCommandServices;
}

/** Wires Manage Authentication UI and Evolution commands into the extension host. */
export function registerAuth(options: RegisterAuthOptions): AuthRegistration {
  const { context, profileManager, secrets, executor } = options;
  const sessions =
    options.sessions ?? loadSessionStore(context);
  const services: AuthCommandServices = {
    profileManager,
    secrets,
    sessions,
    executor,
  };
  const panel = new AuthManagerPanel({
    profileManager,
    secrets,
    sessions,
    authServices: () => services,
  });

  const persistSessions = sessions.onDidChange(() => {
    void context.workspaceState.update(
      SESSIONS_STATE_KEY,
      sessions.list().map((session) => ({ ...session })),
    );
  });

  const manageCommand = registerCommandWithLegacyAlias(
    COMMAND_IDS.manageAuthProfiles,
    (selectedId?: unknown) => {
      panel.show(
        typeof selectedId === 'string' && selectedId.length > 0
          ? selectedId
          : undefined,
      );
    },
  );

  const setSecretCommand = registerCommandWithLegacyAlias(
    COMMAND_IDS.setAuthSecret,
    async (profileId?: unknown, field?: unknown) => {
      if (typeof profileId !== 'string' || typeof field !== 'string') {
        return;
      }
      // Prefer Auth Manager inline credentials; InputBox remains a fallback.
      panel.show(profileId, { focusSecretField: field });
    },
  );

  const testCommand = registerCommandWithLegacyAlias(
    COMMAND_IDS.testAuthentication,
    (profileId?: unknown) =>
      runTestAuthenticationCommand(
        services,
        typeof profileId === 'string' ? profileId : undefined,
      ),
  );

  const loginCommand = registerCommandWithLegacyAlias(
    COMMAND_IDS.runAuthenticationLogin,
    (profileId?: unknown) =>
      runAuthenticationLoginCommand(
        services,
        typeof profileId === 'string' ? profileId : undefined,
      ),
  );

  const saveAsCommand = registerCommandWithLegacyAlias(
    COMMAND_IDS.saveAsAuthentication,
    (ephemeral?: unknown) => {
      if (!isEphemeralBinding(ephemeral)) {
        return undefined;
      }
      return runSaveAsAuthenticationCommand(services, ephemeral);
    },
  );

  const useResponseCommand = registerCommandWithLegacyAlias(
    COMMAND_IDS.useResponseAsAuthentication,
    (body?: unknown, preferredProfileId?: unknown) =>
      runUseResponseAsAuthenticationCommand(
        services,
        body,
        typeof preferredProfileId === 'string' ? preferredProfileId : undefined,
      ),
  );

  const collectionDefaultCommand = registerCommandWithLegacyAlias(
    COMMAND_IDS.setCollectionDefaultAuthentication,
    async (collectionArg?: unknown) => {
      if (options.discovery === undefined) {
        void window.showWarningMessage('Collections discovery is not available.');
        return;
      }
      await runSetCollectionDefaultAuthenticationCommand({
        discovery: options.discovery,
        profileManager,
        collectionArg,
      });
    },
  );

  const codeActions = languages.registerCodeActionsProvider(
    { language: API_LANGUAGE_ID },
    new AuthMissingSecretCodeActionProvider(),
  );

  const disposables: Disposable[] = [
    panel,
    manageCommand,
    setSecretCommand,
    testCommand,
    loginCommand,
    saveAsCommand,
    useResponseCommand,
    collectionDefaultCommand,
    codeActions,
    persistSessions,
  ];
  context.subscriptions.push(...disposables);
  return { disposables, panel, sessions, services };
}

function loadSessionStore(context: ExtensionContext): AuthenticationSessionStore {
  const store = new AuthenticationSessionStore();
  const raw = context.workspaceState.get<unknown>(SESSIONS_STATE_KEY);
  if (Array.isArray(raw)) {
    const sessions: AuthenticationSession[] = [];
    for (const entry of raw) {
      if (
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as { authenticationId?: unknown }).authenticationId ===
          'string' &&
        typeof (entry as { status?: unknown }).status === 'string'
      ) {
        sessions.push(entry as AuthenticationSession);
      }
    }
    store.replaceAll(sessions);
  }
  return store;
}

function isEphemeralBinding(
  value: unknown,
): value is EphemeralAuthenticationBinding {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<EphemeralAuthenticationBinding>;
  return (
    (record.providerId === 'bearer' ||
      record.providerId === 'basic' ||
      record.providerId === 'apiKey') &&
    record.material !== undefined &&
    typeof record.material === 'object'
  );
}

class AuthMissingSecretCodeActionProvider implements CodeActionProvider {
  public provideCodeActions(
    _document: TextDocument,
    _range: Range,
    context: CodeActionContext,
  ): CodeAction[] {
    const actions: CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      const target = parseMissingSecretDiagnostic(diagnostic);
      if (target === undefined) {
        continue;
      }
      const action = new CodeAction(
        `Set secret for "${target.profileId}" (${target.field})`,
        CodeActionKind.QuickFix,
      );
      action.diagnostics = [diagnostic];
      action.isPreferred = true;
      action.command = {
        title: action.title,
        command: COMMAND_IDS.setAuthSecret,
        arguments: [target.profileId, target.field],
      };
      actions.push(action);

      const manage = new CodeAction(
        'Manage Authentication',
        CodeActionKind.QuickFix,
      );
      manage.diagnostics = [diagnostic];
      manage.command = {
        title: manage.title,
        command: COMMAND_IDS.manageAuthProfiles,
        arguments: [target.profileId],
      };
      actions.push(manage);
    }
    return actions;
  }
}

function parseMissingSecretDiagnostic(
  diagnostic: Diagnostic,
): { readonly profileId: string; readonly field: string } | undefined {
  if (diagnostic.code !== MISSING_SECRET_DIAGNOSTIC_CODE) {
    return undefined;
  }
  const match =
    /^Authentication profile "([^"]+)" is missing secret field "([^"]+)"\.$/u.exec(
      diagnostic.message,
    );
  if (match === null) {
    return undefined;
  }
  return { profileId: match[1]!, field: match[2]! };
}
