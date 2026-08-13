/**
 * User-facing package errors. Callers must show `message`, not stack traces.
 */

export type ProjectPackageErrorCode =
  | 'invalid-package'
  | 'unsupported-version'
  | 'missing-manifest'
  | 'malformed-manifest'
  | 'corrupt-package'
  | 'invalid-project-structure'
  | 'unsafe-package'
  | 'unsupported-content'
  | 'destination-failure'
  | 'permission-failure'
  | 'destination-conflict'
  | 'no-project';

export class ProjectPackageError extends Error {
  public readonly code: ProjectPackageErrorCode;

  public constructor(code: ProjectPackageErrorCode, message: string) {
    super(message);
    this.name = 'ProjectPackageError';
    this.code = code;
  }
}

export function packageErrorMessage(code: ProjectPackageErrorCode): string {
  switch (code) {
    case 'invalid-package':
      return 'This file is not a valid API Hero project package.';
    case 'unsupported-version':
      return 'This project package uses a format version API Hero cannot open yet.';
    case 'missing-manifest':
      return 'This project package is missing its manifest.';
    case 'malformed-manifest':
      return 'This project package has a malformed manifest.';
    case 'corrupt-package':
      return 'This project package is corrupt or its contents do not match the manifest.';
    case 'invalid-project-structure':
      return 'This project package does not contain a valid API Hero project.';
    case 'unsafe-package':
      return 'This project package contains unsafe file paths and was not imported.';
    case 'unsupported-content':
      return 'This project package contains content this version of API Hero cannot import.';
    case 'destination-failure':
      return 'API Hero could not write the imported project to the selected folder.';
    case 'permission-failure':
      return (
        'This folder is read-only or permission was denied. ' +
        'Choose a writable folder and try again.'
      );
    case 'destination-conflict':
      return 'The selected folder already contains an API Hero project.';
    case 'no-project':
      return 'Open an API Hero project folder before exporting.';
  }
}

export function toPackageFailure(error: unknown): {
  readonly ok: false;
  readonly code: ProjectPackageErrorCode;
  readonly message: string;
} {
  if (error instanceof ProjectPackageError) {
    return { ok: false, code: error.code, message: error.message };
  }
  return {
    ok: false,
    code: 'invalid-package',
    message: packageErrorMessage('invalid-package'),
  };
}

export function fail(
  code: ProjectPackageErrorCode,
  detail?: string,
): never {
  const base = packageErrorMessage(code);
  throw new ProjectPackageError(
    code,
    detail === undefined || detail.trim().length === 0
      ? base
      : `${base} ${detail.trim()}`,
  );
}
