/**
 * CLI-only success / exit policy for scenario runs.
 * Does not change ScenarioEngine or MCP tool semantics.
 */

import type { McpScenarioRunDto } from '../mcp/dto';
import {
  EXIT_AUTH,
  EXIT_EXECUTION_FAILURE,
  EXIT_SUCCESS,
  isAuthenticationFailureMessage,
} from './exit-codes';

/**
 * Whether a scenario report should be treated as CLI success (exit 0).
 * Precondition-skipped steps (skipped + error message) fail CI even when
 * the engine reports a non-failed overall status.
 */
export function isScenarioCliSuccess(data: McpScenarioRunDto): boolean {
  const { total, completed, failed } = data.statistics;
  if (data.status === 'failed' || data.status === 'cancelled') {
    return false;
  }
  if (failed !== 0) {
    return false;
  }
  if (data.statistics.cancelled > 0) {
    return false;
  }
  if (hasPreconditionSkippedStep(data)) {
    return false;
  }
  if (total > 0 && completed === 0) {
    return false;
  }
  return true;
}

/**
 * Resolve CLI exit code for a scenario run DTO.
 * Auth-shaped step errors map to EXIT_AUTH when the run is not a CLI success.
 */
export function resolveScenarioCliExitCode(data: McpScenarioRunDto): number {
  if (isScenarioCliSuccess(data)) {
    return EXIT_SUCCESS;
  }
  const authFail = data.steps.some((step) =>
    isAuthenticationFailureMessage(step.error?.message),
  );
  return authFail ? EXIT_AUTH : EXIT_EXECUTION_FAILURE;
}

function hasPreconditionSkippedStep(data: McpScenarioRunDto): boolean {
  return data.steps.some(
    (step) =>
      step.status === 'skipped' &&
      step.error?.message !== undefined &&
      step.error.message.length > 0,
  );
}
