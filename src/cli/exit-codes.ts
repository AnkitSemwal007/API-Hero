/**
 * CLI exit codes for `apihero`.
 */

export const EXIT_SUCCESS = 0;
export const EXIT_EXECUTION_FAILURE = 1;
export const EXIT_USAGE = 2;
export const EXIT_CONFIG = 3;
export const EXIT_AUTH = 4;

const CONFIG_ERROR_CODES = new Set([
  'EMPTY_WORKSPACE',
  'COLLECTION_NOT_FOUND',
  'COLLECTION_REQUIRED',
  'REQUEST_NOT_FOUND',
  'REQUEST_AMBIGUOUS',
  'REQUEST_UNREADABLE',
  'SCENARIO_NOT_FOUND',
  'SCENARIO_AMBIGUOUS',
  'SCENARIO_LOAD_FAILED',
  'SCENARIO_UNBOUND',
  'SCENARIO_VALIDATION_FAILED',
  'REQUEST_REF_UNRESOLVED',
  'PLAN_BUILD_FAILED',
  'NO_REQUESTS',
  'DEPENDENCY_ENRICH_FAILED',
  'INVALID_FAILURE_POLICY',
  'RUN_NOT_FOUND',
  'REQUEST_RESULT_NOT_FOUND',
]);

const AUTH_ERROR_CODES = new Set([
  'AUTH_SECRET_MISSING',
  'AUTHENTICATION_FAILED',
  'SECRET_UNAVAILABLE',
]);

/**
 * Narrow auth-message fallback. Prefer MCP error codes / failedAtStage when
 * available — avoid matching arbitrary text that merely mentions "authentication".
 */
const AUTH_MESSAGE_PATTERN =
  /(?:missing\s+secret(?:\s+field)?|secret\s+(?:is\s+)?(?:unavailable|missing)|authentication\s+(?:secret|profile).*(?:missing|unavailable)|requires\s+secret|Secret\s+Storage)/iu;

export function mapMcpErrorToExitCode(error: {
  readonly code: string;
  readonly message: string;
}): number {
  if (AUTH_ERROR_CODES.has(error.code)) {
    return EXIT_AUTH;
  }
  if (CONFIG_ERROR_CODES.has(error.code) || /not found|unbound|validation|empty/iu.test(error.code)) {
    return EXIT_CONFIG;
  }
  if (error.code === 'RUN_ALREADY_ACTIVE' || error.code === 'RUN_FAILED' || error.code === 'INTERNAL') {
    // Auth-shaped RUN_FAILED messages still map to exit 4.
    if (isAuthenticationFailureMessage(error.message)) {
      return EXIT_AUTH;
    }
    return EXIT_EXECUTION_FAILURE;
  }
  if (isAuthenticationFailureMessage(error.message)) {
    return EXIT_AUTH;
  }
  return EXIT_CONFIG;
}

export function isAuthenticationFailureMessage(message: string | undefined): boolean {
  if (message === undefined || message.length === 0) {
    return false;
  }
  return AUTH_MESSAGE_PATTERN.test(message);
}
