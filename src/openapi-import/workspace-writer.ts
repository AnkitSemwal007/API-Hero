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
}

export interface WriteArtifactsOptions {
  readonly targetRoot: string;
  /** Directory under targetRoot, e.g. `Collections/petstore`. */
  readonly outputDirectoryName: string;
  readonly files: readonly GeneratedApiFile[];
  readonly writer: WorkspaceFileWriter;
  readonly cancellation?: ImportCancellation;
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

  await options.writer.mkdir(targetDirectory);

  for (const file of options.files) {
    if (options.cancellation?.isCancellationRequested === true) {
      return {
        writtenFiles,
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
      continue;
    }

    const parent = absolute.replace(/[/\\][^/\\]+$/u, '');
    if (parent.length > 0 && parent !== absolute) {
      await options.writer.mkdir(parent);
    }
    await options.writer.writeFile(absolute, file.content);
    writtenFiles.push(absolute);
  }

  return {
    writtenFiles,
    targetDirectory,
    diagnostics,
    cancelled: false,
  };
}
