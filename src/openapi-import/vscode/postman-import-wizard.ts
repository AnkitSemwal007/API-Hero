/**
 * VS Code WebviewPanel host for the Postman Collection import wizard.
 * Uses the shared import wizard host with a forced Postman provider.
 */

import type { CollectionDiscoveryService } from '../../collections';
import type { AuthenticationProfile, Environment } from '../../models';
import type { Logger } from '../../shared';
import {
  PostmanImportProvider,
  type SettingsPatch,
  type WorkspaceFileWriter,
} from '../index';
import { openImportWizardHost } from './import-wizard-host';
import {
  parsePostmanImportWizardMessage,
  renderPostmanImportWizardHtml,
} from './postman-import-wizard-html';

export interface OpenPostmanImportWizardOptions {
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
 * Opens the Postman Import wizard. Resolves when the panel closes.
 * Returns `true` when an import completed successfully.
 */
export async function openPostmanImportWizard(
  options: OpenPostmanImportWizardOptions,
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
      panelViewType: 'apiHero.postmanImportWizard',
      panelTitle: 'Import Postman Collection',
      noWorkspaceMessage:
        'Open a workspace folder before importing a Postman collection.',
      sourceMissingMessage: 'Select a Postman Collection JSON file first.',
      analyzeFailureMessage: 'Collection could not be analyzed for import.',
      fileFilters: { 'Postman Collection JSON': ['json'] },
      openLabel: 'Import',
      provider: new PostmanImportProvider(),
      renderHtml: renderPostmanImportWizardHtml,
      parseMessage: parsePostmanImportWizardMessage,
      unsupportedCodePrefix: 'postman-unsupported',
      scriptWarningCode: 'postman-unsupported-script',
      logLabel: 'Postman import',
      includeUnsupportedCounters: true,
      formatVersionField: 'formatVersion',
    },
  });
}
