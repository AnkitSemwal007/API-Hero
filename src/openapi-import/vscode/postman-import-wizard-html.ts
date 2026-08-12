/**
 * Pure HTML/CSS/JS for the Postman Collection import wizard (no vscode import).
 * Thin wrapper around the shared collection import wizard HTML.
 */

import {
  COLLECTION_IMPORT_WIZARD_STEPS,
  parseCollectionImportWizardMessage,
  renderCollectionImportWizardHtml,
  type CollectionImportWizardCopy,
  type CollectionImportWizardFolder,
  type CollectionImportWizardInboundMessage,
  type CollectionImportWizardPreview,
  type CollectionImportWizardState,
  type CollectionImportWizardStep,
  type CollectionImportWizardSummaryView,
} from './collection-import-wizard-html';

export { escapeAttribute } from './collection-import-wizard-html';

export const POSTMAN_IMPORT_WIZARD_STEPS = COLLECTION_IMPORT_WIZARD_STEPS;

export type PostmanImportWizardStep = CollectionImportWizardStep;
export type PostmanImportWizardFolder = CollectionImportWizardFolder;
export type PostmanImportWizardPreview = CollectionImportWizardPreview;
export type PostmanImportWizardSummaryView = CollectionImportWizardSummaryView;
export type PostmanImportWizardState = CollectionImportWizardState;
export type PostmanImportWizardInboundMessage =
  CollectionImportWizardInboundMessage;

const POSTMAN_COPY: CollectionImportWizardCopy = {
  documentTitle: 'Import Postman Collection',
  heading: 'Import Postman Collection',
  subtitle:
    'Generate a collection from a Postman Collection v2 / v2.1 JSON export.',
  fileStepTitle: 'Collection file',
  fileStepHint:
    'Select a Postman Collection JSON export (v2 / v2.1). Scripts are never executed.',
  pickFileLabel: 'Choose JSON…',
  defaultCollectionLabel: 'Postman',
  defaultFormatLabel: 'postman',
  analyzeErrorFallback: 'Could not analyze collection.',
};

/** Validates webview → extension messages. */
export function parsePostmanImportWizardMessage(
  value: unknown,
): PostmanImportWizardInboundMessage | undefined {
  return parseCollectionImportWizardMessage(value);
}

/** Builds the Postman Import wizard document. */
export function renderPostmanImportWizardHtml(nonce: string): string {
  return renderCollectionImportWizardHtml(nonce, POSTMAN_COPY);
}
