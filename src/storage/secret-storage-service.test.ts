import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SecretStorage, SecretStorageChangeEvent } from 'vscode';

import {
  AUTH_SECRET_KEY_PREFIX,
  LEGACY_AUTH_SECRET_KEY_PREFIX,
} from '../constants';
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
  const key = `${AUTH_SECRET_KEY_PREFIX}demo`;

  assert.equal(await service.get(key), undefined);
  await service.set(key, 'sekrit');
  assert.equal(await service.get(key), 'sekrit');
  await service.delete(key);
  assert.equal(await service.get(key), undefined);
});

test('onDidChange fires for canonical and legacy auth.profile.* keys', () => {
  const storage = new FakeSecretStorage();
  const service = new SecretStorageService(storage);
  let fired = 0;
  const disposable = service.onDidChange(() => {
    fired += 1;
  });

  storage.emit(`${AUTH_SECRET_KEY_PREFIX}one`);
  storage.emit(`${AUTH_SECRET_KEY_PREFIX}two.token`);
  storage.emit(`${LEGACY_AUTH_SECRET_KEY_PREFIX}legacy`);
  assert.equal(fired, 3);

  storage.emit('unrelated.key');
  storage.emit('apiHero.other');
  storage.emit('apiRunner.other');
  storage.emit('authentication');
  assert.equal(fired, 3);

  disposable.dispose();
  storage.emit(`${AUTH_SECRET_KEY_PREFIX}three`);
  assert.equal(fired, 3);
});
