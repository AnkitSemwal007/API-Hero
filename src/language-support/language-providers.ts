import type {
  CompletionItemProvider,
  Disposable,
  DocumentSymbolProvider,
  FoldingRangeProvider,
  HoverProvider,
  TextDocument,
} from 'vscode';
import {
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  DiagnosticRelatedInformation,
  DiagnosticSeverity,
  DocumentSymbol,
  FoldingRange,
  FoldingRangeKind,
  Hover,
  languages,
  Location,
  MarkdownString,
  Position,
  Range,
  SnippetString,
  SymbolKind,
  Uri,
  workspace,
} from 'vscode';

import type { LanguageFeatureSettings } from '../configuration';
import { CONFIGURATION_KEYS, CONFIGURATION_SECTION } from '../constants';
import type { Logger } from '../shared';
import type { VariableResolutionContext } from '../variables';
import {
  API_LANGUAGE_ID,
  LANGUAGE_DIAGNOSTIC_SOURCE,
} from './constants';
import {
  createAuthenticationAvailabilityDiagnostics,
  RuntimeParserAdapter,
  type AuthenticationAvailabilityContext,
  type RuntimeCompletion,
} from './core';

type SettingsAccessor = () => LanguageFeatureSettings;
type AdapterAccessor = (document: TextDocument) => RuntimeParserAdapter;

/** Registers API document providers and returns all owned resources. */
export function registerLanguageProviders(
  getSettings: SettingsAccessor,
  logger: Logger,
  getVariableContext: () => VariableResolutionContext = () => ({ definitions: [] }),
  onVariablesChanged?: (listener: () => void) => Disposable,
  getAuthenticationContext?: () => AuthenticationAvailabilityContext,
): readonly Disposable[] {
  const selector = { language: API_LANGUAGE_ID };
  const diagnostics = languages.createDiagnosticCollection(API_LANGUAGE_ID);
  const adapterCache = new Map<
    string,
    { readonly version: number; readonly adapter: RuntimeParserAdapter }
  >();
  const getAdapter: AdapterAccessor = (document) => {
    const key = document.uri.toString();
    const cached = adapterCache.get(key);
    if (cached?.version === document.version) {
      return cached.adapter;
    }

    const adapter = new RuntimeParserAdapter(
      document.getText(),
      key,
      getVariableContext(),
      undefined,
      getAuthenticationContext?.(),
    );
    adapterCache.set(key, { version: document.version, adapter });
    return adapter;
  };
  const updateDiagnostics = (document: TextDocument): void => {
    void refreshDiagnostics(document);
  };
  const refreshDiagnostics = async (document: TextDocument): Promise<void> => {
    if (document.languageId !== API_LANGUAGE_ID) {
      return;
    }
    if (!getSettings().diagnostics) {
      diagnostics.delete(document.uri);
      return;
    }

    const version = document.version;
    const adapter = getAdapter(document);
    const availability: RuntimeParserAdapter['diagnostics'] =
      await createAuthenticationAvailabilityDiagnostics(
        adapter.document,
        getAuthenticationContext?.(),
      ).catch(() => []);
    if (
      document.version !== version ||
      adapterCache.get(document.uri.toString())?.adapter !== adapter
    ) {
      return;
    }
    diagnostics.set(
      document.uri,
      createDiagnostics(document, [...adapter.diagnostics, ...availability]),
    );
  };

  const registrations: Disposable[] = [
    languages.registerDocumentSymbolProvider(
      selector,
      new ApiDocumentSymbolProvider(getSettings, getAdapter),
    ),
    languages.registerHoverProvider(
      selector,
      new ApiHoverProvider(getSettings, getAdapter),
    ),
    languages.registerCompletionItemProvider(
      selector,
      new ApiCompletionItemProvider(getAdapter),
      '@',
      '{',
      ':',
    ),
    languages.registerFoldingRangeProvider(
      selector,
      new ApiFoldingRangeProvider(getAdapter),
    ),
    workspace.onDidOpenTextDocument(updateDiagnostics),
    workspace.onDidChangeTextDocument((event) => updateDiagnostics(event.document)),
    workspace.onDidCloseTextDocument((document) => {
      adapterCache.delete(document.uri.toString());
      diagnostics.delete(document.uri);
    }),
    workspace.onDidChangeConfiguration((event) => {
      const diagnosticsSetting = `${CONFIGURATION_SECTION}.${CONFIGURATION_KEYS.languageFeatures.diagnostics}`;
      if (event.affectsConfiguration(diagnosticsSetting)) {
        workspace.textDocuments.forEach(updateDiagnostics);
      }
    }),
    diagnostics,
    { dispose: () => adapterCache.clear() },
  ];
  if (onVariablesChanged !== undefined) {
    registrations.push(onVariablesChanged(() => {
      adapterCache.clear();
      workspace.textDocuments.forEach(updateDiagnostics);
    }));
  }

  workspace.textDocuments.forEach(updateDiagnostics);
  logger.debug('Registered API language providers');
  return registrations;
}

class ApiDocumentSymbolProvider implements DocumentSymbolProvider {
  public constructor(
    private readonly getSettings: SettingsAccessor,
    private readonly getAdapter: AdapterAccessor,
  ) {}

