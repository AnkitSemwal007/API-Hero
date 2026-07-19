import { Position, window } from 'vscode';

import { COMMAND_IDS } from '../constants';
import { API_LANGUAGE_ID } from '../language-support/constants';
import type { ExecutionOrchestrator } from '../orchestration';
import type { CommandDefinition } from './command-definition';
import { resolveRunRequestInvocation } from './resolve-run-request-invocation';

/** Creates the sole command adapter for single-request execution. */
export function createRunRequestCommand(
  orchestrator: ExecutionOrchestrator,
): CommandDefinition {
  return {
    id: COMMAND_IDS.runRequest,
    execute: createRunRequestExecutor(orchestrator),
  };
}

/**
 * Alias of Run Request — assertions are always evaluated when present after
 * execute. Exposed for CodeLens "Run Tests" / command palette clarity.
 */
export function createRunRequestWithAssertionsCommand(
  orchestrator: ExecutionOrchestrator,
): CommandDefinition {
  return {
    id: COMMAND_IDS.runRequestWithAssertions,
    execute: createRunRequestExecutor(orchestrator),
  };
}

function createRunRequestExecutor(
  orchestrator: ExecutionOrchestrator,
): (...args: readonly unknown[]) => Promise<void> {
  return async (...args: readonly unknown[]) => {
    const editor = window.activeTextEditor;
    const resolved = resolveRunRequestInvocation({
      suppliedArgument: args[0],
      activeDocument:
        editor === undefined
          ? undefined
          : {
              uri: editor.document.uri.toString(),
              languageId: editor.document.languageId,
              validatePosition: (position) => {
                const validated = editor.document.validatePosition(
                  new Position(position.line, position.character),
                );
                return {
                  line: validated.line,
                  character: validated.character,
                };
              },
              offsetAt: (position) =>
                editor.document.offsetAt(
                  new Position(position.line, position.character),
                ),
            },
      activeSelection:
        editor === undefined
          ? undefined
          : {
              line: editor.selection.active.line,
              character: editor.selection.active.character,
            },
      apiLanguageId: API_LANGUAGE_ID,
    });

    if (!resolved.ok) {
      await window.showErrorMessage(resolved.errorMessage);
      return;
    }
    if (editor === undefined) {
      await window.showErrorMessage(
        'Open an API Runner request file and try again.',
      );
      return;
    }

    await orchestrator.runAtPosition({
      text: editor.document.getText(),
      sourceId: editor.document.uri.toString(),
      offset: resolved.offset,
    });
  };
}
