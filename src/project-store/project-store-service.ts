/**
 * High-level project store operations used by VS Code wiring and dual-write.
 * Domain-only — no `vscode` imports.
 */

import { randomUUID } from 'node:crypto';

import type { AuthenticationProfile, Environment, VariableDefinition } from '../models';
import { joinPathKey } from '../collections/models';
import { ENVIRONMENTS_DIRECTORY_NAME } from './constants';
import { ensureProjectStoreGitignore } from './ensure-gitignore';
import {
  migrateIfNeeded,
  type MigrateIfNeededResult,
} from './migrate';
import {
  parseAuthProfilesDocument,
  parseConfigDocument,
  parseEnvironmentDocument,
  parseWorkspaceDocument,
} from './parse';
import {
  authDirectoryPath,
  authProfilesPath,
  configPath,
  environmentDocumentPath,
  environmentsDirectoryPath,
  localDirectoryPath,
  projectStoreRootPath,
  sanitizeEnvironmentFileStem,
  workspaceDocumentPath,
} from './paths';
import type { ProjectStoreFilesystem } from './ports';
import {
  serializeJson,
  toAuthProfilesDocument,
  toEnvironmentDocument,
  toWorkspaceDocument,
} from './serialize';
import type {
  LegacySettingsSnapshot,
  ProjectMetadataSnapshot,
} from './types';
import {
  emptyVariablesLocalDocument,
  environmentsSensitiveOverlay,
  mergeEnvironmentVariablesWithOverlay,
  mergeWorkspaceVariablesWithOverlay,
  readVariablesLocalOverlay,
  workspaceSensitiveOverlay,
  writeVariablesLocalOverlay,
} from './variables-local';

export interface ProjectStoreServiceOptions {
  readonly filesystem: ProjectStoreFilesystem;
  readonly createProjectId?: () => string;
  readonly onWarning?: (message: string, context?: Record<string, unknown>) => void;
}

export class ProjectStoreService {
  private readonly filesystem: ProjectStoreFilesystem;
  private readonly createProjectId: () => string;
  private readonly onWarning: (
    message: string,
    context?: Record<string, unknown>,
  ) => void;

  public constructor(options: ProjectStoreServiceOptions) {
    this.filesystem = options.filesystem;
    this.createProjectId = options.createProjectId ?? (() => randomUUID());
    this.onWarning = options.onWarning ?? (() => undefined);
  }