  public provideDocumentSymbols(
    document: TextDocument,
  ): DocumentSymbol[] {
    if (!this.getSettings().outline) {
      return [];
    }

    return this.getAdapter(document).getSymbols().map((symbol) => {
      return new DocumentSymbol(
        symbol.name,
        symbol.detail,
        SymbolKind.Function,
        toVsCodeRange(symbol.range),
        toVsCodeRange(symbol.selectionRange),
      );
    });
  }
}

class ApiHoverProvider implements HoverProvider {
  public constructor(
    private readonly getSettings: SettingsAccessor,
    private readonly getAdapter: AdapterAccessor,
  ) {}

  public provideHover(
    document: TextDocument,
    position: Position,
  ): Hover | undefined {
    if (!this.getSettings().hover) {
      return undefined;
    }

    const hover = this.getAdapter(document).getHover(
      toParserPosition(document, position),
    );
    if (hover === undefined) {
      return undefined;
    }

    const contents = new MarkdownString();
    contents.appendCodeblock(hover.key, 'api');
    contents.appendMarkdown(`\n\n${hover.documentation}`);
    return new Hover(contents, toVsCodeRange(hover.range));
  }
}

class ApiCompletionItemProvider implements CompletionItemProvider {
  public constructor(private readonly getAdapter: AdapterAccessor) {}

  public provideCompletionItems(
    document: TextDocument,
    position: Position,
  ): CompletionItem[] {
    return this.getAdapter(document)
      .getCompletions(toParserPosition(document, position))
      .map(createCompletion);
  }
}

class ApiFoldingRangeProvider implements FoldingRangeProvider {
  public constructor(private readonly getAdapter: AdapterAccessor) {}

  public provideFoldingRanges(document: TextDocument): FoldingRange[] {
    return this.getAdapter(document).getFolds().map((fold) => new FoldingRange(
      fold.startLine,
      fold.endLine,
      fold.kind === 'json' ? FoldingRangeKind.Region : undefined,
    ));
  }
}

function createDiagnostics(
  document: TextDocument,
  items: RuntimeParserAdapter['diagnostics'],
): readonly Diagnostic[] {
  return items.map((item) => {
    const diagnostic = new Diagnostic(
      toVsCodeRange(item.range),
      item.message,
      toDiagnosticSeverity(item.severity),
    );
    diagnostic.code = item.code;
    diagnostic.source = LANGUAGE_DIAGNOSTIC_SOURCE;
    diagnostic.relatedInformation = item.relatedInformation?.map(
      (related) => new DiagnosticRelatedInformation(
        new Location(
          related.location.sourceId === undefined
            ? document.uri
            : Uri.parse(related.location.sourceId),
          toVsCodeRange(related.location.range),
        ),
        related.message,
      ),
    );
    return diagnostic;
  });
}

function toParserPosition(
  document: TextDocument,
  position: Position,
): { readonly line: number; readonly column: number; readonly offset: number } {
  return {
    line: position.line,
    column: position.character,
    offset: document.offsetAt(position),
  };
}

function toVsCodeRange(range: {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}): Range {
  return new Range(
    range.start.line,
    range.start.column,
    range.end.line,
    range.end.column,
  );
}

function toDiagnosticSeverity(
  severity: 'error' | 'warning' | 'information' | 'hint',
): DiagnosticSeverity {
  switch (severity) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'warning':
      return DiagnosticSeverity.Warning;
    case 'information':
      return DiagnosticSeverity.Information;
    case 'hint':
      return DiagnosticSeverity.Hint;
  }
}

function createCompletion(suggestion: RuntimeCompletion): CompletionItem {
  switch (suggestion.kind) {
    case 'method': {
      const item = new CompletionItem(suggestion.label, CompletionItemKind.Keyword);
      item.insertText = `${suggestion.label} `;
      item.detail = 'HTTP method';
      return item;
    }
    case 'directive': {
      const item = new CompletionItem(suggestion.label, CompletionItemKind.Keyword);
      item.insertText = new SnippetString(`${suggestion.label} \${1:value}`);
      item.detail = 'API Hero directive';
      return item;
    }
    case 'header': {
      const item = new CompletionItem(suggestion.label, CompletionItemKind.Property);
      item.insertText = new SnippetString(`${suggestion.label}: \${1:value}`);
      item.detail = 'HTTP header';
      return item;
    }
    case 'mime': {
      const item = new CompletionItem(suggestion.label, CompletionItemKind.Value);
      item.detail = 'MIME type';
      return item;
    }
    case 'variable': {
      const item = new CompletionItem(
        suggestion.label,
        CompletionItemKind.Variable,
      );
      item.insertText = `${suggestion.label}}}`;
      item.detail = suggestion.detail ?? 'API Hero variable';
      return item;
    }
    case 'variable-template': {
      const item = new CompletionItem(
        suggestion.label,
        CompletionItemKind.Snippet,
      );
      item.insertText = new SnippetString('{{${1:variable}}}');
      item.detail = 'API Hero variable delimiters';
      return item;
    }
  }
}
