/**
 * Inserts an `@extract` / `@sensitive-extract` directive into a `.api` source
 * immediately before the selected request's METHOD line (document-level form).
 */

import { Uri, WorkspaceEdit, workspace, type TextDocument } from 'vscode';

import { parseRequestKey } from '../extraction';
import { parseApiDocument } from '../parser';
import {
  formatExtractionRule,
  type RequestSourceExtractionRule,
} from '../request-source';

export interface InsertExtractionRuleInput {
  readonly sourceId: string;
  readonly requestKey: string;
  readonly rule: RequestSourceExtractionRule;
}

export type InsertExtractionRuleResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Persists a Mode B extraction rule into the active request's `.api` source.
 */
export async function insertExtractionRuleIntoSource(
  input: InsertExtractionRuleInput,
): Promise<InsertExtractionRuleResult> {
  const line = formatExtractionRule(input.rule);
  if (line === undefined) {
    return { ok: false, message: 'Extraction rule is empty or disabled.' };
  }

  const parsedKey = parseRequestKey(input.requestKey);
  if (parsedKey === undefined) {
    return { ok: false, message: 'Invalid request identity for extraction.' };
  }

  let document: TextDocument;
  try {
    document = await workspace.openTextDocument(Uri.parse(input.sourceId));
  } catch {
    try {
      document = await workspace.openTextDocument(Uri.file(input.sourceId));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not open request source.';
      return { ok: false, message };
    }
  }

  const text = document.getText();
  const parsed = parseApiDocument(text, { sourceId: input.sourceId });
  const request = parsed.ast.requests[parsedKey.index];
  if (request === undefined) {
    return {
      ok: false,
      message: `Request index ${parsedKey.index} was not found in the source.`,
    };
  }

  const insertPosition = document.positionAt(request.range.start.offset);
  const edit = new WorkspaceEdit();
  edit.insert(document.uri, insertPosition, `${line}\n`);

  const applied = await workspace.applyEdit(edit);
  if (!applied) {
    return { ok: false, message: 'Could not apply the extraction rule edit.' };
  }
  return { ok: true };
}

/** Formats the insert payload without touching the workspace (unit tests). */
export function buildExtractionRuleInsertText(
  rule: RequestSourceExtractionRule,
): string | undefined {
  const line = formatExtractionRule(rule);
  return line === undefined ? undefined : `${line}\n`;
}
