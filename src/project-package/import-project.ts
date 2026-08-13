import {
  APIHERO_DIRECTORY_NAME,
  AUTH_DIRECTORY_NAME,
  CACHE_DIRECTORY_NAME,
  CONFIG_RELATIVE_PATH,
  ENVIRONMENTS_DIRECTORY_NAME,
  HISTORY_DIRECTORY_NAME,
  LOCAL_DIRECTORY_NAME,
  SCENARIOS_DIRECTORY_NAME,
  WORKSPACE_RELATIVE_PATH,
  parseConfigDocument,
} from '../project-store';
import { bytesToText, unpackArchive } from './archive';
import {
  IMPORT_STAGING_DIRECTORY_NAME,
  MANIFEST_ENTRY_NAME,
  PROJECT_ROOT_PREFIX,
} from './constants';
import { describeFilesystemFailure } from '../shared';
import { fail, toPackageFailure } from './errors';
import { parseManifest, sha256Hex } from './manifest';
import type {
  ImportProjectOptions,
  ImportProjectSuccess,
  ProjectPackageResult,
} from './models';
import {
  isValidCollectionsDirectoryName,
  joinPosix,
  projectRelativeFromArchive,
  resolveUnderDestination,
  safePathSegments,
} from './paths';
import type { PackageFilesystem } from './ports';

export async function inspectProjectPackage(bytes: Uint8Array): Promise<
  ProjectPackageResult<{
    readonly manifest: ReturnType<typeof parseManifest>;
    readonly entries: Readonly<Record<string, Uint8Array>>;
  }>
> {
  try {
    const entries = unpackArchive(bytes);
    const manifestBytes = entries[MANIFEST_ENTRY_NAME];
    if (manifestBytes === undefined) {
      fail('missing-manifest');
    }
    const manifest = parseManifest(bytesToText(manifestBytes));
    assertPayloadMatchesManifest(entries, manifest);
    assertValidProjectPayload(entries, manifest);
    return { ok: true, value: { manifest, entries } };
  } catch (error: unknown) {
    return toPackageFailure(error);
  }
}

export async function importProjectPackage(
  filesystem: PackageFilesystem,
  destinationRootPath: string,
  bytes: Uint8Array,
  options: ImportProjectOptions = {},
): Promise<ProjectPackageResult<ImportProjectSuccess>> {
  try {
    const inspected = await inspectProjectPackage(bytes);
    if (!inspected.ok) {
      return inspected;
    }
    const { manifest, entries } = inspected.value;
    const destination = destinationRootPath.replace(/[/\\]+$/u, '');
    const conflict = await destinationHasApiHeroProject(
      filesystem,
      destination,
      manifest.collectionsDirectory,
    );
    if (conflict && options.overwrite !== true) {
      fail('destination-conflict');
    }
    const planned: { relative: string; content: Uint8Array }[] = [];
    for (const entry of manifest.files) {
      const relative = projectRelativeFromArchive(entry.path);
      if (relative === undefined) {
        fail('unsafe-package');
      }
      if (isExcludedImportPath(relative)) {
        fail('unsupported-content');
      }
      if (resolveUnderDestination(destination, relative) === undefined) {
        fail('unsafe-package');
      }
      const content = entries[entry.path];
      if (content === undefined) {
        fail('corrupt-package');
      }
      planned.push({ relative, content });
    }
    await restorePlannedFiles(
      filesystem,
      destination,
      planned,
      conflict && options.overwrite === true
        ? manifest.collectionsDirectory
        : undefined,
    );
    return {
      ok: true,
      value: {
        projectName: manifest.projectName,
        collectionsDirectory: manifest.collectionsDirectory,
        writtenPaths: planned.map((item) => item.relative),
      },
    };
  } catch (error: unknown) {
    return toPackageFailure(error);
  }
}

function assertPayloadMatchesManifest(
  entries: Readonly<Record<string, Uint8Array>>,
  manifest: ReturnType<typeof parseManifest>,
): void {
  const declared = new Set(manifest.files.map((file) => file.path));
  for (const name of Object.keys(entries)) {
    if (name === MANIFEST_ENTRY_NAME) {
      continue;
    }
    if (!declared.has(name)) {
      fail('corrupt-package');
    }
  }
  for (const file of manifest.files) {
    const bytes = entries[file.path];
    if (bytes === undefined) {
      fail('corrupt-package');
    }
    if (sha256Hex(bytes) !== file.sha256) {
      fail('corrupt-package');
    }
    const relative = projectRelativeFromArchive(file.path);
    if (relative === undefined || isExcludedImportPath(relative)) {
      fail('unsafe-package');
    }
  }
}

