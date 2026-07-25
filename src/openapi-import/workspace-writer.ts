/**
 * Writes generated `.api` files under a target directory with path traversal
 * protection. Does not use VS Code APIs — injectable filesystem port.
 */

import type {
  GeneratedApiFile,
  ImportCancellation,
  ImportDiagnostic,
} from './models';
import { resolveUnderTarget, safeJoinRelative } from './sanitize';

export interface WorkspaceFileWriter {
  mkdir(absolutePath: string): Promise<void>;
  writeFile(absolutePath: string, content: string): Promise<void>;
  /** Optional — used to roll back partial writes on cancel/error. */
  deleteFile?(absolutePath: string): Promise<void>;
  /** Optional — removes empty directories after rollback when safe. */
  removeDirectory?(absolutePath: string): Promise<void>;
  /** Optional — true when the path exists. */
  exists?(absolutePath: string): Promise<boolean>;
  /** Optional — true when the directory exists and contains entries. */
  isNonEmptyDirectory?(absolutePath: string): Promise<boolean>;
  /**
   * Optional — lists immediate child names (files and directories) under a
   * directory. Required for overwrite clearing of prior artifacts.
   */
  listDirectory?(absolutePath: string): Promise<readonly string[]>;
}

export interface WriteArtifactsOptions {
  readonly targetRoot: string;
  /** Directory under targetRoot, e.g. `Collections/petstore`. */
  readonly outputDirectoryName: string;
  readonly files: readonly GeneratedApiFile[];
  readonly writer: WorkspaceFileWriter;
  readonly cancellation?: ImportCancellation;
  /**
   * When false (default), refuse to write into an existing non-empty target
   * directory. Set true after an explicit overwrite confirmation.
   */
  readonly overwrite?: boolean;
}

export interface WriteArtifactsResult {
  readonly writtenFiles: readonly string[];
  readonly targetDirectory: string;
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly cancelled: boolean;
}

export async function writeImportArtifacts(
  options: WriteArtifactsOptions,
): Promise<WriteArtifactsResult> {
  const diagnostics: ImportDiagnostic[] = [];
  const writtenFiles: string[] = [];

  const outputRelative = safeJoinRelative(options.outputDirectoryName);
  if (outputRelative === undefined) {
    return {
      writtenFiles: [],
      targetDirectory: options.targetRoot,
      cancelled: false,
      diagnostics: [
        {
          code: 'unsafe-output-directory',
          severity: 'error',
          message: `Refusing unsafe output directory "${options.outputDirectoryName}".`,
        },
      ],
    };
  }

  const targetDirectory = resolveUnderTarget(
    options.targetRoot,
    outputRelative,
  );
  if (targetDirectory === undefined) {
    return {
      writtenFiles: [],
      targetDirectory: options.targetRoot,
      cancelled: false,
      diagnostics: [
        {
          code: 'path-traversal',
          severity: 'error',
          message: 'Output directory escapes the workspace target root.',
        },
      ],
    };
  }

  if (options.overwrite !== true && options.writer.isNonEmptyDirectory) {
    const occupied = await options.writer.isNonEmptyDirectory(targetDirectory);
    if (occupied) {
      return {
        writtenFiles: [],
        targetDirectory,
        cancelled: false,
        diagnostics: [
          {
            code: 'target-exists',
            severity: 'error',
            message:
              `Import target "${options.outputDirectoryName}" already exists and is not empty. ` +
              'Choose a different collection name or confirm overwrite.',
          },
        ],
      };
    }
  }

  if (options.overwrite === true) {
    await clearTargetDirectory(options.writer, targetDirectory);
  }

  await options.writer.mkdir(targetDirectory);

  let failed = false;
  for (const file of options.files) {
    if (options.cancellation?.isCancellationRequested === true) {
      await rollbackWrittenFiles(options.writer, writtenFiles, targetDirectory);
      return {
        writtenFiles: [],
        targetDirectory,
        diagnostics,
        cancelled: true,
      };
    }

    const absolute = resolveUnderTarget(targetDirectory, file.relativePath);
    if (absolute === undefined) {
      diagnostics.push({
        code: 'path-traversal',
        severity: 'error',
        message: `Refusing to write path that escapes the import root: ${file.relativePath}`,
      });
      failed = true;
      break;
    }

    const parent = absolute.replace(/[/\\][^/\\]+$/u, '');
    if (parent.length > 0 && parent !== absolute) {
      await options.writer.mkdir(parent);
    }
    await options.writer.writeFile(absolute, file.content);
    writtenFiles.push(absolute);
  }

  if (failed || hasErrorDiagnostic(diagnostics)) {
    await rollbackWrittenFiles(options.writer, writtenFiles, targetDirectory);
    return {
      writtenFiles: [],
      targetDirectory,
      diagnostics,
      cancelled: false,
    };
  }

  return {
    writtenFiles,
    targetDirectory,
    diagnostics,
    cancelled: false,
  };
}

/** Deletes previously written import files (best-effort) and empty parents. */
export async function rollbackWrittenFiles(
  writer: WorkspaceFileWriter,
  writtenFiles: readonly string[],
  targetDirectory?: string,
): Promise<void> {
  if (writer.deleteFile === undefined || writtenFiles.length === 0) {
    return;
  }
  const parents = new Set<string>();
  for (const absolute of [...writtenFiles].reverse()) {
    try {
      await writer.deleteFile(absolute);
    } catch {
      // Best-effort rollback — continue deleting remaining files.
    }
    const parent = absolute.replace(/[/\\][^/\\]+$/u, '');
    if (parent.length > 0 && parent !== absolute) {
      parents.add(parent);
    }
  }
  if (writer.removeDirectory === undefined) {
    return;
  }
  const ordered = [...parents].sort((a, b) => b.length - a.length);
  for (const directory of ordered) {
    if (
      targetDirectory !== undefined &&
      (directory === targetDirectory ||
        directory.startsWith(`${targetDirectory}/`) ||
        directory.startsWith(`${targetDirectory}\\`))
    ) {
      try {
        await writer.removeDirectory(directory);
      } catch {
        // Only remove empty dirs; ignore failures.
      }
    }
  }
  if (targetDirectory !== undefined) {
    try {
      await writer.removeDirectory(targetDirectory);
    } catch {
      // Ignore when directory still has content or was pre-existing.
    }
  }
}

/**
 * Recursively removes existing files/dirs under the import target so overwrite
 * does not leave orphan artifacts from a prior import.
 */
async function clearTargetDirectory(
  writer: WorkspaceFileWriter,
  targetDirectory: string,
): Promise<void> {
  if (
    writer.listDirectory === undefined ||
    writer.deleteFile === undefined ||
    writer.removeDirectory === undefined
  ) {
    return;
  }
  let entries: readonly string[];
  try {
    entries = await writer.listDirectory(targetDirectory);
  } catch {
    return;
  }
  for (const name of entries) {
    const child = joinPath(targetDirectory, name);
    let isDirectory: boolean;
    try {
      await writer.listDirectory(child);
      isDirectory = true;
    } catch {
      isDirectory = false;
    }
    if (isDirectory) {
      await clearTargetDirectory(writer, child);
      try {
        await writer.removeDirectory(child);
      } catch {
        // Ignore non-empty or missing.
      }
    } else {
      try {
        await writer.deleteFile(child);
      } catch {
        // Best-effort clear.
      }
    }
  }
}

function joinPath(parent: string, child: string): string {
  const normalized = parent.replace(/[/\\]+$/u, '');
  return `${normalized}/${child}`;
}

function hasErrorDiagnostic(diagnostics: readonly ImportDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error');
}
