import type { Disposable } from 'vscode';
import { commands } from 'vscode';

import type { Logger } from '../shared';
import type { CommandDefinition } from './command-definition';

/** Registers framework-neutral commands with VS Code. */
export class CommandRegistrar {
  public constructor(private readonly logger: Logger) {}

  /** Registers each command and returns its disposable registration. */
  public register(
    definitions: readonly CommandDefinition[],
  ): readonly Disposable[] {
    return definitions.map((definition) => {
      this.logger.debug('Registering command', { commandId: definition.id });
      return commands.registerCommand(definition.id, definition.execute);
    });
  }
}