  public async hasProjectStore(workspaceRootPath: string): Promise<boolean> {
    const path = configPath(workspaceRootPath);
    if (!(await this.filesystem.exists(path))) {
      return false;
    }
    try {
      const text = await this.filesystem.readText(path);
      return parseConfigDocument(text) !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Creates a minimal `.apihero` tree when missing.
   * Idempotent when `config.json` already exists.
   *
   * Never clones workspace settings — `allowSettingsMigration` is always false.
   * Settings seeding belongs to `migrateIfNeeded` with the primary-folder allow
   * flag (or an explicit primary initialize path that calls migrate).
   */
  public async ensureInitialized(
    workspaceRootPath: string,
    settings?: LegacySettingsSnapshot,
  ): Promise<MigrateIfNeededResult> {
    // `settings` is intentionally ignored — never clone workspace settings here.
    void settings;
    return migrateIfNeeded({
      filesystem: this.filesystem,
      workspaceRootPath,
      settings: emptySettings(),
      allowSettingsMigration: false,
      forceInitialize: true,
      createProjectId: this.createProjectId,
    });
  }

  /**
   * Migrates legacy settings / Collections presence into `.apihero` when needed.
   */
  public async migrateIfNeeded(options: {
    readonly workspaceRootPath: string;
    readonly settings: LegacySettingsSnapshot;
    readonly allowSettingsMigration: boolean;
  }): Promise<MigrateIfNeededResult> {
    return migrateIfNeeded({
      filesystem: this.filesystem,
      workspaceRootPath: options.workspaceRootPath,
      settings: options.settings,
      allowSettingsMigration: options.allowSettingsMigration,
      createProjectId: this.createProjectId,
    });
  }

  public async readProjectMetadata(
    workspaceRootPath: string,
  ): Promise<ProjectMetadataSnapshot | undefined> {
    if (!(await this.hasProjectStore(workspaceRootPath))) {
      return undefined;
    }

    try {
      const [environments, workspace, profiles] = await Promise.all([
        this.readEnvironments(workspaceRootPath),
        this.readWorkspaceDocument(workspaceRootPath),
        this.readAuthProfiles(workspaceRootPath),
      ]);

      if (environments === undefined || workspace === undefined) {
        this.onWarning('Project store documents unreadable; falling back to settings', {
          workspaceRootPath,
        });
        return undefined;
      }

      return {
        environments,
        workspaceVariables: workspace.variables.map((variable) => ({
          name: variable.name,
          value: variable.value,
          sensitive: variable.sensitive === true,
          scope: 'workspace' as const,
        })),
        ...(workspace.activeEnvironmentId === undefined
          ? {}
          : { activeEnvironmentId: workspace.activeEnvironmentId }),
        authenticationProfiles: profiles ?? [],
      };
    } catch (error) {
      this.onWarning('Failed to read project store; falling back to settings', {
        workspaceRootPath,
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  public async readEnvironments(
    workspaceRootPath: string,
  ): Promise<readonly Environment[] | undefined> {
    const directory = environmentsDirectoryPath(workspaceRootPath);
    if (!(await this.filesystem.exists(directory))) {
      return [];
    }
    try {
      const overlay = await readVariablesLocalOverlay(
        this.filesystem,
        workspaceRootPath,
      );
      const entries = await this.filesystem.readDirectory(directory);
      const environments: Environment[] = [];
      for (const entry of entries) {
        if (entry.type !== 'file' || !entry.name.endsWith('.json')) {
          continue;
        }
        const text = await this.filesystem.readText(
          joinPathKey(directory, entry.name),
        );
        const document = parseEnvironmentDocument(text);
        if (document === undefined) {
          this.onWarning('Skipping unreadable environment document', {
            workspaceRootPath,
            fileName: entry.name,
          });
          continue;
        }
        const mergedVariables = mergeEnvironmentVariablesWithOverlay(
          document.variables,
          overlay.environments[document.id],
        );
        environments.push({
          id: document.id,
          name: document.name,
          variables: mergedVariables.map((variable) => ({
            name: variable.name,
            value: variable.value,
            sensitive: variable.sensitive === true,
            scope: 'environment' as const,
          })),
        });
      }
      return environments;
    } catch (error) {
      this.onWarning('Failed to read environments directory', {
        workspaceRootPath,
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  public async readWorkspaceDocument(
    workspaceRootPath: string,
  ): Promise<
    | {
        readonly activeEnvironmentId?: string;
        readonly variables: readonly {
          readonly name: string;
          readonly value: string;
          readonly sensitive?: boolean;
        }[];
      }
    | undefined
  > {
    const path = workspaceDocumentPath(workspaceRootPath);
    if (!(await this.filesystem.exists(path))) {
      return { variables: [] };
    }
    try {
      const document = parseWorkspaceDocument(
        await this.filesystem.readText(path),
      );
      if (document === undefined) {
        return undefined;
      }
      const overlay = await readVariablesLocalOverlay(
        this.filesystem,
        workspaceRootPath,
      );
      return {
        ...(document.activeEnvironmentId === undefined
          ? {}
          : { activeEnvironmentId: document.activeEnvironmentId }),
        variables: mergeWorkspaceVariablesWithOverlay(
          document.variables,
          overlay.workspace,
        ),
      };
    } catch (error) {
      this.onWarning('Failed to read workspace.json', {
        workspaceRootPath,
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  public async readAuthProfiles(
    workspaceRootPath: string,
  ): Promise<readonly AuthenticationProfile[] | undefined> {
    const path = authProfilesPath(workspaceRootPath);
    if (!(await this.filesystem.exists(path))) {
      return [];
    }
    try {
      const document = parseAuthProfilesDocument(
        await this.filesystem.readText(path),
      );
      return document?.profiles ?? [];
    } catch (error) {
      this.onWarning('Failed to read auth/profiles.json', {
        workspaceRootPath,
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Atomically replaces the live `environments/` directory.
   * Writes + validates staging first; never deletes live until staging is ready.
   */
  public async writeEnvironments(
    workspaceRootPath: string,
    environments: readonly Environment[],
  ): Promise<void> {
    await this.ensureInitialized(workspaceRootPath);

    const stagingId = randomUUID();
    const storeRoot = projectStoreRootPath(workspaceRootPath);
    const liveDir = environmentsDirectoryPath(workspaceRootPath);
    const stagingDir = joinPathKey(
      storeRoot,
      `${ENVIRONMENTS_DIRECTORY_NAME}.staging-${stagingId}`,
    );
    const bakDir = joinPathKey(
      storeRoot,
      `${ENVIRONMENTS_DIRECTORY_NAME}.bak-${stagingId}`,
    );

    const plannedFiles = planEnvironmentFiles(workspaceRootPath, environments);

    try {
      await this.filesystem.createDirectory(storeRoot);
      await this.filesystem.createDirectory(stagingDir);

      for (const planned of plannedFiles) {
        const stagingPath = joinPathKey(stagingDir, planned.fileName);
        await this.filesystem.writeText(stagingPath, planned.content);
      }

      // Validate staging by reading back + parsing before touching live.
      for (const planned of plannedFiles) {
        const stagingPath = joinPathKey(stagingDir, planned.fileName);
        const text = await this.filesystem.readText(stagingPath);
        if (parseEnvironmentDocument(text) === undefined) {
          throw new Error(
            `Invalid environment document after staging write: ${planned.fileName}`,
          );
        }
      }

      const liveExists = await this.filesystem.exists(liveDir);
      if (liveExists) {
        await this.filesystem.rename(liveDir, bakDir);
      }
      await this.filesystem.rename(stagingDir, liveDir);

      // Write overlay while bak still exists so overlay failure can roll back.
      const existingOverlay = await readVariablesLocalOverlay(
        this.filesystem,
        workspaceRootPath,
      );
      await writeVariablesLocalOverlay(this.filesystem, workspaceRootPath, {
        ...emptyVariablesLocalDocument(),
        schemaVersion: existingOverlay.schemaVersion,
        workspace: existingOverlay.workspace,
        environments: environmentsSensitiveOverlay(environments),
      });

      if (liveExists) {
        await this.filesystem.delete(bakDir, { recursive: true });
      }
    } catch (error) {
      await this.rollbackEnvironmentWrite(liveDir, bakDir, stagingDir);
      throw error;
    }
  }

  public async writeWorkspaceDocument(
    workspaceRootPath: string,
    input: {
      readonly variables: readonly VariableDefinition[];
      readonly activeEnvironmentId?: string;
    },
  ): Promise<void> {
    await this.ensureInitialized(workspaceRootPath);
    await this.filesystem.writeText(
      workspaceDocumentPath(workspaceRootPath),
      serializeJson(
        toWorkspaceDocument(input.variables, input.activeEnvironmentId),
      ),
    );
    const existingOverlay = await readVariablesLocalOverlay(
      this.filesystem,
      workspaceRootPath,
    );
    await writeVariablesLocalOverlay(this.filesystem, workspaceRootPath, {
      ...emptyVariablesLocalDocument(),
      schemaVersion: existingOverlay.schemaVersion,
      workspace: workspaceSensitiveOverlay(input.variables),
      environments: existingOverlay.environments,
    });
  }

  public async writeActiveEnvironmentId(
    workspaceRootPath: string,
    activeEnvironmentId: string | undefined,
    workspaceVariables?: readonly VariableDefinition[],
  ): Promise<void> {
    await this.ensureInitialized(workspaceRootPath);
    const existing = await this.readWorkspaceDocument(workspaceRootPath);
    const variables =
      workspaceVariables ??
      (existing?.variables ?? []).map((variable) => ({
        name: variable.name,
        value: variable.value,
        sensitive: variable.sensitive === true,
        scope: 'workspace' as const,
      }));
    await this.writeWorkspaceDocument(workspaceRootPath, {
      variables,
      activeEnvironmentId,
    });
  }

  public async writeAuthProfiles(
    workspaceRootPath: string,
    profiles: readonly AuthenticationProfile[],
  ): Promise<void> {
    await this.ensureInitialized(workspaceRootPath);
    await this.filesystem.createDirectory(authDirectoryPath(workspaceRootPath));
    await this.filesystem.createDirectory(localDirectoryPath(workspaceRootPath));
    await this.filesystem.writeText(
      authProfilesPath(workspaceRootPath),
      serializeJson(toAuthProfilesDocument(profiles)),
    );
  }

  /** Writes full project metadata (env manager / openapi patch). */
  public async writeProjectMetadata(
    workspaceRootPath: string,
    snapshot: {
      readonly environments: readonly Environment[];
      readonly workspaceVariables: readonly VariableDefinition[];
      readonly activeEnvironmentId?: string;
      readonly authenticationProfiles?: readonly AuthenticationProfile[];
    },
  ): Promise<void> {
    await this.ensureInitialized(workspaceRootPath);
    await this.writeEnvironments(workspaceRootPath, snapshot.environments);
    await this.writeWorkspaceDocument(workspaceRootPath, {
      variables: snapshot.workspaceVariables,
      activeEnvironmentId: snapshot.activeEnvironmentId,
    });
    if (snapshot.authenticationProfiles !== undefined) {
      await this.writeAuthProfiles(
        workspaceRootPath,
        snapshot.authenticationProfiles,
      );
    }
    await ensureProjectStoreGitignore(this.filesystem, workspaceRootPath);
  }

  private async rollbackEnvironmentWrite(
    liveDir: string,
    bakDir: string,
    stagingDir: string,
  ): Promise<void> {
    try {
      const liveExists = await this.filesystem.exists(liveDir);
      const bakExists = await this.filesystem.exists(bakDir);
      if (!liveExists && bakExists) {
        await this.filesystem.rename(bakDir, liveDir);
      }
    } catch (rollbackError) {
      this.onWarning('Failed to roll back environments directory after write error', {
        liveDir,
        bakDir,
        message:
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError),
      });
    }
    try {
      if (await this.filesystem.exists(stagingDir)) {
        await this.filesystem.delete(stagingDir, { recursive: true });
      }
    } catch {
      // Best-effort cleanup of leftover staging.
    }
  }
}

export { hasMigratableSettings } from './migrate';

function emptySettings(): LegacySettingsSnapshot {
  return {
    environments: [],
    workspaceVariables: [],
    authenticationProfiles: [],
  };
}

function allocateUniqueStem(id: string, used: ReadonlySet<string>): string {
  const base = sanitizeEnvironmentFileStem(id);
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  while (used.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

function planEnvironmentFiles(
  workspaceRootPath: string,
  environments: readonly Environment[],
): readonly {
  readonly fileName: string;
  readonly content: string;
}[] {
  const usedStems = new Set<string>();
  const planned: { readonly fileName: string; readonly content: string }[] = [];
  for (const environment of environments) {
    const stem = allocateUniqueStem(environment.id, usedStems);
    usedStems.add(stem);
    const livePath =
      stem === sanitizeEnvironmentFileStem(environment.id)
        ? environmentDocumentPath(workspaceRootPath, environment.id)
        : joinPathKey(
            environmentsDirectoryPath(workspaceRootPath),
            `${stem}.json`,
          );
    const fileName = livePath.slice(livePath.lastIndexOf('/') + 1);
    planned.push({
      fileName,
      content: serializeJson(toEnvironmentDocument(environment)),
    });
  }
  return planned;
}
