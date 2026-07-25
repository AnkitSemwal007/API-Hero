import type {
  VariableWriteRequest,
  VariableWriteResult,
} from './models';
import type { VariableWriter } from './variable-writer';

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;

/** Portable environment snapshot shape used by {@link EnvironmentVariableWriter}. */
export interface EnvironmentWriteVariable {
  readonly name: string;
  readonly value: string;
  readonly sensitive: boolean;
}

export interface EnvironmentWriteEnvironment {
  readonly id: string;
  readonly name: string;
  readonly variables: readonly EnvironmentWriteVariable[];
}

export interface EnvironmentWriteState {
  readonly environments: readonly EnvironmentWriteEnvironment[];
  readonly globalVariables: readonly EnvironmentWriteVariable[];
  readonly workspaceVariables: readonly EnvironmentWriteVariable[];
  readonly activeEnvironmentId?: string;
  readonly selectedId?: string;
}

export interface EnvironmentWritePorts {
  getState(): Promise<EnvironmentWriteState> | EnvironmentWriteState;
  writeState(state: EnvironmentWriteState): Promise<void>;
  refresh(): Promise<void> | void;
  getActiveEnvironmentId(): string | undefined;
}

/**
 * Upserts a variable into the active environment and persists via injected ports.
 */
export class EnvironmentVariableWriter implements VariableWriter {
  public constructor(private readonly ports: EnvironmentWritePorts) {}

  public async write(request: VariableWriteRequest): Promise<VariableWriteResult> {
    if (request.scope !== 'environment') {
      return {
        ok: false,
        code: 'UNSUPPORTED_SCOPE',
        message: `EnvironmentVariableWriter does not support scope "${request.scope}".`,
      };
    }
    if (!VARIABLE_NAME.test(request.name)) {
      return {
        ok: false,
        code: 'INVALID_NAME',
        message: `Invalid variable name "${request.name}".`,
      };
    }

    const activeId = this.ports.getActiveEnvironmentId();
    if (activeId === undefined || activeId.trim().length === 0) {
      return {
        ok: false,
        code: 'NO_ACTIVE_ENVIRONMENT',
        message: 'No active environment is selected for variable persistence.',
      };
    }

    try {
      const state = await this.ports.getState();
      const envIndex = state.environments.findIndex(
        (environment) => environment.id === activeId,
      );
      if (envIndex < 0) {
        return {
          ok: false,
          code: 'NO_ACTIVE_ENVIRONMENT',
          message: `Active environment "${activeId}" was not found.`,
        };
      }

      const environment = state.environments[envIndex]!;
      const nextVariable: EnvironmentWriteVariable = {
        name: request.name,
        value: request.value,
        sensitive: request.sensitive,
      };
      const variables = [...environment.variables];
      const existing = variables.findIndex(
        (variable) => variable.name === request.name,
      );
      if (existing >= 0) {
        variables[existing] = nextVariable;
      } else {
        variables.push(nextVariable);
      }

      const environments = [...state.environments];
      environments[envIndex] = {
        ...environment,
        variables,
      };

      const nextState: EnvironmentWriteState = {
        ...state,
        environments,
      };

      await this.ports.writeState(nextState);
      await this.ports.refresh();
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to persist environment variables.';
      return {
        ok: false,
        code: 'PERSIST_FAILED',
        message,
      };
    }
  }
}
