/**
 * Runtime coordinator for project-store dual-read / dual-write.
 * Keeps an in-memory cache so sync VS Code repositories can prefer files.
 */

import type { AuthenticationProfile, Environment, VariableDefinition } from '../../models';
import type { Logger } from '../../shared';
import type { SecretStore } from '../../storage/stores';
import { ProjectStoreService } from '../project-store-service';
import { collectAuthLiteralSecrets } from '../serialize';
import type { ProjectMetadataSnapshot } from '../types';
import type { ProjectStoreFilesystem } from '../ports';
import { promoteAuthLiteralsToSecretStorage } from './promote-auth-literals';

export interface ProjectStoreChangeDisposable {
  dispose(): void;
}

export class ProjectStoreCoordinator {
  private readonly service: ProjectStoreService;
  private readonly cache = new Map<string, ProjectMetadataSnapshot>();
  private readonly listeners = new Set<() => void>();
  private readonly logger: Logger;
  private readonly secretStore: SecretStore | undefined;

  public constructor(
    filesystem: ProjectStoreFilesystem,
    logger: Logger,
    secretStore?: SecretStore,
  ) {
    this.logger = logger;
    this.secretStore = secretStore;
    this.service = new ProjectStoreService({
      filesystem,
      onWarning: (message, context) => {
        logger.warning(message, context);
      },
    });
  }

  public getService(): ProjectStoreService {
    return this.service;
  }

  /** Sync dual-read: cached project metadata for a workspace folder. */
  public getCached(workspaceRootPath: string): ProjectMetadataSnapshot | undefined {
    return this.cache.get(normalizeRoot(workspaceRootPath));
  }

  public onDidChange(listener: () => void): ProjectStoreChangeDisposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  public async refreshCache(workspaceRootPath: string): Promise<void> {
    const key = normalizeRoot(workspaceRootPath);
    const before = this.cache.get(key);
    const snapshot = await this.service.readProjectMetadata(workspaceRootPath);
    if (snapshot === undefined) {
      if (before !== undefined) {
        this.cache.delete(key);
        this.notify();
      }
      return;
    }
    this.cache.set(key, snapshot);
    this.notify();
  }

  public async migrateFolder(options: {
    readonly workspaceRootPath: string;
    readonly settings: Parameters<ProjectStoreService['migrateIfNeeded']>[0]['settings'];
    readonly allowSettingsMigration: boolean;
  }): Promise<void> {
    // Promote literals before any tracked auth / config.json write so a
    // failed SecretStorage set aborts migration with settings still intact.
    if (options.allowSettingsMigration) {
      await this.promoteLiterals(options.settings.authenticationProfiles);
    }
    const result = await this.service.migrateIfNeeded(options);
    if (
      result.outcome.status === 'migrated' ||
      result.outcome.status === 'initialized'
    ) {
      this.logger.info('Project store ready', {
        workspaceRootPath: options.workspaceRootPath,
        status: result.outcome.status,
        backupWritten: result.backupWritten,
      });
    }
    await this.refreshCache(options.workspaceRootPath);
  }

  /**
   * Force-initializes a minimal store on the given folder without cloning
   * workspace settings (even when a settings snapshot is passed).
   */
  public async ensureInitialized(
    workspaceRootPath: string,
    settings?: Parameters<ProjectStoreService['migrateIfNeeded']>[0]['settings'],
  ): Promise<void> {
    await this.service.ensureInitialized(workspaceRootPath, settings);
    await this.refreshCache(workspaceRootPath);
  }

  public async writeEnvironments(
    workspaceRootPath: string,
    environments: readonly Environment[],
  ): Promise<void> {
    await this.ensureInitialized(workspaceRootPath);
    await this.service.writeEnvironments(workspaceRootPath, environments);
    await this.refreshCache(workspaceRootPath);
  }

  public async writeWorkspaceDocument(
    workspaceRootPath: string,
    input: {
      readonly variables: readonly VariableDefinition[];
      readonly activeEnvironmentId?: string;
    },
  ): Promise<void> {
    await this.ensureInitialized(workspaceRootPath);
    await this.service.writeWorkspaceDocument(workspaceRootPath, input);
    await this.refreshCache(workspaceRootPath);
  }

  public async writeAuthProfiles(
    workspaceRootPath: string,
    profiles: readonly AuthenticationProfile[],
  ): Promise<void> {
    await this.promoteLiterals(profiles);
    await this.ensureInitialized(workspaceRootPath);
    await this.service.writeAuthProfiles(workspaceRootPath, profiles);
    await this.refreshCache(workspaceRootPath);
  }

  public async writeProjectMetadata(
    workspaceRootPath: string,
    snapshot: {
      readonly environments: readonly Environment[];
      readonly workspaceVariables: readonly VariableDefinition[];
      readonly activeEnvironmentId?: string;
      readonly authenticationProfiles?: readonly AuthenticationProfile[];
    },
  ): Promise<void> {
    if (snapshot.authenticationProfiles !== undefined) {
      await this.promoteLiterals(snapshot.authenticationProfiles);
    }
    await this.ensureInitialized(workspaceRootPath);
    await this.service.writeProjectMetadata(workspaceRootPath, snapshot);
    await this.refreshCache(workspaceRootPath);
  }

  public async writeActiveEnvironmentId(
    workspaceRootPath: string,
    activeEnvironmentId: string | undefined,
  ): Promise<void> {
    await this.ensureInitialized(workspaceRootPath);
    await this.service.writeActiveEnvironmentId(
      workspaceRootPath,
      activeEnvironmentId,
    );
    await this.refreshCache(workspaceRootPath);
  }

  public isProjectMode(workspaceRootPath: string): boolean {
    return this.cache.has(normalizeRoot(workspaceRootPath));
  }

  private async promoteLiterals(
    profiles: readonly AuthenticationProfile[],
  ): Promise<void> {
    if (profiles.length === 0) {
      return;
    }
    if (this.secretStore === undefined) {
      if (collectAuthLiteralSecrets(profiles).length > 0) {
        throw new Error(
          'Cannot promote auth literals: SecretStorage is not available',
        );
      }
      return;
    }
    try {
      await promoteAuthLiteralsToSecretStorage(profiles, this.secretStore);
    } catch (error) {
      this.logger.error(
        'Auth literal promotion failed; aborting project-store auth write',
        error,
      );
      throw error;
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function normalizeRoot(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

let activeCoordinator: ProjectStoreCoordinator | undefined;

export function setActiveProjectStoreCoordinator(
  coordinator: ProjectStoreCoordinator | undefined,
): void {
  activeCoordinator = coordinator;
}

export function getActiveProjectStoreCoordinator():
  | ProjectStoreCoordinator
  | undefined {
  return activeCoordinator;
}

