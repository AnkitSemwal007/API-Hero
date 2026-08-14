import { Position, Uri, window, workspace, type TextDocument } from 'vscode';

import { COMMAND_IDS } from '../constants';
import { API_LANGUAGE_ID } from '../language-support/constants';
import type { ExecutionOrchestrator } from '../orchestration';
import { getActiveRequestEditorDocument } from '../request-editor/vscode';
import type { CommandDefinition } from './command-definition';
import { parseRunRequestCommandArgument } from './run-request-argument';
import {
  resolveRunRequestInvocation,
  type RunRequestDocumentView,
} from './resolve-run-request-invocation';

export interface MappedRunRequestSource {
  readonly text: string;
  readonly sourceId: string;
  readonly offset: number;
}

export interface RunRequestCommandOptions {
  /**
   * Resolves an explicit `@api-hero` mapping or a detectable Quick Run
   * `fetch("https://...")` call when no `.api` document is active and no
   * CodeLens argument was supplied (Command Palette / context menu from source).
   */
  readonly resolveMappedRequest?: (
    suppliedArgument: unknown,
  ) => Promise<MappedRunRequestSource | undefined>;
}

/** Creates the sole command adapter for single-request execution. */
export function createRunRequestCommand(
  orchestrator: ExecutionOrchestrator,
  options?: RunRequestCommandOptions,
): CommandDefinition {
  return {
    id: COMMAND_IDS.runRequest,
    execute: createRunRequestExecutor(orchestrator, options),
  };
}

/**
 * Alias of Run Request — assertions are always evaluated when present after
 * execute. Exposed for CodeLens "Run Tests" / command palette clarity.
 */
export function createRunRequestWithAssertionsCommand(
  orchestrator: ExecutionOrchestrator,
  options?: RunRequestCommandOptions,
): CommandDefinition {
  return {
    id: COMMAND_IDS.runRequestWithAssertions,
    execute: createRunRequestExecutor(orchestrator, options),
  };
}

function createRunRequestExecutor(
  orchestrator: ExecutionOrchestrator,
  options?: RunRequestCommandOptions,
): (...args: readonly unknown[]) => Promise<void> {
  return async (...args: readonly unknown[]) => {
    const argument = parseRunRequestCommandArgument(args[0]);
    const resolvedDocument = await resolveRunRequestDocument(argument);
    if (resolvedDocument !== undefined) {
      const resolved = resolveRunRequestInvocation({
        suppliedArgument: args[0],
        activeDocument: toRunRequestDocumentView(resolvedDocument.document),
        activeSelection: resolvedDocument.selection,
        apiLanguageId: API_LANGUAGE_ID,
      });
      if (!resolved.ok) {
        await window.showErrorMessage(resolved.errorMessage);
        return;
      }
      await orchestrator.runAtPosition({
        text: resolvedDocument.document.getText(),
        sourceId: resolvedDocument.document.uri.toString(),
        offset: resolved.offset,
      });
      return;
    }

    const mapped = await options?.resolveMappedRequest?.(args[0]);
    if (mapped !== undefined) {
      await orchestrator.runAtPosition(mapped);
      return;
    }

    await window.showErrorMessage(
      'Open an API Hero request file, add an @api-hero mapping, or place the cursor on a fetch("https://...") call, and try again.',
    );
  };
}

interface ResolvedRunRequestDocument {
  readonly document: TextDocument;
  readonly selection?: {
    readonly line: number;
    readonly character: number;
  };
}

async function resolveRunRequestDocument(
  argument: ReturnType<typeof parseRunRequestCommandArgument>,
): Promise<ResolvedRunRequestDocument | undefined> {
  if (argument !== undefined) {
    try {
      const uri = Uri.parse(argument.uri);
      const document = await workspace.openTextDocument(uri);
      if (!isApiDocument(document)) {
        return undefined;
      }
      return {
        document,
        selection: argument.position,
      };
    } catch {
      return undefined;
    }
  }

  const editor = window.activeTextEditor;
  if (editor !== undefined && isApiDocument(editor.document)) {
    return {
      document: editor.document,
      selection: {
        line: editor.selection.active.line,
        character: editor.selection.active.character,
      },
    };
  }

  const tracked = getActiveRequestEditorDocument();
  if (tracked !== undefined && isApiDocument(tracked)) {
    return { document: tracked };
  }

  return undefined;
}

function isApiDocument(document: TextDocument): boolean {
  return (
    document.languageId === API_LANGUAGE_ID ||
    document.uri.path.toLowerCase().endsWith('.api')
  );
}

function toRunRequestDocumentView(
  document: TextDocument,
): RunRequestDocumentView {
  return {
    uri: document.uri.toString(),
    languageId:
      document.languageId === API_LANGUAGE_ID
        ? document.languageId
        : API_LANGUAGE_ID,
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
