import { Position, Uri, window, workspace } from 'vscode';

import type { MappedRunRequestSource } from '../../commands';
import {
  QUICK_RUN_SOURCE_ID,
  detectFetchAtCursor,
  matchCatalogByMethodAndUrl,
  serializeDetectedFetch,
  type DetectedFetchCall,
} from '../quick-run';
import type { CatalogRequest, SourceIntegrationCatalog } from '../index';
import { isSourceLanguageId } from '../languages';
import { resolveMappedRequest } from './commands';

/**
 * Resolves Run Request from an explicit `@api-hero` mapping or a detectable
 * `fetch("https://...")` call. Temporary Quick Runs pass synthesized `.api`
 * text to the orchestrator without opening an untitled `language: api` document.
 */
export async function resolveSourceRun(
  catalog: SourceIntegrationCatalog,
  workspaceRoots: readonly string[],
  suppliedArgument: unknown,
): Promise<MappedRunRequestSource | undefined> {
  const mapped = await resolveMappedRequest(
    catalog,
    workspaceRoots,
    suppliedArgument,
  );
  if (mapped !== undefined) {
    const opened = await openCatalogRequestSource(mapped);
    if (opened === undefined) {
      await window.showErrorMessage(
        'API Hero could not open the mapped request file.',
      );
    }
    return opened;
  }

  const editor = window.activeTextEditor;
  if (editor === undefined || !isSourceLanguageId(editor.document.languageId)) {
    return undefined;
  }

  const detected = detectFetchAtCursor(
    editor.document.getText(),
    editor.document.offsetAt(editor.selection.active),
  );
  if (detected === undefined) {
    return undefined;
  }

  const match = matchCatalogByMethodAndUrl(
    catalog,
    detected.method,
    detected.url,
  );
  if (match.kind === 'unique') {
    return (
      (await openCatalogRequestSource(match.request)) ??
      synthesizeQuickRun(detected)
    );
  }
  if (match.kind === 'ambiguous') {
    const picked = await pickMatchingRequest(match.requests);
    if (picked !== undefined) {
      return (
        (await openCatalogRequestSource(picked)) ?? synthesizeQuickRun(detected)
      );
    }
  }
  return synthesizeQuickRun(detected);
}

async function openCatalogRequestSource(
  request: CatalogRequest,
): Promise<MappedRunRequestSource | undefined> {
  try {
    const document = await workspace.openTextDocument(Uri.parse(request.filePath));
    return {
      text: document.getText(),
      sourceId: document.uri.toString(),
      offset: document.offsetAt(
        new Position(request.range.start.line, request.range.start.column),
      ),
    };
  } catch {
    return undefined;
  }
}

async function pickMatchingRequest(
  requests: readonly CatalogRequest[],
): Promise<CatalogRequest | undefined> {
  const selected = await window.showQuickPick(
    requests.map((request) => ({
      label: request.name,
      description: request.relativePath,
      request,
    })),
    {
      placeHolder:
        'Multiple API Hero requests match this URL. Select one to reuse, or press Escape to run a temporary request.',
      matchOnDescription: true,
    },
  );
  return selected?.request;
}

function synthesizeQuickRun(detected: DetectedFetchCall): MappedRunRequestSource {
  return {
    text: serializeDetectedFetch(detected),
    sourceId: QUICK_RUN_SOURCE_ID,
    offset: 0,
  };
}
