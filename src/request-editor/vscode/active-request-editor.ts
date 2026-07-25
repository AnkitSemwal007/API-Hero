/**
 * Tracks the Custom Text Editor panel that is currently active.
 * Run Request / Reveal Active Request fall back to this when no text editor
 * with language `api` has focus.
 */

import type { TextDocument } from 'vscode';

let activeDocument: TextDocument | undefined;

/** Records the Request Editor document when its webview panel becomes active. */
export function setActiveRequestEditorDocument(
  document: TextDocument,
): void {
  activeDocument = document;
}

/**
 * Clears the tracker when the panel is disposed or becomes inactive.
 * When `document` is provided, clears only if it is the currently tracked one
 * (avoids a newly-active panel being wiped by a stale dispose).
 */
export function clearActiveRequestEditorDocument(
  document?: TextDocument,
): void {
  if (document === undefined || activeDocument === document) {
    activeDocument = undefined;
  }
}

/** Active Request Editor document, if any. */
export function getActiveRequestEditorDocument(): TextDocument | undefined {
  if (activeDocument?.isClosed === true) {
    activeDocument = undefined;
  }
  return activeDocument;
}
