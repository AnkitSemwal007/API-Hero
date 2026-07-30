/**
 * Host-side secret helpers for authentication.
 * Primary Auth Manager path posts ephemeral cleartext once via storeAuthSecret;
 * InputBox remains available for command-palette / code-action fallbacks.
 */

import { window } from 'vscode';

import type { AuthenticationSecretRepository } from '../authentication-resolver';

/** Stores a secret value supplied by the Auth Manager inline credential UI. */
export async function storeAuthSecret(
  secrets: AuthenticationSecretRepository,
  profileId: string,
  field: string,
  value: string,
): Promise<boolean> {
  if (value.length === 0) {
    void window.showWarningMessage(
      'Secret was not saved because the value was empty.',
    );
    return false;
  }
  await secrets.store(profileId, field, value);
  return true;
}

/** Prompts for a secret and stores it via the auth secret repository (fallback UX). */
export async function promptAndStoreAuthSecret(
  secrets: AuthenticationSecretRepository,
  profileId: string,
  field: string,
): Promise<boolean> {
  const value = await window.showInputBox({
    title: 'Set authentication secret',
    prompt: `Enter secret for Authentication "${profileId}" field "${field}". Prefer Manage Authentication for inline entry. Stored in VS Code Secret Storage.`,
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'Secret value',
  });
  if (value === undefined) {
    return false;
  }
  return storeAuthSecret(secrets, profileId, field, value);
}

/** Clears a stored authentication secret after confirmation. */
export async function confirmAndClearAuthSecret(
  secrets: AuthenticationSecretRepository,
  profileId: string,
  field: string,
): Promise<boolean> {
  const choice = await window.showWarningMessage(
    `Clear secret for Authentication "${profileId}" field "${field}"?`,
    { modal: true },
    'Clear',
  );
  if (choice !== 'Clear') {
    return false;
  }
  await secrets.delete(profileId, field);
  return true;
}
