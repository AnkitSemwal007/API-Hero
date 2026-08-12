/**
 * VS Code WebviewPanel host for the Insomnia export import wizard.
 * Uses the shared import wizard host with a forced Insomnia provider.
 */

import type { CollectionDiscoveryService } from '../../collections';
import type { AuthenticationProfile, Environment } from '../../models';
import type { Logger } from '../../shared';
import {
  InsomniaImportProvider,
  type SettingsPatch,
  type WorkspaceFileWriter,
} from '../index';
import { openImportWizardHost } from './import-wizard-host';
import {
  parseInsomniaImportWizardMessage,
  renderInsomniaImportWizardHtml,
} from './insomnia-import-wizard-html';

export interface OpenInsomniaImportWizardOptions {
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
  readonly writer: WorkspaceFileWriter;
  readonly readEnvironments: () => readonly Environment[];
  readonly readActiveEnvironmentId: () => string | undefined;
  readonly readAuthProfiles: () => readonly AuthenticationProfile[];
  readonly applySettingsPatch: (patch: SettingsPatch) => Promise<void>;
  readonly manageAuthAvailable?: boolean;
}

/**
 * Opens the Insomnia Import wizard. Resolves when the panel closes.
 * Returns `true` when an import completed successfully.
 */
export async function openInsomniaImportWizard(
  options: OpenInsomniaImportWizardOptions,
): Promise<boolean> {
  return openImportWizardHost({
    logger: options.logger,
    discovery: options.discovery,
    writer: options.writer,
    readEnvironments: options.readEnvironments,
    readActiveEnvironmentId: options.readActiveEnvironmentId,
    readAuthProfiles: options.readAuthProfiles,
    applySettingsPatch: options.applySettingsPatch,
    manageAuthAvailable: options.manageAuthAvailable,
    format: {
      panelViewType: 'apiHero.insomniaImportWizard',
      panelTitle: 'Import Insomnia Export',
      noWorkspaceMessage:
        'Open a workspace folder before importing an Insomnia export.',
      sourceMissingMessage: 'Select an Insomnia export JSON file first.',
      analyzeFailureMessage: 'Export could not be analyzed for import.',
      fileFilters: { 'Insomnia Export JSON': ['json'] },
      openLabel: 'Import',
      provider: new InsomniaImportProvider(),
      renderHtml: renderInsomniaImportWizardHtml,
      parseMessage: parseInsomniaImportWizardMessage,
      unsupportedCodePrefix: 'insomnia-unsupported',
      scriptWarningCode: 'insomnia-unsupported-script',
      logLabel: 'Insomnia import',
      includeUnsupportedCounters: true,
      formatVersionField: 'formatVersion',
    },
  });
}
