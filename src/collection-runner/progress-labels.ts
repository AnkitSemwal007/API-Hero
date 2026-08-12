/**
 * Pure progress / attempt labels for collection runs (no vscode imports).
 */

import type { RunProgressAttempt } from './models';

/** Compact suffix for progress notification messages. */
export function formatAttemptSuffix(
  attempt: RunProgressAttempt | undefined,
): string {
  const label = formatAttemptLabel(attempt);
  return label === undefined ? '' : ` (${label})`;
}

/** Human label for retry attempt visibility. */
export function formatAttemptLabel(
  attempt: RunProgressAttempt | undefined,
): string | undefined {
  if (attempt === undefined || attempt.max <= 1) {
    return undefined;
  }
  if (attempt.phase === 'waiting') {
    const retryIndex = Math.max(1, attempt.current - 1);
    const maxRetries = Math.max(1, attempt.max - 1);
    return `Retrying… ${retryIndex}/${maxRetries}`;
  }
  return `Attempt ${attempt.current}/${attempt.max}`;
}
