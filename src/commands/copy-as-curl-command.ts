import { Position, env, window, type TextDocument } from 'vscode';

import { COMMAND_IDS } from '../constants';
import { generateCurl } from '../curl';
import { API_LANGUAGE_ID } from '../language-support/constants';
import type { ExecutionOrchestrator } from '../orchestration';
import { getActiveRequestEditorDocument } from '../request-editor/vscode';
import type { CommandDefinition } from './command-definition';
import {
  resolveRunRequestInvocation,
  type RunRequestDocumentView,
} from './resolve-run-request-invocation';

/** Creates the Copy as cURL command — resolve then generate, never execute. */
export function createCopyAsCurlCommand(
  orchestrator: ExecutionOrchestrator,
): CommandDefinition {
  return {
    id: COMMAND_IDS.copyAsCurl,
    execute: async (...args: readonly unknown[]) => {
      const resolvedDocument = resolveCopyAsCurlDocument();
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

      const resolution = await orchestrator.resolveAtSourceLocation({
        text: resolvedDocument.document.getText(),
        sourceId: resolvedDocument.document.uri.toString(),
        offset: resolved.offset,
      });

      if (!resolution.success) {
        await window.showErrorMessage(resolution.message);
        return;
      }

      const curl = generateCurl(resolution.request, {
        redactSecrets: true,
        values: resolution.values,
      });
      await env.clipboard.writeText(curl);
      window.setStatusBarMessage('Copied cURL to clipboard', 3000);
    },
  };
}

interface ResolvedCopyDocument {
  readonly document: TextDocument;
  readonly selection?: {
    readonly line: number;
    readonly character: number;
  };
}

/**
 * Prefer a focused `api` text editor; otherwise the active Request Editor panel.
 * Same document resolution as Run Request.
 */
function resolveCopyAsCurlDocument(): ResolvedCopyDocument | undefined {
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
