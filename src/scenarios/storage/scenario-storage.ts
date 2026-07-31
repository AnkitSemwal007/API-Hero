import type { Scenario } from '../models';
import { serializeScenario } from '../serialization/scenario-serializer';
import { parseScenarioDocument } from '../schema';
import {
  SCENARIOS_DIRECTORY_NAME,
  scenariosDirectoryPath,
} from '../../project-store';
import { joinPathKey } from '../../collections/models';

import fs from 'node:fs';
import { promises as defaultFs } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import path from 'node:path';

/** Relative segment under `.apihero` for scenario documents (project-store). */
export { SCENARIOS_DIRECTORY_NAME };

/**
 * Legacy workspace-relative scenarios root (pre-consolidation).
 * Used only for one-time transparent migration into `.apihero/scenarios`.
 */
export const LEGACY_SCENARIOS_DIRECTORY_NAME = '.api-hero/scenarios';

export type ScenarioLoadResult =
  | { readonly ok: true; readonly scenario: Scenario }
  | { readonly ok: false; readonly error: ScenarioStorageError };

export type ScenarioSaveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ScenarioStorageError };

export type ScenarioDiscoverResult =
  | { readonly ok: true; readonly scenarios: readonly Scenario[]; readonly files: readonly string[] }
  | {
      readonly ok: false;
      readonly error: ScenarioStorageError;
      readonly files: readonly string[];
    };

export interface ScenarioStorageError {
  readonly code:
    | 'FILE_NOT_FOUND'
    | 'READ_FAILED'
    | 'PARSE_FAILED'
    | 'INVALID_SCHEMA_VERSION'
    | 'INVALID_DOCUMENT'
    | 'WRITE_FAILED';
  readonly filePath: string;
  readonly message: string;
  readonly cause?: unknown;
}

export interface ScenarioStorageOptions {
  readonly now?: () => number;
}

export type ScenarioMigrationStatus =
  | 'NoMigrationNeeded'
  | 'MigrationSucceeded'
  | 'MigrationSucceededWithConflicts'
  | 'MigrationPartiallySucceeded'
  | 'MigrationFailed';

export interface ScenarioMigrationFailure {
  readonly filePath: string;
  readonly message: string;
  readonly cause?: unknown;
}

export interface ScenarioMigrationResult {
  readonly status: ScenarioMigrationStatus;
  readonly canonicalRoot: string;
  readonly legacyRoot: string;
  /** Absolute paths successfully moved (or identical-legacy-removed). */
  readonly migratedFiles: readonly string[];
  /** Relative paths (posix) where differing dest already existed — legacy kept. */
  readonly conflictFiles: readonly string[];
  readonly failedFiles: readonly ScenarioMigrationFailure[];
  /**
   * Roots the caller MUST scan for discovery.
   * Always includes canonicalRoot.
   * Also includes legacyRoot when any legacy *.scenario.json remain
   * (conflicts, partial failure, or total failure).
   */
  readonly discoveryRoots: readonly string[];
}

/** Outcome of a single-file migration attempt (non-throwing paths). */
export type ScenarioMigrateOneOutcome =
  | 'moved'
  | 'identical_removed'
  | 'conflict_kept';

/** Minimal FS surface used by migration (defaults to `fs.promises`). */
export interface ScenarioStorageFs {
  readonly stat: (filePath: string) => Promise<Stats>;
  readonly readdir: (
    dirPath: string,
    options: { withFileTypes: true },
  ) => Promise<Dirent[]>;
  readonly mkdir: (
    dirPath: string,
    options: { recursive: true },
  ) => Promise<string | undefined>;
  readonly rename: (src: string, dest: string) => Promise<void>;
  readonly copyFile: (src: string, dest: string, mode?: number) => Promise<void>;
  readonly unlink: (filePath: string) => Promise<void>;
  readonly rmdir: (dirPath: string) => Promise<void>;
  readonly readFile: (filePath: string) => Promise<Buffer>;
  readonly open: (
    filePath: string,
    flags: string,
  ) => Promise<{ close: () => Promise<void> }>;
  readonly access: (filePath: string) => Promise<void>;
}

export interface ScenarioMigrationOptions {
  readonly fs?: ScenarioStorageFs;
  /** Defaults to `fs.constants.COPYFILE_EXCL`. */
  readonly copyFileExcl?: number;
}

function error(
  filePath: string,
  code: ScenarioStorageError['code'],
  message: string,
  cause?: unknown,
): ScenarioStorageError {
  return { filePath, code, message, cause };
}