function assertValidProjectPayload(
  entries: Readonly<Record<string, Uint8Array>>,
  manifest: ReturnType<typeof parseManifest>,
): void {
  if (!isValidCollectionsDirectoryName(manifest.collectionsDirectory)) {
    fail('invalid-project-structure');
  }
  const configPath = joinPosix([
    PROJECT_ROOT_PREFIX,
    APIHERO_DIRECTORY_NAME,
    CONFIG_RELATIVE_PATH,
  ]);
  const configBytes = entries[configPath];
  if (configBytes === undefined) {
    fail('invalid-project-structure');
  }
  const config = parseConfigDocument(bytesToText(configBytes));
  if (config === undefined) {
    fail('invalid-project-structure');
  }
  if (config.collectionsDirectory.trim() !== manifest.collectionsDirectory) {
    fail('invalid-project-structure');
  }
}

function isExcludedImportPath(relativePath: string): boolean {
  const segments = safePathSegments(relativePath);
  if (segments === undefined) {
    return true;
  }
  if (segments[0] !== APIHERO_DIRECTORY_NAME) {
    return false;
  }
  const second = segments[1];
  return (
    second === LOCAL_DIRECTORY_NAME ||
    second === CACHE_DIRECTORY_NAME ||
    second === HISTORY_DIRECTORY_NAME ||
    second === SCENARIOS_DIRECTORY_NAME ||
    second === IMPORT_STAGING_DIRECTORY_NAME
  );
}

async function restorePlannedFiles(
  filesystem: PackageFilesystem,
  destination: string,
  planned: readonly { relative: string; content: Uint8Array }[],
  overwriteCollectionsDirectory: string | undefined,
): Promise<void> {
  const stagingRoot = `${destination}/${APIHERO_DIRECTORY_NAME}/${IMPORT_STAGING_DIRECTORY_NAME}`;
  if (await filesystem.exists(stagingRoot)) {
    await filesystem.delete(stagingRoot, { recursive: true });
  }
  for (const item of planned) {
    const staged = resolveUnderDestination(stagingRoot, item.relative);
    if (staged === undefined) {
      fail('unsafe-package');
    }
    await writeFileEnsuringDir(filesystem, staged, item.content);
  }
  if (overwriteCollectionsDirectory !== undefined) {
    await replacePackagedRoots(
      filesystem,
      destination,
      overwriteCollectionsDirectory,
    );
  }
  for (const item of planned) {
    const target = resolveUnderDestination(destination, item.relative);
    if (target === undefined) {
      fail('unsafe-package');
    }
    await writeFileEnsuringDir(filesystem, target, item.content);
  }
  if (await filesystem.exists(stagingRoot)) {
    await filesystem.delete(stagingRoot, { recursive: true });
  }
}

async function destinationHasApiHeroProject(
  filesystem: PackageFilesystem,
  destination: string,
  collectionsDirectory: string,
): Promise<boolean> {
  const configPath = `${destination}/${APIHERO_DIRECTORY_NAME}/${CONFIG_RELATIVE_PATH}`;
  if (await filesystem.exists(configPath)) {
    return true;
  }
  const collectionsPath = `${destination}/${collectionsDirectory}`;
  if (!(await filesystem.exists(collectionsPath))) {
    return false;
  }
  try {
    const entries = await filesystem.readDirectory(collectionsPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function replacePackagedRoots(
  filesystem: PackageFilesystem,
  destination: string,
  collectionsDirectory: string,
): Promise<void> {
  try {
    const collectionsPath = `${destination}/${collectionsDirectory}`;
    if (await filesystem.exists(collectionsPath)) {
      await filesystem.delete(collectionsPath, { recursive: true });
    }
    const store = `${destination}/${APIHERO_DIRECTORY_NAME}`;
    for (const relative of [
      CONFIG_RELATIVE_PATH,
      WORKSPACE_RELATIVE_PATH,
      ENVIRONMENTS_DIRECTORY_NAME,
      AUTH_DIRECTORY_NAME,
    ]) {
      const path = `${store}/${relative}`;
      if (await filesystem.exists(path)) {
        await filesystem.delete(path, { recursive: true });
      }
    }
  } catch (error: unknown) {
    mapFilesystemWriteError(error);
  }
}

async function writeFileEnsuringDir(
  filesystem: PackageFilesystem,
  absolutePath: string,
  bytes: Uint8Array,
): Promise<void> {
  try {
    const posix = absolutePath.replace(/\\/gu, '/');
    const slash = posix.lastIndexOf('/');
    if (slash > 0) {
      await filesystem.createDirectory(posix.slice(0, slash));
    }
    await filesystem.writeBytes(absolutePath, bytes);
  } catch (error: unknown) {
    mapFilesystemWriteError(error);
  }
}

function mapFilesystemWriteError(error: unknown): never {
  if (describeFilesystemFailure(error) !== undefined) {
    fail('permission-failure');
  }
  fail('destination-failure');
}
