/**
 * Registers Command Palette command: API Hero: Reset Workspace...
 */

import {
  commands,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
  type Memento,
} from 'vscode';

import { secretFieldsForProvider } from '../../auth/authentication-profile-validation';
import { SESSION_SECRET_FIELDS } from '../../auth/authentication-session';
import type { AuthenticationSessionStore } from '../../auth/authentication-session';
import type { AuthenticationSecretRepository } from '../../auth/authentication-resolver';
import { AUTHENTICATION_SESSIONS_STATE_KEY } from '../../auth/vscode/register-auth';
import { registerCommandWithLegacyAlias } from '../../commands';
import { COMMAND_IDS } from '../../constants';
import type { Logger } from '../../shared';
import {
  SCENARIO_DIFF_BANNER_DISMISSED_KEY,
  SCENARIO_LAST_RUNS_STATE_KEY,
} from '../../scenarios/vscode/scenario-last-runs';
import { SCENARIOS_VIEW_REVEALED_STATE_KEY } from '../../scenarios/vscode/scenario-view-visibility';
import type { EnvironmentManager } from '../../variables';
import { authProfilesPath, parseAuthProfilesDocument } from '../index';
import type { ProjectStoreFilesystem } from '../ports';
import {
  resetWorkspaceStore,
  type ResetWorkspaceFailure,
} from '../reset-workspace';
import type { ProjectStoreCoordinator } from './project-store-coordinator';

/** WorkspaceState keys cleared by Reset Workspace (never globalState). */
export const RESET_WORKSPACE_STATE_KEYS = [
  AUTHENTICATION_SESSIONS_STATE_KEY,
  SCENARIO_LAST_RUNS_STATE_KEY,
  SCENARIO_DIFF_BANNER_DISMISSED_KEY,
  SCENARIOS_VIEW_REVEALED_STATE_KEY,
  'apiHero.dependencies.ignoredUnknownVariables',
] as const;

export interface RegisterResetWorkspaceOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
  readonly filesystem: ProjectStoreFilesystem;
  readonly secrets: AuthenticationSecretRepository;
  /**
   * Clears request history. Returns whether any entries existed before clear.
   * Missing / empty history should return false without throwing.
   */
  readonly clearHistory: () => Promise<boolean>;
  /** Invalidates project-store in-memory cache after durable wipe. */
  readonly projectStoreCoordinator: ProjectStoreCoordinator;
  /** Clears in-memory auth sessions (workspaceState is cleared separately). */
  readonly authenticationSessions: AuthenticationSessionStore;
  /** Re-reads environment configuration after project-store wipe. */
  readonly environmentManager: EnvironmentManager;
}

/**
 * Contributes `apiHero.resetWorkspace` (+ legacy alias). Command Palette only.
 */
export function registerResetWorkspace(
  options: RegisterResetWorkspaceOptions,
): Disposable {
  const disposable = registerCommandWithLegacyAlias(
    COMMAND_IDS.resetWorkspace,
    async () => {
      await runResetWorkspaceCommand(options);
    },
  );

  options.context.subscriptions.push(disposable);
  return disposable;
}

