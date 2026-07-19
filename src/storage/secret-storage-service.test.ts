import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SecretStorage, SecretStorageChangeEvent } from 'vscode';

import { SecretStorageService } from './secret-storage-service';

class FakeSecretStorage implements SecretStorage {
  public readonly map = new Map<string, string>();
  private readonly listeners = new Set<(event: SecretStorageChangeEvent) => void>();

  public async get(key: string): Promise<string | undefined> {
    return this.map.get(key);
  }

  public async store(key: string, value: string): Promise<void> {
    this.map.set(key, value);
    this.emit(key);
  }

  public async delete(key: string): Promise<void> {
    this.map.delete(key);
    this.emit(key);
  }

  public async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }

  public onDidChange(
    listener: (event: SecretStorageChangeEvent) => void,
  ): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  public emit(key: string): void {
    const event = { key } as SecretStorageChangeEvent;
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

test('get set and delete round-trip through SecretStorageService', async () => {
  const storage = new FakeSecretStorage();
  const service = new SecretStorageService(storage);

  assert.equal(await service.get('apiRunner.auth.profile.demo'), undefined);
  await service.set('apiRunner.auth.profile.demo', 'sekrit');
  assert.equal(await service.get('apiRunner.auth.profile.demo'), 'sekrit');
  await service.delete('apiRunner.auth.profile.demo');
  assert.equal(await service.get('apiRunner.auth.profile.demo'), undefined);
});

test('onDidChange fires only for apiRunner.auth.profile.* keys', () => {
  const storage = new FakeSecretStorage();
  const service = new SecretStorageService(storage);
  let fired = 0;
  const disposable = service.onDidChange(() => {
    fired += 1;
  });

  storage.emit('apiRunner.auth.profile.one');
  storage.emit('apiRunner.auth.profile.two.token');
  assert.equal(fired, 2);

  storage.emit('unrelated.key');
  storage.emit('apiRunner.other');
  storage.emit('authentication');
  assert.equal(fired, 2);

  disposable.dispose();
  storage.emit('apiRunner.auth.profile.three');
  assert.equal(fired, 2);
});
