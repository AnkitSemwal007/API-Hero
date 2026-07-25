import { Position, window, type TextDocument } from 'vscode';

import { COMMAND_IDS } from '../constants';
import { API_LANGUAGE_ID } from '../language-support/constants';
import type { ExecutionOrchestrator } from '../orchestration';
import { getActiveRequestEditorDocument } from '../request-editor/vscode';
import type { CommandDefinition } from './command-definition';
import {
  resolveRunRequestInvocation,
  type RunRequestDocumentView,
} from './resolve-run-request-invocation';

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
    const resolvedDocument = resolveRunRequestDocument();
    const resolved = resolveRunRequestInvocation({
      suppliedArgument: args[0],
      activeDocument:
        resolvedDocument === undefined
          ? undefined
          : toRunRequestDocumentView(resolvedDocument.document),
      activeSelection: resolvedDocument?.selection,
      apiLanguageId: API_LANGUAGE_ID,
    });

    if (!resolved.ok) {
      await window.showErrorMessage(resolved.errorMessage);
      return;
    }
    if (resolvedDocument === undefined) {
      await window.showErrorMessage(
        'Open an API Hero request file and try again.',
      );
      return;
    }

    await orchestrator.runAtPosition({
      text: resolvedDocument.document.getText(),
      sourceId: resolvedDocument.document.uri.toString(),
      offset: resolved.offset,
    });
  };
}

interface ResolvedRunRequestDocument {
  readonly document: TextDocument;
  readonly selection?: {
    readonly line: number;
    readonly character: number;
  };
}

/**
 * Prefer a focused `api` text editor; otherwise the active Request Editor panel.
 */
function resolveRunRequestDocument(): ResolvedRunRequestDocument | undefined {
  const editor = window.activeTextEditor;
  if (editor !== undefined && editor.document.languageId === API_LANGUAGE_ID) {
    return {
      document: editor.document,
      selection: {
        line: editor.selection.active.line,
        character: editor.selection.active.character,
      },
    };
  }

  const tracked = getActiveRequestEditorDocument();
  if (tracked !== undefined && tracked.languageId === API_LANGUAGE_ID) {
    // Request Editor is single-request — offset 0 via missing selection.
    return { document: tracked };
  }

  return undefined;
}

function toRunRequestDocumentView(
  document: TextDocument,
): RunRequestDocumentView {
  return {
    uri: document.uri.toString(),
    languageId: document.languageId,
    validatePosition: (position) => {
      const validated = document.validatePosition(
        new Position(position.line, position.character),
      );
      return {
        line: validated.line,
        character: validated.character,
      };
    },
    offsetAt: (position) =>
      document.offsetAt(new Position(position.line, position.character)),
  };
}
