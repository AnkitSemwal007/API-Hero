/**
 * Host-side password InputBox for authentication secrets.
 * Values never pass through webviews or postMessage.
 */

import { window } from 'vscode';

import type { AuthenticationSecretRepository } from '../authentication-resolver';

/** Prompts for a secret and stores it via the auth secret repository. */
export async function promptAndStoreAuthSecret(
  secrets: AuthenticationSecretRepository,
  profileId: string,
  field: string,
): Promise<boolean> {
  const value = await window.showInputBox({
    title: 'Set authentication secret',
    prompt: `Enter secret for profile "${profileId}" field "${field}". The value is stored in VS Code Secret Storage and is never shown in the Auth Manager.`,
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'Secret value',
  });
  if (value === undefined) {
    return false;
  }
  if (value.length === 0) {
    void window.showWarningMessage(
      'Secret was not saved because the value was empty.',
    );
    return false;
  }
  await secrets.store(profileId, field, value);
  return true;
}

/** Clears a stored authentication secret after confirmation. */
export async function confirmAndClearAuthSecret(
  secrets: AuthenticationSecretRepository,
  profileId: string,
  field: string,
): Promise<boolean> {
  const choice = await window.showWarningMessage(
    `Clear secret for profile "${profileId}" field "${field}"?`,
    { modal: true },
    'Clear',
  );
  if (choice !== 'Clear') {
    return false;
  }
  await secrets.delete(profileId, field);
  return true;
}