function errnoCode(cause: unknown): string | undefined {
  return cause instanceof Error
    ? (cause as NodeJS.ErrnoException).code
    : undefined;
}

function defaultMigrationFs(): ScenarioStorageFs {
  return {
    stat: (p) => defaultFs.stat(p),
    readdir: (p, o) => defaultFs.readdir(p, o),
    mkdir: (p, o) => defaultFs.mkdir(p, o),
    rename: (s, d) => defaultFs.rename(s, d),
    copyFile: (s, d, m) =>
      m === undefined ? defaultFs.copyFile(s, d) : defaultFs.copyFile(s, d, m),
    unlink: (p) => defaultFs.unlink(p),
    rmdir: (p) => defaultFs.rmdir(p),
    readFile: (p) => defaultFs.readFile(p) as Promise<Buffer>,
    open: (p, flags) => defaultFs.open(p, flags),
    access: (p) => defaultFs.access(p),
  };
}

/**
 * Resolves the canonical workspace scenarios root (`.apihero/scenarios`).
 * Scenarios-facing alias of {@link scenariosDirectoryPath}; must not diverge.
 */
export function scenariosRootPath(workspaceFolderPath: string): string {
  return scenariosDirectoryPath(workspaceFolderPath);
}

/** Resolves the legacy `.api-hero/scenarios` root (migration only). */
export function legacyScenariosRootPath(workspaceFolderPath: string): string {
  return joinPathKey(workspaceFolderPath, LEGACY_SCENARIOS_DIRECTORY_NAME);
}

function migrationResult(params: {
  status: ScenarioMigrationStatus;
  canonicalRoot: string;
  legacyRoot: string;
  migratedFiles?: readonly string[];
  conflictFiles?: readonly string[];
  failedFiles?: readonly ScenarioMigrationFailure[];
  discoveryRoots: readonly string[];
}): ScenarioMigrationResult {
  return {
    status: params.status,
    canonicalRoot: params.canonicalRoot,
    legacyRoot: params.legacyRoot,
    migratedFiles: params.migratedFiles ?? [],
    conflictFiles: params.conflictFiles ?? [],
    failedFiles: params.failedFiles ?? [],
    discoveryRoots: params.discoveryRoots,
  };
}

/**
 * Migrates scenario files from `.api-hero/scenarios` into `.apihero/scenarios`
 * when needed, then returns the canonical root for NEW creates plus the
 * migration result (including discovery roots). Idempotent; does not create
 * the canonical directory when empty (lazy mkdir on save).
 */
export async function ensureScenariosRoot(
  workspaceFolderPath: string,
  options?: ScenarioMigrationOptions,
): Promise<{ readonly root: string; readonly migration: ScenarioMigrationResult }> {
  const migration = await migrateLegacyScenariosIfNeeded(
    workspaceFolderPath,
    options,
  );
  return { root: scenariosRootPath(workspaceFolderPath), migration };
}

/**
 * One-time transparent migration from `.api-hero/scenarios` → `.apihero/scenarios`.
 *
 * Prefer canonical when both sides have the same relative filename.
 * Never overwrite a non-identical canonical file; leave the legacy copy in place.
 * Corrupted / invalid JSON is still moved as raw bytes (discovery skips on load).
 * Failures are reported — legacy files are never silently hidden.
 */
