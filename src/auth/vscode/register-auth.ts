/**
 * Registers Auth Profiles Manager command, panel, and missing-secret code actions.
 */

import {
  CodeAction,
  CodeActionKind,
  commands,
  languages,
  type CodeActionProvider,
  type Diagnostic,
  type Disposable,
  type ExtensionContext,
  type TextDocument,
  type Range,
  type CodeActionContext,
} from 'vscode';

import { COMMAND_IDS } from '../../constants';
import type { AuthenticationProfileManager } from '../authentication-profile-manager';
import type { AuthenticationSecretRepository } from '../authentication-resolver';
import { AuthManagerPanel } from './auth-manager-panel';
import { promptAndStoreAuthSecret } from './auth-secret-prompt';

/** Matches language-support `authentication.missing-secret` diagnostics. */
const MISSING_SECRET_DIAGNOSTIC_CODE = 'authentication.missing-secret';
const API_LANGUAGE_ID = 'api';

export interface RegisterAuthOptions {
  readonly context: ExtensionContext;
  readonly profileManager: AuthenticationProfileManager;
  readonly secrets: AuthenticationSecretRepository;
}

export interface AuthRegistration {
  readonly disposables: readonly Disposable[];
  readonly panel: AuthManagerPanel;
}

const SET_AUTH_SECRET_COMMAND = 'apiRunner.setAuthSecret';

/** Wires Auth Profiles Manager UI into the extension host. */
export function registerAuth(options: RegisterAuthOptions): AuthRegistration {
  const { context, profileManager, secrets } = options;
  const panel = new AuthManagerPanel({ profileManager, secrets });

  const manageCommand = commands.registerCommand(
    COMMAND_IDS.manageAuthProfiles,
    (selectedId?: unknown) => {
      panel.show(
        typeof selectedId === 'string' && selectedId.length > 0
          ? selectedId
          : undefined,
      );
    },
  );

  const setSecretCommand = commands.registerCommand(
    SET_AUTH_SECRET_COMMAND,
    async (profileId?: unknown, field?: unknown) => {
      if (typeof profileId !== 'string' || typeof field !== 'string') {
        return;
      }
      const saved = await promptAndStoreAuthSecret(secrets, profileId, field);
      if (saved) {
        panel.show(profileId);
      }
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
    codeActions,
  ];
  context.subscriptions.push(...disposables);
  return { disposables, panel };
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
        command: SET_AUTH_SECRET_COMMAND,
        arguments: [target.profileId, target.field],
      };
      actions.push(action);

      const manage = new CodeAction(
        'Manage Auth Profiles',
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
  const match = /^Authentication profile "([^"]+)" is missing secret field "([^"]+)"\.$/u
    .exec(diagnostic.message);
  if (match === null) {
    return undefined;
  }
  return { profileId: match[1]!, field: match[2]! };
}
