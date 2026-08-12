/**
 * Registers `apiHero.importPostman` to open the Postman import wizard.
 * Called from `extension.ts` only — keeps activate composition-only.
 */

import type { Disposable, ExtensionContext } from 'vscode';

import { registerCommandWithLegacyAlias } from '../../commands';
import type { CollectionDiscoveryService } from '../../collections';
import { COMMAND_IDS } from '../../constants';
import type { Logger } from '../../shared';
import type { EnvironmentManager } from '../../variables';
import {
  applyImportSettingsPatch,
  createVsCodeWorkspaceWriter,
  readAuthProfilesFromWorkspace,
} from './import-register-shared';
import { openPostmanImportWizard } from './postman-import-wizard';

export interface RegisterPostmanImportOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
  readonly environmentManager: EnvironmentManager;
}

export interface PostmanImportRegistration {
  readonly disposables: readonly Disposable[];
}

/**
 * Registers `apiHero.importPostman` to open the Postman import wizard.
 */
export function registerPostmanImport(
  options: RegisterPostmanImportOptions,
): PostmanImportRegistration {
  const { context, logger, discovery, environmentManager } = options;

  const registration = registerCommandWithLegacyAlias(
    COMMAND_IDS.importPostman,
    async () => {
      await openPostmanImportWizard({
        logger,
        discovery,
        writer: createVsCodeWorkspaceWriter(),
        readEnvironments: () => environmentManager.list(),
        readActiveEnvironmentId: () => environmentManager.activeId,
        readAuthProfiles: readAuthProfilesFromWorkspace,
        applySettingsPatch: applyImportSettingsPatch,
        manageAuthAvailable: true,
      });
    },
  );

  context.subscriptions.push(registration);
  return { disposables: [registration] };
}
