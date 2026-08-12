/**
 * VS Code UX for Import cURL → `.api`.
 * Separate command path (not a SpecificationImportProvider).
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import {
  Uri,
  env,
  window,
  workspace,
  type TextEditor,
} from 'vscode';

import {
  buildCurlPreview,
  looksLikeCurl,
  parseCurl,
  suggestCurlFileName,
  type CurlParseSuccess,
} from '..';
import { serializeRequestDocument } from '../../request-source';

type ImportSource = 'clipboard' | 'paste' | 'selection' | 'file';

/**
 * Runs the Import cURL flow: source → parse → preview → create `.api`.
 */
export async function runImportCurlCommand(): Promise<void> {
  const source = await pickSource();
  if (source === undefined) {
    return;
  }

  const text = await readCurlText(source);
  if (text === undefined) {
    return;
  }

  const parsed = parseCurl(text);
  if (!parsed.ok) {
    const detail = parsed.errors.map((e: { message: string }) => e.message).join('\n');
    await window.showErrorMessage(`cURL import failed:\n${detail}`);
    return;
  }

  const proceed = await showPreviewAndConfirm(parsed);
  if (!proceed) {
    return;
  }

  const target = await pickDestination(parsed);
  if (target === undefined) {
    return;
  }

  const content = serializeRequestDocument(parsed.document);
  const encoder = new TextEncoder();
  await workspace.fs.writeFile(target, encoder.encode(content));
  const document = await workspace.openTextDocument(target);
  await window.showTextDocument(document);
  window.setStatusBarMessage(`Created ${target.fsPath}`, 4000);
}

async function pickSource(): Promise<ImportSource | undefined> {
  const editor = window.activeTextEditor;
  const selectionLooksLikeCurl =
    editor !== undefined &&
    !editor.selection.isEmpty &&
    looksLikeCurl(editor.document.getText(editor.selection));

  const items: {
    label: string;
    description?: string;
    source: ImportSource;
  }[] = [
    {
      label: '$(clippy) Paste from clipboard',
      description: 'Read multiline curl from the clipboard',
      source: 'clipboard',
    },
    {
      label: '$(edit) Type or paste one line',
      description: 'Short curl command in an input box',
      source: 'paste',
    },
    {
      label: '$(selection) Use editor selection',
      description: selectionLooksLikeCurl
        ? 'Selection looks like curl'
        : 'Parse the current selection',
      source: 'selection',
    },
    {
      label: '$(file) Open file…',
      description: 'Choose a text file containing curl',
      source: 'file',
    },
  ];

  const picked = await window.showQuickPick(items, {
    title: 'API Hero: Import cURL',
    placeHolder: 'How do you want to provide the cURL command?',
    ignoreFocusOut: true,
  });
  return picked?.source;
}

async function readCurlText(
  source: ImportSource,
): Promise<string | undefined> {
  if (source === 'clipboard') {
    const value = await env.clipboard.readText();
    if (value.trim().length === 0) {
      await window.showErrorMessage('Clipboard is empty.');
      return undefined;
    }
    return value;
  }

  if (source === 'paste') {
    const value = await window.showInputBox({
      title: 'Paste cURL',
      prompt: 'Paste a curl command (never executed; parsed in-process only)',
      placeHolder: "curl 'https://api.example.com/…' -H 'Accept: application/json'",
      ignoreFocusOut: true,
    });
    return value === undefined ? undefined : value;
  }

  if (source === 'selection') {
    const editor = window.activeTextEditor;
    if (editor === undefined || editor.selection.isEmpty) {
      await window.showErrorMessage(
        'Select a curl command in the editor, then try again.',
      );
      return undefined;
    }
    return editor.document.getText(editor.selection);
  }

  const picked = await window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      'cURL / text': ['txt', 'curl', 'sh', 'bash', 'zsh', 'http'],
      'All files': ['*'],
    },
    openLabel: 'Import cURL',
    title: 'Open file containing cURL',
  });
  if (picked === undefined || picked.length === 0) {
    return undefined;
  }
  const bytes = await workspace.fs.readFile(picked[0]!);
  return Buffer.from(bytes).toString('utf8');
}