export async function migrateLegacyScenariosIfNeeded(
  workspaceFolderPath: string,
  options?: ScenarioMigrationOptions,
): Promise<ScenarioMigrationResult> {
  const io = options?.fs ?? defaultMigrationFs();
  const copyFileExcl = options?.copyFileExcl ?? fs.constants.COPYFILE_EXCL;
  const legacyRoot = legacyScenariosRootPath(workspaceFolderPath);
  const canonicalRoot = scenariosRootPath(workspaceFolderPath);

  let legacyStat: Stats;
  try {
    legacyStat = await io.stat(legacyRoot);
  } catch {
    return migrationResult({
      status: 'NoMigrationNeeded',
      canonicalRoot,
      legacyRoot,
      discoveryRoots: [canonicalRoot],
    });
  }
  if (!legacyStat.isDirectory()) {
    return migrationResult({
      status: 'NoMigrationNeeded',
      canonicalRoot,
      legacyRoot,
      discoveryRoots: [canonicalRoot],
    });
  }

  const files = await discoverScenarioFiles(legacyRoot, io);
  const migratedFiles: string[] = [];
  const conflictFiles: string[] = [];
  const failedFiles: ScenarioMigrationFailure[] = [];

  for (const src of files) {
    const relative = path.relative(legacyRoot, src).replace(/\\/g, '/');
    const dest = joinPathKey(canonicalRoot, relative);
    try {
      const outcome = await migrateOneScenarioFile(src, dest, io, copyFileExcl);
      if (outcome === 'conflict_kept') {
        conflictFiles.push(relative);
      } else {
        // moved or identical_removed — dest is the surviving canonical path
        migratedFiles.push(dest);
      }
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Scenario migration failed.';
      failedFiles.push({ filePath: src, message, cause });
    }
  }

  await removeEmptyDirsUnder(legacyRoot, io);
  await tryRemoveEmptyDir(legacyRoot, io);
  await tryRemoveEmptyDir(path.dirname(legacyRoot), io);

  const remainingLegacy = await discoverScenarioFiles(legacyRoot, io);
  // Always keep legacy in discoveryRoots when we know leftovers or when
  // rediscovery might miss files (readdir errors return []).
  const includeLegacy =
    remainingLegacy.length > 0 ||
    conflictFiles.length > 0 ||
    failedFiles.length > 0;
  const discoveryRoots: string[] = includeLegacy
    ? [canonicalRoot, legacyRoot]
    : [canonicalRoot];

  const status = resolveMigrationStatus({
    filesAttempted: files.length,
    migratedCount: migratedFiles.length,
    conflictCount: conflictFiles.length,
    failureCount: failedFiles.length,
  });

  return migrationResult({
    status,
    canonicalRoot,
    legacyRoot,
    migratedFiles,
    conflictFiles,
    failedFiles,
    discoveryRoots,
  });
}

function resolveMigrationStatus(counts: {
  filesAttempted: number;
  migratedCount: number;
  conflictCount: number;
  failureCount: number;
}): ScenarioMigrationStatus {
  const { filesAttempted, migratedCount, conflictCount, failureCount } = counts;

  // Empty legacy dir existed and was cleaned (or had nothing to move).
  if (filesAttempted === 0) {
    return 'MigrationSucceeded';
  }

  if (failureCount > 0) {
    // Failures dominate; Partial if anything succeeded or conflicts exist,
    // else total failure when every attempted move failed.
    if (migratedCount === 0 && conflictCount === 0) {
      return 'MigrationFailed';
    }
    return 'MigrationPartiallySucceeded';
  }

  if (conflictCount > 0) {
    return 'MigrationSucceededWithConflicts';
  }

  return 'MigrationSucceeded';
}

/**
 * Ensures/migrates then discovers scenarios across `migration.discoveryRoots`,
 * preferring canonical when the same relative path exists under both roots.
 */
export async function discoverWorkspaceScenarios(
  workspaceFolderPath: string,
  service: ScenarioStorageService = new ScenarioStorageService(),
  options?: ScenarioMigrationOptions,
): Promise<ScenarioDiscoverResult> {
  const { migration } = await ensureScenariosRoot(workspaceFolderPath, options);
  return discoverScenariosInDiscoveryRoots(migration, service);
}

/**
 * Discovers scenario files from `migration.discoveryRoots` and merges them:
 * canonical wins on relative-path collisions; legacy-only files stay visible.
 */
export async function discoverScenariosInDiscoveryRoots(
  migration: ScenarioMigrationResult,
  service: ScenarioStorageService = new ScenarioStorageService(),
): Promise<ScenarioDiscoverResult> {
  const byRelative = new Map<string, string>();

  for (const root of migration.discoveryRoots) {
    let files: readonly string[];
    try {
      files = await discoverScenarioFiles(root);
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : 'Unable to discover scenario files.';
      return {
        ok: false,
        files: [],
        error: error(root, 'READ_FAILED', message, cause),
      };
    }
    for (const file of files) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      // First root is always canonical; later roots only add unique paths.
      if (!byRelative.has(relative)) {
        byRelative.set(relative, file);
      }
    }
  }

  const mergedFiles = [...byRelative.values()].sort((a, b) =>
    a.localeCompare(b),
  );
  const scenarios: Scenario[] = [];
  for (const file of mergedFiles) {
    const loaded = await service.load(file);
    if (loaded.ok) {
      scenarios.push(loaded.scenario);
    }
  }
  return { ok: true, scenarios, files: mergedFiles };
}

