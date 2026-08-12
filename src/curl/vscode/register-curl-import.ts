/**
 * Registers `apiHero.importCurl` (separate from SpecificationImportProvider).
 */

import type { Disposable, ExtensionContext } from 'vscode';

import { registerCommandWithLegacyAlias } from '../../commands';
import { COMMAND_IDS } from '../../constants';
import { runImportCurlCommand } from './import-curl-command';

export interface RegisterCurlImportOptions {
  readonly context: ExtensionContext;
}

export interface CurlImportRegistration {
  readonly disposables: readonly Disposable[];
}

/** Registers Import cURL with legacy `apiRunner.importCurl` alias. */
export function registerCurlImport(
  options: RegisterCurlImportOptions,
): CurlImportRegistration {
  const registration = registerCommandWithLegacyAlias(
    COMMAND_IDS.importCurl,
    async () => {
      await runImportCurlCommand();
    },
  );
  options.context.subscriptions.push(registration);
  return { disposables: [registration] };
}
