import { commands, type Disposable } from 'vscode';

import { toLegacyCommandId } from '../constants';

/**
 * Registers a command under its canonical id and, when the id is under the
 * `apiHero.*` namespace, also under the matching `apiRunner.*` legacy alias so
 * existing user keybindings keep working.
 */
export function registerCommandWithLegacyAlias(
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors vscode.registerCommand
  callback: (...args: any[]) => any,
): Disposable {
  const primary = commands.registerCommand(id, callback);
  const legacyId = toLegacyCommandId(id);
  if (legacyId === undefined || legacyId === id) {
    return primary;
  }
  const legacy = commands.registerCommand(legacyId, callback);
  return {
    dispose(): void {
      primary.dispose();
      legacy.dispose();
    },
  };
}
