/**
 * Document shapes for the `.apihero` project store (schemaVersion 1).
 */

import type { AuthenticationProfile, Environment, VariableDefinition } from '../models';

/** Project identity marker — presence of a valid file means project mode. */
export interface ConfigDocument {
  readonly schemaVersion: number;
  readonly projectId: string;
  readonly collectionsDirectory: string;
}

/** Workspace-scoped non-secret variables + recommended active environment. */
export interface WorkspaceDocument {
  readonly schemaVersion: number;
  readonly activeEnvironmentId?: string;
  readonly variables: readonly ProjectStoreVariable[];
}

/** One environment bag on disk (scope omitted; always environment). */
export interface EnvironmentDocument {
  readonly id: string;
  readonly name: string;
  readonly variables: readonly ProjectStoreVariable[];
}

/** Auth profile metadata only — secrets stay in SecretStorage. */
export interface AuthProfilesDocument {
  readonly schemaVersion: number;
  readonly profiles: readonly AuthenticationProfile[];
}

/** Variable row stored under `.apihero` (no scope field on disk). */
export interface ProjectStoreVariable {
  readonly name: string;
  readonly value: string;
  readonly sensitive?: boolean;
}

/**
 * Gitignored overlay for sensitive variable values
 * (`.apihero/local/variables.local.json`).
 */
export interface VariablesLocalDocument {
  readonly schemaVersion: number;
  readonly workspace: Readonly<Record<string, string>>;
  readonly environments: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Settings projection used as migration input (never includes secret values). */
export interface LegacySettingsSnapshot {
  readonly environments: readonly Environment[];
  readonly workspaceVariables: readonly VariableDefinition[];
  readonly activeEnvironmentId?: string;
  readonly authenticationProfiles: readonly AuthenticationProfile[];
}

/** Backup written under `.apihero/local/` before migration content. */
export interface MigrationBackupDocument {
  readonly migratedAt: string;
  readonly source: 'workspace-settings';
  readonly environments: readonly unknown[];
  readonly workspaceVariables: readonly unknown[];
  readonly activeEnvironmentId?: string;
  readonly authenticationProfiles: readonly unknown[];
}

/** In-memory project metadata used by dual-read repositories. */
export interface ProjectMetadataSnapshot {
  readonly environments: readonly Environment[];
  readonly workspaceVariables: readonly VariableDefinition[];
  readonly activeEnvironmentId?: string;
  readonly authenticationProfiles: readonly AuthenticationProfile[];
}

export type MigrationOutcome =
  | { readonly status: 'skipped-already-migrated' }
  | { readonly status: 'skipped-empty' }
  | { readonly status: 'migrated'; readonly projectId: string }
  | { readonly status: 'initialized'; readonly projectId: string };
