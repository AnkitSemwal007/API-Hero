import { readPackageVersion } from '../shared';
import { packArchive, textToBytes } from './archive';
import { collectProjectFiles } from './collect';
import { MANIFEST_ENTRY_NAME } from './constants';
import { toPackageFailure } from './errors';
import { buildManifest, sha256Hex } from './manifest';
import type { ExportProjectSuccess, ProjectPackageResult } from './models';
import { archivePathForProjectFile } from './paths';
import type { PackageFilesystem } from './ports';

export async function exportProjectPackage(
  filesystem: PackageFilesystem,
  workspaceRootPath: string,
  projectName: string,
  now: Date = new Date(),
): Promise<ProjectPackageResult<ExportProjectSuccess>> {
  try {
    const collected = await collectProjectFiles(filesystem, workspaceRootPath);
    const archiveFiles: Record<string, Uint8Array> = {};
    const manifestFiles: { path: string; sha256: string }[] = [];
    for (const file of collected.files) {
      const archivePath = archivePathForProjectFile(file.relativePath);
      if (archivePath === undefined) {
        continue;
      }
      archiveFiles[archivePath] = file.bytes;
      manifestFiles.push({
        path: archivePath,
        sha256: sha256Hex(file.bytes),
      });
    }
    const manifest = buildManifest({
      projectName: sanitizeProjectName(projectName),
      createdAt: now.toISOString(),
      apiHeroVersion: readPackageVersion(),
      collectionsDirectory: collected.collectionsDirectory,
      files: manifestFiles,
    });
    archiveFiles[MANIFEST_ENTRY_NAME] = textToBytes(
      `${JSON.stringify(manifest, undefined, 2)}\n`,
    );
    const bytes = packArchive(archiveFiles);
    return {
      ok: true,
      value: {
        bytes,
        manifest,
        fileCount: manifestFiles.length,
      },
    };
  } catch (error: unknown) {
    return toPackageFailure(error);
  }
}

export function sanitizeProjectName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'API-Hero-Project';
  }
  const cleaned = [...trimmed]
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code < 32 || '<>:"/\\|?*'.includes(char)) {
        return '-';
      }
      return char;
    })
    .join('');
  return cleaned.slice(0, 120);
}

