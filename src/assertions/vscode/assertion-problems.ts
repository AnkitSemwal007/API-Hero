import {
  Diagnostic,
  DiagnosticCollection,
  DiagnosticSeverity,
  Position,
  Range,
  Uri,
  languages,
  type Disposable,
} from 'vscode';

import { buildAssertionDiagnostics } from '../build-assertion-diagnostics';
import type { TestReport } from '../models';

/**
 * Updates the Problems panel with failed assertion diagnostics after a run.
 * Cleared/replaced per source URI on each evaluation — never on keystroke.
 */
export class AssertionProblemsService implements Disposable {
  private readonly collection: DiagnosticCollection;

  public constructor(
    collection: DiagnosticCollection = languages.createDiagnosticCollection(
      'apiRunner.assertions',
    ),
  ) {
    this.collection = collection;
  }

  public onEvaluated(input: {
    readonly sourceId: string;
    readonly report: TestReport | undefined;
  }): void {
    const uri = uriFromSourceId(input.sourceId);
    if (uri === undefined) {
      return;
    }
    const mapped = buildAssertionDiagnostics(input.report);
    if (mapped.kind === 'clear') {
      this.collection.delete(uri);
      return;
    }

    const diagnostics = mapped.diagnostics.map((descriptor) => {
      const diagnostic = new Diagnostic(
        new Range(
          new Position(descriptor.range.start.line, descriptor.range.start.column),
          new Position(descriptor.range.end.line, descriptor.range.end.column),
        ),
        descriptor.message,
        DiagnosticSeverity.Error,
      );
      diagnostic.source = descriptor.source;
      diagnostic.code = descriptor.code;
      return diagnostic;
    });
    this.collection.set(uri, diagnostics);
  }

  public dispose(): void {
    this.collection.dispose();
  }
}

function uriFromSourceId(sourceId: string): Uri | undefined {
  try {
    return sourceId.includes('://') ? Uri.parse(sourceId) : Uri.file(sourceId);
  } catch {
    return undefined;
  }
}
