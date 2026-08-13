import {
  EventEmitter,
  type CancellationToken,
  type CodeLensProvider,
  type Event,
  type TextDocument,
} from 'vscode';
import { CodeLens, Position, Range } from 'vscode';

import { normalizePathKey } from '../../collections/models';
import { API_LANGUAGE_ID } from '../../language-support/constants';
import {
  createApiFileSourceCodeLensDescriptors,
  createSourceFileCodeLensDescriptors,
  type SourceIntegrationCatalog,
} from '../index';
import { SOURCE_LANGUAGE_IDS } from '../languages';

export class SourceIntegrationCodeLensProvider implements CodeLensProvider {
  private readonly didChange = new EventEmitter<void>();

  public constructor(
    private readonly getCatalog: () => SourceIntegrationCatalog,
    private readonly getWorkspaceRoots: () => readonly string[],
  ) {}

  public get onDidChangeCodeLenses(): Event<void> {
    return this.didChange.event;
  }

  public refresh(): void {
    this.didChange.fire();
  }

  public provideCodeLenses(
    document: TextDocument,
    token: CancellationToken,
  ): CodeLens[] {
    if (token.isCancellationRequested) {
      return [];
    }
    const catalog = this.getCatalog();
    const roots = this.getWorkspaceRoots();
    if (document.languageId === API_LANGUAGE_ID) {
      return this.apiFileLenses(document, catalog);
    }
    if (!SOURCE_LANGUAGE_IDS.has(document.languageId)) {
      return [];
    }
    const descriptors = createSourceFileCodeLensDescriptors(
      document.getText(),
      catalog,
      {
        sourceFilePath: document.uri.toString(),
        workspaceRoots: roots,
      },
    );
    if (token.isCancellationRequested) {
      return [];
    }
    return descriptors.map((descriptor) => new CodeLens(
      new Range(
        new Position(descriptor.line, descriptor.character),
        new Position(descriptor.line, descriptor.character + 1),
      ),
      {
        command: descriptor.command.id,
        title: descriptor.command.title,
        arguments: [descriptor.command.argument],
      },
    ));
  }

  private apiFileLenses(
    document: TextDocument,
    catalog: SourceIntegrationCatalog,
  ): CodeLens[] {
    const pathKey = document.uri.toString();
    const lenses: CodeLens[] = [];
    for (const request of catalog.requests) {
      if (normalizePathKey(request.filePath) !== normalizePathKey(pathKey)) {
        continue;
      }
      for (const descriptor of createApiFileSourceCodeLensDescriptors(request)) {
        lenses.push(
          new CodeLens(
            new Range(
              new Position(descriptor.line, descriptor.character),
              new Position(descriptor.line, descriptor.character + 1),
            ),
            {
              command: descriptor.command.id,
              title: descriptor.command.title,
              arguments: [descriptor.command.argument],
            },
          ),
        );
      }
    }
    return lenses;
  }
}
