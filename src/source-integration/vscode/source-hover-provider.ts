import type {
  CancellationToken,
  HoverProvider,
  Position,
  TextDocument,
} from 'vscode';
import { Hover, MarkdownString, Range } from 'vscode';

import { API_LANGUAGE_ID } from '../../language-support/constants';
import {
  formatRequestHover,
  parseSourceAnnotations,
  type SourceIntegrationCatalog,
} from '../index';
import { SOURCE_LANGUAGE_IDS } from '../languages';

export class SourceIntegrationHoverProvider implements HoverProvider {
  public constructor(
    private readonly getCatalog: () => SourceIntegrationCatalog,
    private readonly getWorkspaceRoots: () => readonly string[],
  ) {}

  public provideHover(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
  ): Hover | undefined {
    if (token.isCancellationRequested) {
      return undefined;
    }
    if (document.languageId === API_LANGUAGE_ID) {
      return undefined;
    }
    if (!SOURCE_LANGUAGE_IDS.has(document.languageId)) {
      return undefined;
    }
    const sites = parseSourceAnnotations(document.getText());
    const site = sites.find((entry) => entry.line === position.line);
    if (site === undefined) {
      return undefined;
    }
    const resolved = this.getCatalog().resolveFromAnnotations(site.annotations, {
      sourceFilePath: document.uri.toString(),
      workspaceRoots: this.getWorkspaceRoots(),
    });
    if (resolved.kind !== 'match') {
      return undefined;
    }
    const content = formatRequestHover(resolved.request);
    const markdown = new MarkdownString();
    markdown.appendCodeblock(content.title, 'http');
    markdown.appendMarkdown(`\n\n${content.body.replace(/\n/gu, '  \n')}`);
    return new Hover(
      markdown,
      new Range(site.line, 0, site.line, document.lineAt(site.line).text.length),
    );
  }
}
