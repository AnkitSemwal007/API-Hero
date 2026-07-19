import type { CommandId } from '../constants';

/** Framework-neutral definition of an extension command. */
export interface CommandDefinition {
  readonly id: CommandId;
  readonly execute: (...args: readonly unknown[]) => unknown;
}
