/**
 * Formats variable-resolution errors for Request Editor preview UI.
 * Framework-free so Node tests can import without the extension host.
 */

/** User-facing preview text for a variable resolution error (never raw codes). */
export function formatVariablePreviewError(error: {
  readonly message: string;
}): string {
  const message = error.message.trim();
  return message.length > 0 ? message : 'Variable could not be resolved';
}
