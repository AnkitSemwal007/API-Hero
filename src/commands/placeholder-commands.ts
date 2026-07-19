import { COMMAND_IDS } from '../constants';
import type { CommandDefinition } from './command-definition';

const NOT_IMPLEMENTED = 'Not implemented';

/** Creates the remaining placeholder commands still contributed by the manifest. */
export function createPlaceholderCommands(): readonly CommandDefinition[] {
  return [
    { id: COMMAND_IDS.runFile, execute: () => NOT_IMPLEMENTED },
    { id: COMMAND_IDS.login, execute: () => NOT_IMPLEMENTED },
    { id: COMMAND_IDS.logout, execute: () => NOT_IMPLEMENTED },
  ];
}
