/**
 * Pure HTML/CSS/JS for the Insomnia export import wizard (no vscode import).
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

export const INSOMNIA_IMPORT_WIZARD_STEPS = COLLECTION_IMPORT_WIZARD_STEPS;

export type InsomniaImportWizardStep = CollectionImportWizardStep;
export type InsomniaImportWizardFolder = CollectionImportWizardFolder;
export type InsomniaImportWizardPreview = CollectionImportWizardPreview;
export type InsomniaImportWizardSummaryView = CollectionImportWizardSummaryView;
export type InsomniaImportWizardState = CollectionImportWizardState;
export type InsomniaImportWizardInboundMessage =
  CollectionImportWizardInboundMessage;

const INSOMNIA_COPY: CollectionImportWizardCopy = {
  documentTitle: 'Import Insomnia Export',
  heading: 'Import Insomnia Export',
  subtitle:
    'Generate a collection from an Insomnia export JSON (resource-based v3 / v4).',
  fileStepTitle: 'Export file',
  fileStepHint:
    'Select an Insomnia export JSON file (__export_format 3 or 4). Scripts are never executed.',
  pickFileLabel: 'Choose JSON…',
  defaultCollectionLabel: 'Insomnia',
  defaultFormatLabel: 'insomnia',
  analyzeErrorFallback: 'Could not analyze Insomnia export.',
};

/** Validates webview → extension messages. */
export function parseInsomniaImportWizardMessage(
  value: unknown,
): InsomniaImportWizardInboundMessage | undefined {
  return parseCollectionImportWizardMessage(value);
}

/** Builds the Insomnia Import wizard document. */
export function renderInsomniaImportWizardHtml(nonce: string): string {
  return renderCollectionImportWizardHtml(nonce, INSOMNIA_COPY);
}