/**
 * TOCTOU-safe single-file migration: never overwrites a differing destination.
 * Returns a small outcome for counting; throws on hard failure.
 */
async function migrateOneScenarioFile(
  src: string,
  dest: string,
  io: ScenarioStorageFs,
  copyFileExcl: number,
): Promise<ScenarioMigrateOneOutcome> {
  if (await pathExists(dest, io)) {
    return resolveExistingDest(src, dest, io);
  }

  await io.mkdir(path.dirname(dest), { recursive: true });

  // Exclusive reservation: create empty dest with O_EXCL semantics.
  try {
    const handle = await io.open(dest, 'wx');
    await handle.close();
  } catch (cause) {
    if (errnoCode(cause) === 'EEXIST') {
      return resolveExistingDest(src, dest, io);
    }
    throw cause;
  }

  // Prefer rename (POSIX replaces our empty placeholder atomically).
  try {
    await io.rename(src, dest);
    return 'moved';
  } catch (renameCause) {
    const code = errnoCode(renameCause);

    // EXDEV / Windows-style "cannot replace existing": place via exclusive copy.
    if (
      code === 'EXDEV' ||
      code === 'EEXIST' ||
      code === 'EPERM' ||
      code === 'EACCES'
    ) {
      return placeViaExclusiveCopyAfterReservation(
        src,
        dest,
        io,
        copyFileExcl,
        renameCause,
      );
    }

    await cleanupReservedEmptyDest(dest, io);
    throw renameCause;
  }
}

/**
 * After a failed rename onto our empty reservation: if another writer replaced
 * the placeholder, conflict; otherwise release the empty name and COPYFILE_EXCL.
 * Never treat our own failed write leftovers as a successful conflict.
 */
async function placeViaExclusiveCopyAfterReservation(
  src: string,
  dest: string,
  io: ScenarioStorageFs,
  copyFileExcl: number,
  renameCause: unknown,
): Promise<ScenarioMigrateOneOutcome> {
  if (!(await isEmptyFile(dest, io))) {
    // Another writer owns non-empty content — never overwrite.
    return resolveExistingDest(src, dest, io);
  }

  // Release our empty reservation so COPYFILE_EXCL can create exclusively.
  try {
    await io.unlink(dest);
  } catch {
    // If unlink fails and dest still exists non-empty, conflict; else fail.
    if (await pathExists(dest, io)) {
      if (!(await isEmptyFile(dest, io))) {
        return resolveExistingDest(src, dest, io);
      }
    }
  }

  try {
    await io.copyFile(src, dest, copyFileExcl);
    if (!(await filesHaveIdenticalContent(src, dest, io))) {
      try {
        await io.unlink(dest);
      } catch {
        // ignore
      }
      throw new Error(`Scenario migration verification failed for ${src}`);
    }
  } catch (copyCause) {
    if (errnoCode(copyCause) === 'EEXIST') {
      return resolveExistingDest(src, dest, io);
    }
    // Remove any partial dest we may have created (non-empty leftovers).
    try {
      await io.unlink(dest);
    } catch {
      // ignore
    }
    throw copyCause instanceof Error ? copyCause : renameCause;
  }

  // Dest is verified — do not roll it back if only legacy cleanup fails.
  try {
    await io.unlink(src);
  } catch {
    // Legacy leftover will be retried on a later pass / identical_removed.
  }
  return 'moved';
}

/**
 * Optional exclusive-copy helper for tests / callers that copy without a prior
 * wx reservation. Maps EEXIST → conflict_kept via resolveExistingDest.
 */
export async function copyScenarioFileExclusive(
  src: string,
  dest: string,
  io: ScenarioStorageFs = defaultMigrationFs(),
  copyFileExcl: number = fs.constants.COPYFILE_EXCL,
): Promise<ScenarioMigrateOneOutcome> {
  await io.mkdir(path.dirname(dest), { recursive: true });
  try {
    await io.copyFile(src, dest, copyFileExcl);
    await io.unlink(src);
    return 'moved';
  } catch (cause) {
    if (errnoCode(cause) === 'EEXIST') {
      return resolveExistingDest(src, dest, io);
    }
    throw cause;
  }
}

async function isEmptyFile(
  filePath: string,
  io: ScenarioStorageFs,
): Promise<boolean> {
  try {
    const buf = await io.readFile(filePath);
    return buf.length === 0;
  } catch {
    return false;
  }
}

