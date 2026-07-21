import {
  Position,
  Selection,
  Uri,
  commands,
  window,
  workspace,
  type Disposable,
  type TextEditor,
} from 'vscode';

import type { CollectionDiscoveryService } from '../discovery';
import {
  buildNavigationIndex,
  findRequestAtOffset,
  findRequestById,
  type NavigationIndex,
} from '../navigation';
import type { CollectionTreeNode, RequestReference } from '../index';
import { REQUEST_EDITOR_VIEW_TYPE } from '../../constants';
import type { CollectionTreeDataProvider } from './collection-tree-provider';

const REVEAL_DEBOUNCE_MS = 200;

/**
 * Opens `.api` requests from the tree and keeps the tree selection in sync
 * with the active editor — debounced so typing does not thrash reveal.
 */
export class CollectionNavigationService implements Disposable {
  private index: NavigationIndex = { byFile: {} };
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly subscriptions: Disposable[] = [];
  private revealing = false;

  public constructor(
    private readonly discovery: CollectionDiscoveryService,
    private readonly tree: CollectionTreeDataProvider,
  ) {
    this.rebuildIndex();
    this.subscriptions.push(
      discovery.onDidChange(() => {
        this.rebuildIndex();
      }),
      window.onDidChangeActiveTextEditor((editor) => {
        this.scheduleReveal(editor);
      }),
      window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === window.activeTextEditor) {
          this.scheduleReveal(event.textEditor);
        }
      }),
    );
  }

  public dispose(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  /** Opens the request file — form editor for single-request files. */
  public async openRequest(
    target: CollectionTreeNode | RequestReference | string,
  ): Promise<void> {
    const request = this.resolveRequest(target);
    if (request === undefined) {
      void window.showWarningMessage('API Hero could not find that request.');
      return;
    }

    const uri = Uri.parse(request.filePath);
    const requestCount = this.countRequestsInFile(request.filePath);

    if (requestCount === 1) {
      this.revealing = true;
      try {
        await commands.executeCommand(
          'vscode.openWith',
          uri,
          REQUEST_EDITOR_VIEW_TYPE,
        );
        await this.tree.revealRequest(request.id);
      } finally {
        this.revealing = false;
      }
      return;
    }

    const document = await workspace.openTextDocument(uri);
    const editor = await window.showTextDocument(document, { preview: false });
    const position = new Position(
      request.range.start.line,
      request.range.start.column,
    );
    this.revealing = true;
    try {
      editor.selection = new Selection(position, position);
      editor.revealRange(editor.selection);
      await this.tree.revealRequest(request.id);
    } finally {
      this.revealing = false;
    }
  }

  private countRequestsInFile(filePath: string): number {
    const aggregate = this.discovery.snapshot;
    if (aggregate === undefined) {
      return 0;
    }
    let count = 0;
    for (const collection of Object.values(aggregate.collections)) {
      for (const request of Object.values(collection.requests)) {
        if (request.filePath === filePath) {
          count += 1;
        }
      }
    }
    return count;
  }

  /** Reveals the request under the active editor cursor in the tree. */
  public async revealActiveRequest(): Promise<void> {
    const editor = window.activeTextEditor;
    if (editor === undefined || !isApiDocument(editor)) {
      void window.showInformationMessage(
        'Open an API Hero (.api) file to reveal the active request.',
      );
      return;
    }
    const request = this.requestForEditor(editor);
    if (request === undefined) {
      void window.showInformationMessage(
        'Place the cursor inside a request to reveal it in Collections.',
      );
      return;
    }
    const revealed = await this.tree.revealRequest(request.id);
    if (!revealed) {
      void window.showInformationMessage(
        'The active request is not present in the Collections tree yet. Try Refresh Collections.',
      );
    }
  }

  private resolveRequest(
    target: CollectionTreeNode | RequestReference | string,
  ): RequestReference | undefined {
    if (typeof target === 'string') {
      const aggregate = this.discovery.snapshot;
      return aggregate === undefined
        ? undefined
        : findRequestById(aggregate, target);
    }
    if ('filePath' in target && 'range' in target) {
      return target;
    }
    if (target.requestId !== undefined) {
      const aggregate = this.discovery.snapshot;
      return aggregate === undefined
        ? undefined
        : findRequestById(aggregate, target.requestId);
    }
    return undefined;
  }

  private rebuildIndex(): void {
    const aggregate = this.discovery.snapshot;
    this.index =
      aggregate === undefined ? { byFile: {} } : buildNavigationIndex(aggregate);
  }

  private scheduleReveal(editor: TextEditor | undefined): void {
    if (this.revealing || editor === undefined || !isApiDocument(editor)) {
      return;
    }
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.revealEditorRequest(editor);
    }, REVEAL_DEBOUNCE_MS);
  }

  private async revealEditorRequest(editor: TextEditor): Promise<void> {
    if (this.revealing || window.activeTextEditor !== editor) {
      return;
    }
    const request = this.requestForEditor(editor);
    if (request === undefined) {
      return;
    }
    this.revealing = true;
    try {
      await this.tree.revealRequest(request.id);
    } finally {
      this.revealing = false;
    }
  }

  private requestForEditor(editor: TextEditor): RequestReference | undefined {
    const offset = editor.document.offsetAt(editor.selection.active);
    return findRequestAtOffset(
      this.index,
      editor.document.uri.toString(),
      offset,
    );
  }
}

function isApiDocument(editor: TextEditor): boolean {
  return (
    editor.document.languageId === 'api' ||
    editor.document.uri.path.toLowerCase().endsWith('.api')
  );
}
