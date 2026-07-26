import type {
  VariableWriteRequest,
  VariableWriteResult,
} from './models';
import type {
  EnvironmentWritePorts,
  EnvironmentWriteVariable,
} from './environment-variable-writer';
import type { VariableWriter } from './variable-writer';

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;

/**
 * Upserts a variable into workspace scope and persists via the same
 * environment-manager ports used by {@link EnvironmentVariableWriter}.
 * Sensitive values are persisted through the existing local-overlay path
 * inside `writeEnvironmentManagerState` / project store.
 */
export class WorkspaceVariableWriter implements VariableWriter {
  public constructor(private readonly ports: EnvironmentWritePorts) {}

  public async write(request: VariableWriteRequest): Promise<VariableWriteResult> {
    if (request.scope !== 'workspace') {
      return {
        ok: false,
        code: 'UNSUPPORTED_SCOPE',
        message: `WorkspaceVariableWriter does not support scope "${request.scope}".`,
      };
    }
    if (!VARIABLE_NAME.test(request.name)) {
      return {
        ok: false,
        code: 'INVALID_NAME',
        message: `Invalid variable name "${request.name}".`,
      };
    }

    try {
      const state = await this.ports.getState();
      const nextVariable: EnvironmentWriteVariable = {
        name: request.name,
        value: request.value,
        sensitive: request.sensitive,
      };
      const variables = [...state.workspaceVariables];
      const existing = variables.findIndex(
        (variable) => variable.name === request.name,
      );
      if (existing >= 0) {
        variables[existing] = nextVariable;
      } else {
        variables.push(nextVariable);
      }

      await this.ports.writeState({
        ...state,
        workspaceVariables: variables,
      });
      await this.ports.refresh();
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to persist workspace variables.';
      return {
        ok: false,
        code: 'PERSIST_FAILED',
        message,
      };
    }
  }
}
