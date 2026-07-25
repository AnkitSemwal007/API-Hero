import type { VariableDefinition } from '../models';
import type { RuntimeOverlayIdentity, VariableWriteRequest } from './models';

/**
 * Ephemeral document-scope values keyed by request identity.
 * P0: in-memory only; not consulted by VariableResolver until Phase 1.
 */
export interface RuntimeVariableOverlay {
  set(identity: RuntimeOverlayIdentity, write: VariableWriteRequest): void;
  getDefinitions(identity: RuntimeOverlayIdentity): readonly VariableDefinition[];
  clear(identity?: RuntimeOverlayIdentity): void;
}

export class InMemoryRuntimeVariableOverlay implements RuntimeVariableOverlay {
  private readonly byRequest = new Map<string, Map<string, VariableDefinition>>();

  public set(identity: RuntimeOverlayIdentity, write: VariableWriteRequest): void {
    if (write.scope !== 'document') {
      return;
    }

    let vars = this.byRequest.get(identity.requestKey);
    if (!vars) {
      vars = new Map();
      this.byRequest.set(identity.requestKey, vars);
    }

    vars.set(write.name, {
      name: write.name,
      value: write.value,
      scope: 'document',
      sensitive: write.sensitive,
    });
  }

  public getDefinitions(identity: RuntimeOverlayIdentity): readonly VariableDefinition[] {
    const vars = this.byRequest.get(identity.requestKey);
    if (!vars) {
      return [];
    }
    return Array.from(vars.values());
  }

  public clear(identity?: RuntimeOverlayIdentity): void {
    if (identity === undefined) {
      this.byRequest.clear();
      return;
    }
    this.byRequest.delete(identity.requestKey);
  }
}
