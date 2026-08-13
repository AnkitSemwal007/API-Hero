import {
  commands,
  Position,
  Range,
  Selection,
  Uri,
  window,
  workspace,
} from 'vscode';

import { parseRunRequestCommandArgument } from '../../commands/run-request-argument';
import { REQUEST_EDITOR_VIEW_TYPE } from '../../constants';
import {
  parseSourceAnnotations,
  parseSourceDirectiveValue,
  sourcePathMatches,
  type CatalogRequest,
  type SourceIntegrationCatalog,
} from '../index';
import { isSourceLanguageId } from '../languages';

export async function openMappedApiDefinition(
  catalog: SourceIntegrationCatalog,
  workspaceRoots: readonly string[],
  suppliedArgument: unknown,
): Promise<void> {
  const request = await resolveMappedRequest(
    catalog,
    workspaceRoots,
    suppliedArgument,
  );
  if (request === undefined) {
    await window.showInformationMessage(
      'API Hero could not find a mapped API definition for this location.',
    );
    return;
  }
  await openApiRequest(request, catalog);
}

export async function openMappedRelatedSource(
  catalog: SourceIntegrationCatalog,
  workspaceRoots: readonly string[],
  suppliedArgument: unknown,
): Promise<void> {
  const request = await resolveMappedRequest(
    catalog,
    workspaceRoots,
    suppliedArgument,
    { preferActiveApiDocument: true },
  );
  if (request?.sourceRef === undefined) {
    await window.showInformationMessage(
      'No source reference exists for this API definition.',
    );
    return;
  }
  const parsed = parseSourceDirectiveValue(request.sourceRef);
  if (parsed === undefined) {
    await window.showInformationMessage(
      'No source reference exists for this API definition.',
    );
    return;
  }
  const uri = await resolveWorkspaceFile(parsed.path, workspaceRoots);
  if (uri === undefined) {
    await window.showInformationMessage(
      'No source reference exists for this API definition.',
    );
    return;
  }
  const document = await workspace.openTextDocument(uri);
  const editor = await window.showTextDocument(document, { preview: false });
  if (parsed.line !== undefined) {
    const line = Math.min(Math.max(parsed.line, 0), document.lineCount - 1);
    const position = new Position(line, 0);
    editor.selection = new Selection(position, position);
    editor.revealRange(new Range(position, position));
  }
}

export async function resolveMappedRequest(
  catalog: SourceIntegrationCatalog,
  workspaceRoots: readonly string[],
  suppliedArgument: unknown,
  options: { readonly preferActiveApiDocument?: boolean } = {},
): Promise<CatalogRequest | undefined> {
  const argument = parseRunRequestCommandArgument(suppliedArgument);
  if (argument !== undefined) {
    const index = findRequestIndex(catalog, argument.uri, argument.position.line);
    if (index !== undefined) {
      const byLocation = catalog.resolveFromApiLocation(argument.uri, index);
      if (byLocation !== undefined) {
        return byLocation;
      }
    }
    return catalog.requests.find((request) => {
      return (
        request.filePath === argument.uri &&
        request.range.start.line === argument.position.line
      );
    });
  }

  const editor = window.activeTextEditor;
  if (editor === undefined) {
    return undefined;
  }
  if (options.preferActiveApiDocument === true && isApiDocument(editor.document.uri)) {
    const offset = editor.document.offsetAt(editor.selection.active);
    return findRequestAtOffset(catalog, editor.document.uri.toString(), offset);
  }
  if (!isSourceLanguageId(editor.document.languageId)) {
    return undefined;
  }
  const sites = parseSourceAnnotations(editor.document.getText());
  const line = editor.selection.active.line;
  const site = sites.find((entry) => entry.line === line);
  if (site === undefined) {
    return undefined;
  }
  const resolved = catalog.resolveFromAnnotations(site.annotations, {
    sourceFilePath: editor.document.uri.toString(),
    workspaceRoots,
  });
  return resolved.kind === 'match' ? resolved.request : undefined;
}

async function openApiRequest(
  request: CatalogRequest,
  catalog: SourceIntegrationCatalog,
): Promise<void> {
  const uri = Uri.parse(request.filePath);
  const requestCount = catalog.requests.filter(
    (entry) => entry.filePath === request.filePath,
  ).length;
  if (requestCount === 1) {
    await commands.executeCommand('vscode.openWith', uri, REQUEST_EDITOR_VIEW_TYPE);
    return;
  }
  const document = await workspace.openTextDocument(uri);
  const editor = await window.showTextDocument(document, { preview: false });
  const position = new Position(
    request.range.start.line,
    request.range.start.column,
  );
  editor.selection = new Selection(position, position);
  editor.revealRange(new Range(position, position));
}

function findRequestIndex(
  catalog: SourceIntegrationCatalog,
  filePath: string,
  line: number,
): number | undefined {
  return catalog.requests.find(
    (request) =>
      request.filePath === filePath && request.range.start.line === line,
  )?.requestIndex;
}

function findRequestAtOffset(
  catalog: SourceIntegrationCatalog,
  filePath: string,
  offset: number,
): CatalogRequest | undefined {
  return catalog.requests.find((request) => {
    if (request.filePath !== filePath) {
      return false;
    }
    return (
      offset >= request.range.start.offset && offset <= request.range.end.offset
    );
  });
}

function isApiDocument(uri: Uri): boolean {
  return uri.path.toLowerCase().endsWith('.api');
}

async function resolveWorkspaceFile(
  relativePath: string,
  workspaceRoots: readonly string[],
): Promise<Uri | undefined> {
  for (const root of workspaceRoots) {
    const base = Uri.parse(root);
    const candidate = Uri.joinPath(base, ...relativePath.split('/'));
    try {
      await workspace.fs.stat(candidate);
      if (sourcePathMatches(relativePath, candidate.toString(), workspaceRoots)) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}
