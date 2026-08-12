/**
 * Registers `apiHero.importInsomnia` to open the Insomnia import wizard.
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
import { openInsomniaImportWizard } from './insomnia-import-wizard';

export interface RegisterInsomniaImportOptions {
  readonly context: ExtensionContext;
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
  readonly environmentManager: EnvironmentManager;
}

export interface InsomniaImportRegistration {
  readonly disposables: readonly Disposable[];
}

/**
 * Registers `apiHero.importInsomnia` to open the Insomnia import wizard.
 */
export function registerInsomniaImport(
  options: RegisterInsomniaImportOptions,
): InsomniaImportRegistration {
  const { context, logger, discovery, environmentManager } = options;

  const registration = registerCommandWithLegacyAlias(
    COMMAND_IDS.importInsomnia,
    async () => {
      await openInsomniaImportWizard({
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