async function resolveExistingDest(
  src: string,
  dest: string,
  io: ScenarioStorageFs,
): Promise<ScenarioMigrateOneOutcome> {
  if (await filesHaveIdenticalContent(src, dest, io)) {
    await io.unlink(src);
    return 'identical_removed';
  }
  return 'conflict_kept';
}

async function cleanupReservedEmptyDest(
  dest: string,
  io: ScenarioStorageFs,
): Promise<void> {
  try {
    const buf = await io.readFile(dest);
    if (buf.length === 0) {
      await io.unlink(dest);
    }
  } catch {
    // Missing or unreadable — leave as-is.
  }
}

async function pathExists(
  filePath: string,
  io: ScenarioStorageFs,
): Promise<boolean> {
  try {
    await io.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function filesHaveIdenticalContent(
  a: string,
  b: string,
  io: ScenarioStorageFs,
): Promise<boolean> {
  const [bufA, bufB] = await Promise.all([io.readFile(a), io.readFile(b)]);
  return bufA.equals(bufB);
}

async function tryRemoveEmptyDir(
  dirPath: string,
  io: ScenarioStorageFs,
): Promise<void> {
  try {
    await io.rmdir(dirPath);
  } catch {
    // Not empty, missing, or not a directory — leave in place.
  }
}

/** Bottom-up removal of empty directories under `root` (does not remove `root`). */
async function removeEmptyDirsUnder(
  root: string,
  io: ScenarioStorageFs,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await io.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(root, entry.name);
    await removeEmptyDirsUnder(child, io);
    await tryRemoveEmptyDir(child, io);
  }
}

async function discoverScenarioFiles(
  rootPath: string,
  io: ScenarioStorageFs = defaultMigrationFs(),
): Promise<readonly string[]> {
  const out: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await io.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.scenario.json')) {
        out.push(full);
      }
    }
  }

  await visit(rootPath);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export class ScenarioStorageService {
  public constructor(private readonly options: ScenarioStorageOptions = {}) {}

  public async load(filePath: string): Promise<ScenarioLoadResult> {
    let bytes: string;
    try {
      bytes = await defaultFs.readFile(filePath, 'utf8');
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Unable to read file.';
      const code: ScenarioStorageError['code'] =
        cause instanceof Error && (cause as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'FILE_NOT_FOUND'
          : 'READ_FAILED';
      return { ok: false, error: error(filePath, code, message, cause) };
    }

    const parsed = parseScenarioDocument(bytes);
    if (!parsed.ok) {
      const message = parsed.errors.join(' ');
      const code: ScenarioStorageError['code'] = message.includes('schemaVersion')
        ? 'INVALID_SCHEMA_VERSION'
        : message.includes('failed to parse')
          ? 'PARSE_FAILED'
          : 'INVALID_DOCUMENT';
      return { ok: false, error: error(filePath, code, message) };
    }

    return { ok: true, scenario: parsed.scenario };
  }

  public async save(scenario: Scenario, filePath: string): Promise<ScenarioSaveResult> {
    void this.options;
    // Round-trip through schema validation before writing so unloadable
    // sidecars cannot be persisted from untrusted / partial payloads.
    const content = serializeScenario(scenario);
    const reparsed = parseScenarioDocument(content);
    if (!reparsed.ok) {
      return {
        ok: false,
        error: error(
          filePath,
          'INVALID_DOCUMENT',
          reparsed.errors.join(' ') || 'Scenario failed schema validation.',
        ),
      };
    }
    const validatedContent = serializeScenario(reparsed.scenario);
    const dir = path.dirname(filePath);
    try {
      await defaultFs.mkdir(dir, { recursive: true });
      await defaultFs.writeFile(filePath, validatedContent, 'utf8');
      return { ok: true };
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Unable to write file.';
      return {
        ok: false,
        error: error(filePath, 'WRITE_FAILED', message, cause),
      };
    }
  }

  public async discover(rootPath: string): Promise<ScenarioDiscoverResult> {
    let files: readonly string[];
    try {
      files = await discoverScenarioFiles(rootPath);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Unable to discover scenario files.';
      return {
        ok: false,
        files: [],
        error: error(rootPath, 'READ_FAILED', message, cause),
      };
    }

    const scenarios: Scenario[] = [];
    for (const file of files) {
      const loaded = await this.load(file);
      if (loaded.ok) {
        scenarios.push(loaded.scenario);
      }
    }
    return { ok: true, scenarios, files };
  }
}
