/**
 * CLI run orchestration: headless runtime → ApiHeroMcpService → format → exit.
 */

import {
  createHeadlessApiHeroRuntime,
  resolveMcpWorkspaceRoot,
} from '../headless';
import { ApiHeroMcpService } from '../mcp/service';
import {
  EXIT_AUTH,
  EXIT_CONFIG,
  EXIT_EXECUTION_FAILURE,
  EXIT_SUCCESS,
  isAuthenticationFailureMessage,
  mapMcpErrorToExitCode,
} from './exit-codes';
import {
  buildCollectionEnvelope,
  buildErrorEnvelope,
  buildRequestEnvelope,
  buildScenarioEnvelope,
  formatCliEnvelopeJson,
  formatCollectionHuman,
  formatErrorHuman,
  formatRequestHuman,
  formatScenarioHuman,
} from './format';
import type { ParsedCliArgs } from './parse-args';
import { resolveScenarioCliExitCode } from './scenario-result';

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

type RunCommand = Extract<ParsedCliArgs, { kind: 'run' }>;

export async function executeCliRun(
  command: RunCommand,
  options?: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
  },
): Promise<CliRunResult> {
  const cwd = options?.cwd ?? process.cwd();
  const env = options?.env ?? process.env;
  const workspaceRoot = resolveMcpWorkspaceRoot({
    cliWorkspace: command.workspace,
    env,
    cwd,
  });

  let runtime;
  try {
    runtime = await createHeadlessApiHeroRuntime({
      workspaceRoot,
      verbose: command.verbose,
      ...(command.environment === undefined
        ? {}
        : { environmentId: command.environment }),
      env,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exitCode = /^Unknown environment\b/u.test(message)
      ? EXIT_CONFIG
      : isAuthenticationFailureMessage(message)
        ? EXIT_AUTH
        : EXIT_CONFIG;
    return formatFailure(command, exitCode, message);
  }

  const service = ApiHeroMcpService.fromRuntime(runtime);

  if (command.targetType === 'request') {
    const result = await service.runRequest({
      request: command.target,
      requestId: command.target,
    });
    if (!result.ok) {
      return formatMcpError(command, result.error);
    }
    const authFail =
      result.data.failureDiagnostics?.failedAtStage === 'authentication' ||
      isAuthenticationFailureMessage(result.data.message);
    const ok =
      result.data.status === 'passed' || result.data.status === 'success';
    if (authFail) {
      return emit(command, EXIT_AUTH, result.data, (data) =>
        formatRequestHuman(data, { quiet: command.quiet }),
      );
    }
    return emit(
      command,
      ok ? EXIT_SUCCESS : EXIT_EXECUTION_FAILURE,
      result.data,
      (data) => formatRequestHuman(data, { quiet: command.quiet }),
    );
  }

  if (command.targetType === 'collection') {
    const result = await service.runCollection(command.target);
    if (!result.ok) {
      return formatMcpError(command, result.error);
    }
    const authFail = result.data.requests.some(
      (request) =>
        request.failureDiagnostics?.failedAtStage === 'authentication' ||
        isAuthenticationFailureMessage(request.message),
    );
    const ok = result.data.failed === 0 && result.data.status !== 'failed';
    if (authFail && !ok) {
      return emit(command, EXIT_AUTH, result.data, (data) =>
        formatCollectionHuman(data, { quiet: command.quiet }),
      );
    }
    return emit(
      command,
      ok ? EXIT_SUCCESS : EXIT_EXECUTION_FAILURE,
      result.data,
      (data) => formatCollectionHuman(data, { quiet: command.quiet }),
    );
  }

  const result = await service.runScenario({ scenario: command.target });
  if (!result.ok) {
    return formatMcpError(command, result.error);
  }
  return emit(
    command,
    resolveScenarioCliExitCode(result.data),
    result.data,
    (data) => formatScenarioHuman(data, { quiet: command.quiet }),
  );
}

function emit<T>(
  command: RunCommand,
  exitCode: number,
  data: T,
  human: (data: T) => string,
): CliRunResult {
  if (command.json) {
    let envelope;
    if (command.targetType === 'request') {
      envelope = buildRequestEnvelope(
        command.target,
        data as Parameters<typeof buildRequestEnvelope>[1],
      );
    } else if (command.targetType === 'collection') {
      envelope = buildCollectionEnvelope(
        command.target,
        data as Parameters<typeof buildCollectionEnvelope>[1],
      );
    } else {
      envelope = buildScenarioEnvelope(
        command.target,
        data as Parameters<typeof buildScenarioEnvelope>[1],
      );
    }
    return { exitCode, stdout: formatCliEnvelopeJson(envelope), stderr: '' };
  }
  return { exitCode, stdout: human(data), stderr: '' };
}

function formatMcpError(
  command: RunCommand,
  error: { readonly code: string; readonly message: string },
): CliRunResult {
  const exitCode = mapMcpErrorToExitCode(error);
  if (command.json) {
    return {
      exitCode,
      stdout: formatCliEnvelopeJson(
        buildErrorEnvelope(command.targetType, command.target, error),
      ),
      stderr: '',
    };
  }
  return {
    exitCode,
    stdout: '',
    stderr: formatErrorHuman(`${error.code}: ${error.message}`),
  };
}

function formatFailure(
  command: RunCommand,
  exitCode: number,
  message: string,
): CliRunResult {
  if (command.json) {
    return {
      exitCode,
      stdout: formatCliEnvelopeJson(
        buildErrorEnvelope(command.targetType, command.target, {
          code: 'CONFIG_ERROR',
          message,
        }),
      ),
      stderr: '',
    };
  }
  return { exitCode, stdout: '', stderr: formatErrorHuman(message) };
}
