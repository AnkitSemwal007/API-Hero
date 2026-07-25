/**
 * Maps filesystem / permission failures to actionable user copy.
 * Framework-free so unit tests do not need the VS Code API.
 */
export function describeFilesystemFailure(
  error: unknown,
): string | undefined {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (
    code === 'NoPermissions' ||
    code === 'Unavailable' ||
    /EACCES|EPERM|EROFS|read-?only/i.test(message)
  ) {
    return (
      'This workspace is read-only or permission was denied. ' +
      'Choose a writable folder and try again.'
    );
  }
  return undefined;
}
