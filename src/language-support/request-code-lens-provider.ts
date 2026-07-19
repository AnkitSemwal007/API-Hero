import type {
  CancellationToken,
  CodeLensProvider,
  TextDocument,
} from 'vscode';
import { CodeLens, Position, Range } from 'vscode';

import { parseApiDocument } from '../parser';
import { safeRequestCodeLensDescriptors } from './core/request-code-lens';

/** VS Code projection of canonical parser request nodes into Run lenses. */
export class ApiRequestCodeLensProvider implements CodeLensProvider {
  public provideCodeLenses(
    document: TextDocument,
    token: CancellationToken,
  ): CodeLens[] {
    const uri = document.uri.toString();
    const text = document.getText();
    return safeRequestCodeLensDescriptors(
      () => parseApiDocument(text, { sourceId: uri }).ast,
      uri,
      () => token.isCancellationRequested,
      text,
    ).map((descriptor) => new CodeLens(
      new Range(
        new Position(
          descriptor.range.start.line,
          descriptor.range.start.column,
        ),
        new Position(
          descriptor.range.end.line,
          descriptor.range.end.column,
        ),
      ),
      {
        command: descriptor.command.id,
        title: descriptor.command.title,
        arguments: [descriptor.command.argument],
      },
    ));
  }
}
