/**
 * One-shot (ephemeral) authentication binding for a single execution.
 * Never serialized into `.api` / `@auth` / settings.
 */

import type { AuthenticationKind } from '../models';

/** Runtime-only credential material for one Send. */
export interface EphemeralAuthenticationBinding {
  readonly providerId: Exclude<AuthenticationKind, 'none'>;
  /** Field → cleartext value (cleared after execution by the host). */
  readonly material: Readonly<Record<string, string>>;
  /** Required when providerId is apiKey. */
  readonly apiKeyName?: string;
  readonly apiKeyLocation?: 'header' | 'query';
}

/**
 * Host-side slot holding at most one pending one-shot binding.
 * Cleared after the orchestrator finishes authentication resolution.
 */
export class EphemeralAuthenticationSlot {
  private binding: EphemeralAuthenticationBinding | undefined;

  public set(binding: EphemeralAuthenticationBinding | undefined): void {
    this.binding = binding === undefined
      ? undefined
      : Object.freeze({
          providerId: binding.providerId,
          material: Object.freeze({ ...binding.material }),
          ...(binding.apiKeyName !== undefined
            ? { apiKeyName: binding.apiKeyName }
            : {}),
          ...(binding.apiKeyLocation !== undefined
            ? { apiKeyLocation: binding.apiKeyLocation }
            : {}),
        });
  }

  public peek(): EphemeralAuthenticationBinding | undefined {
    return this.binding;
  }

  /** Takes and clears the pending binding. */
  public take(): EphemeralAuthenticationBinding | undefined {
    const current = this.binding;
    this.binding = undefined;
    return current;
  }

  public clear(): void {
    this.binding = undefined;
  }
}
