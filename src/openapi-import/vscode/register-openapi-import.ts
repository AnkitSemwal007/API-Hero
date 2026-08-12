/**
 * Registers `apiHero.importOpenApi` to open the multi-step import wizard.
 * Called from `extension.ts` only — keeps activate composition-only.
 */

import type { Disposable, ExtensionContext } from 'vscode';

import { registerCommandWithLegacyAlias } from '../../commands';
import type { CollectionDiscoveryService } from '../../collections';
import { COMMAND_IDS } from '../../constants';
import { NodeHttpTransport } from '../../execution';
import type { Logger } from '../../shared';
import type { EnvironmentManager } from '../../variables';
import {
  applyImportSettingsPatch,
  createVsCodeWorkspaceWriter,
  readAuthProfilesFromWorkspace,
} from './import-register-shared';
import { openOpenApiImportWizard } from './openapi-import-wizard';

export interface RegisterOpenApiImportOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
  readonly environmentManager: EnvironmentManager;
}

export interface OpenApiImportRegistration {
  readonly disposables: readonly Disposable[];
}

/**
 * Registers `apiHero.importOpenApi` to open the multi-step import wizard.
 */
export function registerOpenApiImport(
  options: RegisterOpenApiImportOptions,
): OpenApiImportRegistration {
  const { context, logger, discovery, environmentManager } = options;

  const registration = registerCommandWithLegacyAlias(
    COMMAND_IDS.importOpenApi,
    async () => {
      await openOpenApiImportWizard({
        logger,
        discovery,
        writer: createVsCodeWorkspaceWriter(),
        // Same source as active id (project-aware EnvironmentManager), not
        // settings-only — keeps append + activate gating consistent.
        readEnvironments: () => environmentManager.list(),
        readActiveEnvironmentId: () => environmentManager.activeId,
        readAuthProfiles: readAuthProfilesFromWorkspace,
        applySettingsPatch: applyImportSettingsPatch,
        manageAuthAvailable: true,
        transport: new NodeHttpTransport(),
      });
    },
  );

  context.subscriptions.push(registration);
  return { disposables: [registration] };
}
