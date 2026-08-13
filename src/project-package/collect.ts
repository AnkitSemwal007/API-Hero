/**
 * Collects currently supported project artifacts for packaging.
 */

import {
  COLLECTION_MARKER_FILENAME,
  COLLECTION_VARIABLES_FILENAME,
} from '../collections/constants';
import {
  APIHERO_DIRECTORY_NAME,
  AUTH_DIRECTORY_NAME,
  AUTH_PROFILES_FILENAME,
  CACHE_DIRECTORY_NAME,
  CONFIG_RELATIVE_PATH,
  ENVIRONMENTS_DIRECTORY_NAME,
  HISTORY_DIRECTORY_NAME,
  LOCAL_DIRECTORY_NAME,
  SCENARIOS_DIRECTORY_NAME,
  WORKSPACE_RELATIVE_PATH,
  parseConfigDocument,
} from '../project-store';
import {
  IMPORT_STAGING_DIRECTORY_NAME,
  MAX_PACKAGE_ENTRIES,
  MAX_PACKAGE_UNCOMPRESSED_BYTES,
  SKIP_DIRECTORY_NAMES,
} from './constants';
import { fail } from './errors';
import type { PackedProjectFile } from './models';
import { posixNormalize, isValidCollectionsDirectoryName, joinPosix, safePathSegments } from './paths';
import type { PackageFilesystem } from './ports';
import { redactPackedFile } from './redact';
import { textToBytes } from './archive';

interface CollectBudget {
  files: number;
  bytes: number;
}

export async function collectProjectFiles(
  filesystem: PackageFilesystem,
  workspaceRootPath: string,
): Promise<{
  readonly collectionsDirectory: string;
  readonly files: readonly PackedProjectFile[];
}> {
  const root = posixNormalize(workspaceRootPath).replace(/\/+$/u, '');
  const configFile = `${root}/${APIHERO_DIRECTORY_NAME}/${CONFIG_RELATIVE_PATH}`;
  if (!(await filesystem.exists(configFile))) {
    fail('no-project');
  }
  let configText: string;
  try {
    configText = await filesystem.readText(configFile);
  } catch {
    fail('no-project');
  }
  const config = parseConfigDocument(configText);
  if (config === undefined) {
    fail('invalid-project-structure');
  }
  if (!isValidCollectionsDirectoryName(config.collectionsDirectory)) {
    fail('invalid-project-structure');
  }
  const collectionsDirectory = config.collectionsDirectory.trim();
  const files: PackedProjectFile[] = [];
  const budget: CollectBudget = { files: 0, bytes: 0 };

  await collectStoreFiles(filesystem, root, files, budget);
  const collectionsRoot = `${root}/${collectionsDirectory}`;
  if (await filesystem.exists(collectionsRoot)) {
    await walkAndPack(
      filesystem,
      collectionsRoot,
      collectionsDirectory,
      files,
      budget,
      { collectionArtifactsOnly: true },
    );
  }
  await collectLegacyApiFiles(
    filesystem,
    root,
    collectionsDirectory,
    files,
    budget,
  );

  if (files.length === 0) {
    fail('invalid-project-structure');
  }
  return { collectionsDirectory, files };
}

async function collectStoreFiles(
  filesystem: PackageFilesystem,
  root: string,
  files: PackedProjectFile[],
  budget: CollectBudget,
): Promise<void> {
  const store = `${root}/${APIHERO_DIRECTORY_NAME}`;
  await addTextFile(
    filesystem,
    `${store}/${CONFIG_RELATIVE_PATH}`,
    `${APIHERO_DIRECTORY_NAME}/${CONFIG_RELATIVE_PATH}`,
    files,
    budget,
  );
  const workspacePath = `${store}/${WORKSPACE_RELATIVE_PATH}`;
  if (await filesystem.exists(workspacePath)) {
    await addTextFile(
      filesystem,
      workspacePath,
      `${APIHERO_DIRECTORY_NAME}/${WORKSPACE_RELATIVE_PATH}`,
      files,
      budget,
    );
  }
  const environmentsDir = `${store}/${ENVIRONMENTS_DIRECTORY_NAME}`;
  if (await filesystem.exists(environmentsDir)) {
    await walkAndPack(
      filesystem,
      environmentsDir,
      `${APIHERO_DIRECTORY_NAME}/${ENVIRONMENTS_DIRECTORY_NAME}`,
      files,
      budget,
      { jsonOnly: true },
    );
  }
  const authPath = `${store}/${AUTH_DIRECTORY_NAME}/${AUTH_PROFILES_FILENAME}`;
  if (await filesystem.exists(authPath)) {
    await addTextFile(
      filesystem,
      authPath,
      `${APIHERO_DIRECTORY_NAME}/${AUTH_DIRECTORY_NAME}/${AUTH_PROFILES_FILENAME}`,
      files,
      budget,
    );
  }
}