async function runResetWorkspaceCommand(
  options: RegisterResetWorkspaceOptions,
): Promise<void> {
  const {
    context,
    logger,
    filesystem,
    secrets,
    clearHistory,
    projectStoreCoordinator,
    authenticationSessions,
    environmentManager,
  } = options;

  const folder = workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    void window.showErrorMessage(
      'API Hero: Open a folder workspace to reset the workspace.',
    );
    return;
  }

  const choice = await window.showWarningMessage(
    'Reset API Hero Workspace',
    {
      modal: true,
      detail:
        'This will permanently remove API Hero workspace data for the current workspace.\n\n' +
        'The following will be removed:\n' +
        '• Authentication profiles\n' +
        '• Environments\n' +
        '• Workspace variables\n' +
        '• Local variables\n' +
        '• Scenarios\n' +
        '• Request history (extension-wide)\n' +
        '• Project configuration (.apihero)\n\n' +
        'The following will NOT be removed:\n' +
        '• Collections\n' +
        '• .api request files\n' +
        '• Collection variables\n' +
        '• Project source code',
    },
    'Cancel',
    'Reset Workspace',
  );
  if (choice !== 'Reset Workspace') {
    return;
  }

  const workspaceRootPath = folder.uri.fsPath;
  const failures: ResetWorkspaceFailure[] = [];
  let deletedSomething = false;
  const succeeded: string[] = [];

  const profileIdsResult = await readAuthProfileIds(
    filesystem,
    workspaceRootPath,
  );
  if (profileIdsResult.failure !== undefined) {
    failures.push(profileIdsResult.failure);
  }
  const secretsResult = await clearAuthSecretsForProfiles(
    secrets,
    profileIdsResult.ids,
  );
  failures.push(...secretsResult.failures);
  if (secretsResult.clearedSomething) {
    deletedSomething = true;
    succeeded.push('auth secrets');
  }

  const storeResult = await resetWorkspaceStore(workspaceRootPath, filesystem);
  failures.push(...storeResult.failures);
  if (storeResult.deletedSomething) {
    deletedSomething = true;
    succeeded.push('project store / legacy scenarios');
  }

  try {
    const historyCleared = await clearHistory();
    if (historyCleared) {
      deletedSomething = true;
      succeeded.push('request history');
    }
  } catch (error: unknown) {
    failures.push({
      component: 'history',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const stateCleared = await clearWorkspaceStateKeys(context.workspaceState);
    if (stateCleared) {
      deletedSomething = true;
      succeeded.push('workspace state');
    }
  } catch (error: unknown) {
    failures.push({
      component: 'workspace-state',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  await invalidateInMemoryStateBestEffort({
    logger,
    workspaceRootPath,
    projectStoreCoordinator,
    authenticationSessions,
    environmentManager,
  });

  await refreshUiBestEffort(logger);

  if (failures.length > 0) {
    const failedSummary = failures
      .map((entry) => `${entry.component}: ${entry.message}`)
      .join('; ');
    const successSummary =
      succeeded.length > 0
        ? ` Succeeded: ${succeeded.join(', ')}.`
        : '';
    logger.warning('Reset Workspace completed with partial failures', {
      failures: failedSummary,
      succeeded,
    });
    void window.showWarningMessage(
      `API Hero workspace reset completed with issues. Failed: ${failedSummary}.${successSummary}`,
    );
    return;
  }

  if (deletedSomething) {
    void window.showInformationMessage('API Hero workspace has been reset.');
    return;
  }

  void window.showInformationMessage('API Hero workspace is already clean.');
}

async function readAuthProfileIds(
  filesystem: ProjectStoreFilesystem,
  workspaceRootPath: string,
): Promise<{
  readonly ids: readonly string[];
  readonly failure?: ResetWorkspaceFailure;
}> {
  const path = authProfilesPath(workspaceRootPath);
  try {
    if (!(await filesystem.exists(path))) {
      return { ids: [] };
    }
  } catch (error: unknown) {
    return {
      ids: [],
      failure: {
        component: 'auth-profiles',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  try {
    const text = await filesystem.readText(path);
    const document = parseAuthProfilesDocument(text);
    if (document === undefined) {
      return {
        ids: [],
        failure: {
          component: 'auth-profiles',
          message: 'Failed to parse authentication profiles',
        },
      };
    }
    return {
      ids: document.profiles
        .map((profile) => profile.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    };
  } catch (error: unknown) {
    return {
      ids: [],
      failure: {
        component: 'auth-profiles',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function clearAuthSecretsForProfiles(
  secrets: AuthenticationSecretRepository,
  profileIds: readonly string[],
): Promise<{
  readonly clearedSomething: boolean;
  readonly failures: readonly ResetWorkspaceFailure[];
}> {
  const failures: ResetWorkspaceFailure[] = [];
  let clearedSomething = false;
  const fields = secretFieldsForWorkspaceReset();

  for (const profileId of profileIds) {
    for (const field of fields) {
      try {
        const existing = await secrets.get(profileId, field);
        await secrets.delete(profileId, field);
        if (existing !== undefined) {
          clearedSomething = true;
        }
      } catch (error: unknown) {
        failures.push({
          component: 'auth-secrets',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { clearedSomething, failures };
}

function secretFieldsForWorkspaceReset(): readonly string[] {
  const fields = new Set<string>();
  for (const providerId of ['basic', 'bearer', 'apiKey'] as const) {
    for (const entry of secretFieldsForProvider(providerId)) {
      fields.add(entry.field);
    }
  }
  for (const field of Object.values(SESSION_SECRET_FIELDS)) {
    fields.add(field);
  }
  return [...fields];
}

async function clearWorkspaceStateKeys(workspaceState: Memento): Promise<boolean> {
  let clearedSomething = false;
  for (const key of RESET_WORKSPACE_STATE_KEYS) {
    const previous = workspaceState.get(key);
    if (previous !== undefined) {
      clearedSomething = true;
    }
    await workspaceState.update(key, undefined);
  }
  return clearedSomething;
}

async function invalidateInMemoryStateBestEffort(options: {
  readonly logger: Logger;
  readonly workspaceRootPath: string;
  readonly projectStoreCoordinator: ProjectStoreCoordinator;
  readonly authenticationSessions: AuthenticationSessionStore;
  readonly environmentManager: EnvironmentManager;
}): Promise<void> {
  const {
    logger,
    workspaceRootPath,
    projectStoreCoordinator,
    authenticationSessions,
    environmentManager,
  } = options;

  try {
    await projectStoreCoordinator.refreshCache(workspaceRootPath);
  } catch (error: unknown) {
    logger.warning('Reset Workspace project-store cache refresh failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    authenticationSessions.replaceAll([]);
  } catch (error: unknown) {
    logger.warning('Reset Workspace in-memory session clear failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    environmentManager.refresh();
  } catch (error: unknown) {
    logger.warning('Reset Workspace environment refresh failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function refreshUiBestEffort(logger: Logger): Promise<void> {
  for (const commandId of [
    COMMAND_IDS.refreshCollections,
    COMMAND_IDS.refreshHistory,
    COMMAND_IDS.refreshScenarios,
  ] as const) {
    try {
      await commands.executeCommand(commandId);
    } catch (error: unknown) {
      logger.warning('Reset Workspace UI refresh failed', {
        commandId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