async function showPreviewAndConfirm(
  parsed: CurlParseSuccess,
): Promise<boolean> {
  const preview = buildCurlPreview(parsed);
  const lines = [
    `${preview.method} ${preview.url}`,
    `Headers: ${preview.headerCount}`,
    `Body: ${preview.bodyKind}`,
  ];
  if (preview.maskedHeaders.length > 0) {
    const shown = preview.maskedHeaders.slice(0, 5).map((h) => `${h.name}: ${h.value}`);
    lines.push(
      `Header values: ${shown.join(' | ')}${
        preview.maskedHeaders.length > 5 ? '…' : ''
      }`,
    );
  }
  if (preview.authNotes.length > 0) {
    lines.push(`Auth: ${preview.authNotes.join('; ')}`);
  }
  if (preview.warnings.length > 0) {
    lines.push(
      `Warnings (${preview.warnings.length}): ${preview.warnings.slice(0, 3).join(' | ')}${
        preview.warnings.length > 3 ? '…' : ''
      }`,
    );
  }

  const choice = await window.showInformationMessage(
    `Import cURL preview\n${lines.join('\n')}`,
    { modal: true },
    'Create .api',
    'Cancel',
  );
  return choice === 'Create .api';
}

async function pickDestination(
  parsed: CurlParseSuccess,
): Promise<Uri | undefined> {
  const defaultName = suggestCurlFileName(parsed.document);
  const folder = workspace.workspaceFolders?.[0];
  const defaultUri =
    folder !== undefined
      ? Uri.joinPath(folder.uri, 'Collections', defaultName)
      : Uri.file(join(process.cwd(), defaultName));

  const uri = await window.showSaveDialog({
    defaultUri,
    filters: { 'API Hero Request': ['api'] },
    saveLabel: 'Create .api',
    title: 'Save imported request',
  });
  if (uri === undefined) {
    return undefined;
  }

  if (!uri.fsPath.toLowerCase().endsWith('.api')) {
    await window.showErrorMessage('Destination must be a .api file.');
    return undefined;
  }

  // Path safety: reject empty / odd schemes; require workspace containment when available.
  if (!isSafeDestination(uri)) {
    await window.showErrorMessage(
      'Destination path is not allowed. Choose a file under the workspace.',
    );
    return undefined;
  }

  const folders = workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    const proceedOutside = await window.showWarningMessage(
      `No workspace folder is open. The file will be written to:\n${uri.fsPath}\nContinue?`,
      { modal: true },
      'Write anyway',
      'Cancel',
    );
    if (proceedOutside !== 'Write anyway') {
      return undefined;
    }
  }

  if (existsSync(uri.fsPath)) {
    const overwrite = await window.showWarningMessage(
      `File already exists:\n${uri.fsPath}\nOverwrite?`,
      { modal: true },
      'Overwrite',
      'Cancel',
    );
    if (overwrite !== 'Overwrite') {
      return undefined;
    }
  } else {
    // Ensure parent directory exists via VS Code FS when possible.
    const parent = dirname(uri.fsPath);
    try {
      await workspace.fs.createDirectory(Uri.file(parent));
    } catch {
      // Parent may already exist; writeFile will surface real errors.
    }
  }

  return uri;
}

function isSafeDestination(uri: Uri): boolean {
  if (uri.scheme !== 'file') {
    return false;
  }
  if (uri.fsPath.includes('\0')) {
    return false;
  }
  const folders = workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    return true;
  }
  const target = resolve(uri.fsPath);
  return folders.some((folder) => {
    const root = resolve(folder.uri.fsPath);
    if (process.platform === 'win32') {
      const t = target.toLowerCase();
      const r = root.toLowerCase();
      return t === r || t.startsWith(r + sep.toLowerCase());
    }
    return target === root || target.startsWith(root + sep);
  });
}

/** Optional: import from selection when it looks like curl (editor context). */
export function selectionLooksLikeCurl(editor: TextEditor | undefined): boolean {
  if (editor === undefined || editor.selection.isEmpty) {
    return false;
  }
  return looksLikeCurl(editor.document.getText(editor.selection));
}
