/**
 * VS Code WebviewPanel host for the OpenAPI Import multi-step wizard.
 * Uses the shared import wizard host; keeps OpenAPI-specific HTML (URL source).
 */

import type { CollectionDiscoveryService } from '../../collections';
import type { HttpTransport } from '../../execution';
import type { AuthenticationProfile, Environment } from '../../models';
import type { Logger } from '../../shared';
import {
  OpenApiImportProvider,
  type SettingsPatch,
  type WorkspaceFileWriter,
} from '../index';
import { openImportWizardHost } from './import-wizard-host';
import {
  parseOpenApiImportWizardMessage,
  renderOpenApiImportWizardHtml,
} from './openapi-import-wizard-html';

export interface OpenOpenApiImportWizardOptions {
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
  readonly writer: WorkspaceFileWriter;
  readonly readEnvironments: () => readonly Environment[];
  /** Current workspace active environment id (undefined when none). */
  readonly readActiveEnvironmentId: () => string | undefined;
  readonly readAuthProfiles: () => readonly AuthenticationProfile[];
  readonly applySettingsPatch: (patch: SettingsPatch) => Promise<void>;
  /** When false, summary omits the Manage Authentication CTA. */
  readonly manageAuthAvailable?: boolean;
  /**
   * HTTP transport used for URL import. Defaults to NodeHttpTransport in the host.
   * Inject a fake transport in tests.
   */
  readonly transport?: HttpTransport;
}

/**
 * Opens the OpenAPI Import wizard. Resolves when the panel closes.
 * Returns `true` when an import completed successfully.
 */
export async function openOpenApiImportWizard(
  options: OpenOpenApiImportWizardOptions,
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
      panelViewType: 'apiHero.openapiImportWizard',
      panelTitle: 'Import OpenAPI',
      noWorkspaceMessage:
        'Open a workspace folder before importing an OpenAPI specification.',
      sourceMissingMessage:
        'Select an OpenAPI specification file or URL first.',
      analyzeFailureMessage:
        'Specification could not be analyzed for import.',
      fileFilters: {
        'OpenAPI Specification': ['json', 'yaml', 'yml'],
      },
      fileDialogTitle: 'Import OpenAPI Specification',
      openLabel: 'Select',
      provider: new OpenApiImportProvider(),
      renderHtml: renderOpenApiImportWizardHtml,
      parseMessage: parseOpenApiImportWizardMessage,
      logLabel: 'OpenAPI import',
      enableUrlSource: true,
      filePickErrorType: 'error',
      ...(options.transport !== undefined
        ? { transport: options.transport }
        : {}),
      includeUnsupportedCounters: false,
      formatVersionField: 'openapiVersion',
    },
  });
}
