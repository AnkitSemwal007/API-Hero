import type { SecretStorage } from 'vscode';

import type { Disposable } from '../configuration';
import type { SecretStore } from './stores';

/**
 * The only adapter allowed to touch VS Code SecretStorage. It deliberately
 * exposes no enumeration API, so raw secret values cannot be listed.
 */
export class SecretStorageService implements SecretStore {
  public constructor(private readonly storage: SecretStorage) {}

  public async get(key: string): Promise<string | undefined> {
    return this.storage.get(key);
  }

  public async set(key: string, value: string): Promise<void> {
    await this.storage.store(key, value);
  }

  public async delete(key: string): Promise<void> {
    await this.storage.delete(key);
  }

  public onDidChange(listener: () => void): Disposable {
    return this.storage.onDidChange((event) => {
      if (event.key.startsWith('apiRunner.auth.profile.')) {
        listener();
      }
    });
  }
}