async function collectLegacyApiFiles(
  filesystem: PackageFilesystem,
  root: string,
  collectionsDirectory: string,
  files: PackedProjectFile[],
  budget: CollectBudget,
): Promise<void> {
  const packed = new Set(files.map((file) => file.relativePath));
  await walkLegacy(
    filesystem,
    root,
    '',
    collectionsDirectory,
    packed,
    files,
    budget,
  );
}

async function walkLegacy(
  filesystem: PackageFilesystem,
  absoluteDir: string,
  relativeDir: string,
  collectionsDirectory: string,
  packed: Set<string>,
  files: PackedProjectFile[],
  budget: CollectBudget,
): Promise<void> {
  let entries;
  try {
    entries = await filesystem.readDirectory(absoluteDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (shouldSkipDirectory(entry.name, relativeDir)) {
      continue;
    }
    const relativePath =
      relativeDir.length === 0 ? entry.name : `${relativeDir}/${entry.name}`;
    const segments = safePathSegments(relativePath);
    if (segments === undefined) {
      continue;
    }
    const childAbsolute = `${absoluteDir}/${entry.name}`;
    if (entry.type === 'directory') {
      if (relativeDir.length === 0 && entry.name === collectionsDirectory) {
        continue;
      }
      if (relativeDir.length === 0 && entry.name === APIHERO_DIRECTORY_NAME) {
        continue;
      }
      await walkLegacy(
        filesystem,
        childAbsolute,
        joinPosix(segments),
        collectionsDirectory,
        packed,
        files,
        budget,
      );
      continue;
    }
    if (!entry.name.toLowerCase().endsWith('.api')) {
      continue;
    }
    const posix = joinPosix(segments);
    if (packed.has(posix)) {
      continue;
    }
    await addTextFile(filesystem, childAbsolute, posix, files, budget);
    packed.add(posix);
  }
}

async function walkAndPack(
  filesystem: PackageFilesystem,
  absoluteDir: string,
  relativeDir: string,
  files: PackedProjectFile[],
  budget: CollectBudget,
  options: {
    readonly jsonOnly?: boolean;
    readonly collectionArtifactsOnly?: boolean;
  } = {},
): Promise<void> {
  let entries;
  try {
    entries = await filesystem.readDirectory(absoluteDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (shouldSkipDirectory(entry.name, relativeDir)) {
      continue;
    }
    const relativePath = `${relativeDir}/${entry.name}`;
    const segments = safePathSegments(relativePath);
    if (segments === undefined) {
      continue;
    }
    const posix = joinPosix(segments);
    const childAbsolute = `${absoluteDir}/${entry.name}`;
    if (entry.type === 'directory') {
      await walkAndPack(
        filesystem,
        childAbsolute,
        posix,
        files,
        budget,
        options,
      );
      continue;
    }
    if (!isPackableWalkFile(entry.name, options)) {
      continue;
    }
    await addTextFile(filesystem, childAbsolute, posix, files, budget);
  }
}

function isPackableWalkFile(
  name: string,
  options: {
    readonly jsonOnly?: boolean;
    readonly collectionArtifactsOnly?: boolean;
  },
): boolean {
  const lower = name.toLowerCase();
  if (options.jsonOnly === true) {
    return lower.endsWith('.json');
  }
  if (options.collectionArtifactsOnly === true) {
    return (
      lower.endsWith('.api') ||
      lower === COLLECTION_MARKER_FILENAME.toLowerCase() ||
      lower === COLLECTION_VARIABLES_FILENAME.toLowerCase()
    );
  }
  return true;
}

function shouldSkipDirectory(name: string, relativeDir: string): boolean {
  if ((SKIP_DIRECTORY_NAMES as readonly string[]).includes(name)) {
    return true;
  }
  if (relativeDir === APIHERO_DIRECTORY_NAME || relativeDir.startsWith(`${APIHERO_DIRECTORY_NAME}/`)) {
    if (
      name === LOCAL_DIRECTORY_NAME ||
      name === CACHE_DIRECTORY_NAME ||
      name === HISTORY_DIRECTORY_NAME ||
      name === SCENARIOS_DIRECTORY_NAME ||
      name === IMPORT_STAGING_DIRECTORY_NAME
    ) {
      return true;
    }
  }
  return false;
}

async function addTextFile(
  filesystem: PackageFilesystem,
  absolutePath: string,
  relativePath: string,
  files: PackedProjectFile[],
  budget: CollectBudget,
): Promise<void> {
  let text: string;
  try {
    text = await filesystem.readText(absolutePath);
  } catch {
    return;
  }
  const redacted = redactPackedFile(relativePath, text);
  const bytes = textToBytes(redacted);
  chargeBudget(budget, bytes.byteLength);
  files.push({ relativePath, bytes });
}

function chargeBudget(budget: CollectBudget, size: number): void {
  budget.files += 1;
  budget.bytes += size;
  if (
    budget.files > MAX_PACKAGE_ENTRIES - 1 ||
    budget.bytes > MAX_PACKAGE_UNCOMPRESSED_BYTES
  ) {
    fail('invalid-package', 'The project is too large to package.');
  }
}
