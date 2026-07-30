/**
 * Applies detected / extracted token values into Session + Secret Storage.
 * Core-friendly: accepts a secret repository; no VS Code APIs.
 */

import type { AuthenticationSecretRepository } from './authentication-resolver';
import {
  SESSION_SECRET_FIELDS,
  type AuthenticationSession,
  type AuthenticationSessionStore,
  type AuthenticationSessionStatus,
} from './authentication-session';
import {
  detectAuthTokensInJson,
  readJsonPathValue,
  type DetectedAuthTokenCandidate,
} from './detect-auth-tokens';

export interface ApplySessionTokensInput {
  readonly authenticationId: string;
  readonly body: unknown;
  readonly secrets: AuthenticationSecretRepository;
  readonly sessions: AuthenticationSessionStore;
  /** Override auto-detected access token path. */
  readonly accessTokenPath?: string;
  readonly refreshTokenPath?: string;
  readonly expiresInPath?: string;
  readonly expiresAtPath?: string;
  readonly now?: Date;
}

export interface ApplySessionTokensResult {
  readonly session: AuthenticationSession;
  readonly accessTokenPath?: string;
  readonly refreshTokenPath?: string;
}

/**
 * Detects token fields (or uses configured paths), stores secrets, updates session.
 */
export async function applySessionTokensFromJson(
  input: ApplySessionTokensInput,
): Promise<ApplySessionTokensResult> {
  const now = input.now ?? new Date();
  const candidates = detectAuthTokensInJson(input.body);
  const accessPath =
    input.accessTokenPath?.trim() ||
    pickPath(candidates, ['access_token', 'id_token', 'generic_token']);
  const refreshPath =
    input.refreshTokenPath?.trim() ||
    pickPath(candidates, ['refresh_token']);
  const expiresInPath =
    input.expiresInPath?.trim() ||
    pickPath(candidates, ['expires_in']);
  const expiresAtPath =
    input.expiresAtPath?.trim() ||
    pickPath(candidates, ['expires_at']);

  let accessTokenPresent = false;
  let refreshTokenPresent = false;
  let expiresAt: string | null = null;

  if (accessPath !== undefined) {
    const value = readJsonPathValue(input.body, accessPath);
    if (value !== undefined && String(value).length > 0) {
      await input.secrets.store(
        input.authenticationId,
        SESSION_SECRET_FIELDS.accessToken,
        String(value),
      );
      accessTokenPresent = true;
    }
  }
  if (refreshPath !== undefined) {
    const value = readJsonPathValue(input.body, refreshPath);
    if (value !== undefined && String(value).length > 0) {
      await input.secrets.store(
        input.authenticationId,
        SESSION_SECRET_FIELDS.refreshToken,
        String(value),
      );
      refreshTokenPresent = true;
    }
  }

  if (expiresAtPath !== undefined) {
    const value = readJsonPathValue(input.body, expiresAtPath);
    if (typeof value === 'string' && value.length > 0) {
      expiresAt = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      expiresAt = new Date(value > 1e12 ? value : value * 1000).toISOString();
    }
  } else if (expiresInPath !== undefined) {
    const value = readJsonPathValue(input.body, expiresInPath);
    const seconds = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(seconds) && seconds > 0) {
      expiresAt = new Date(now.getTime() + seconds * 1000).toISOString();
    }
  }

  if (!accessTokenPresent) {
    await input.secrets.delete(
      input.authenticationId,
      SESSION_SECRET_FIELDS.accessToken,
    );
    await input.secrets.delete(
      input.authenticationId,
      SESSION_SECRET_FIELDS.refreshToken,
    );
    const previous = input.sessions.get(input.authenticationId);
    const session = input.sessions.patch(input.authenticationId, {
      status: 'missing_secret',
      accessTokenPresent: false,
      refreshTokenPresent: false,
      expiresAt: null,
      ...(previous?.login !== undefined ? { login: previous.login } : {}),
      ...(previous?.testUrl !== undefined ? { testUrl: previous.testUrl } : {}),
    });
    return {
      session,
      ...(accessPath !== undefined ? { accessTokenPath: accessPath } : {}),
      ...(refreshPath !== undefined ? { refreshTokenPath: refreshPath } : {}),
    };
  }

  const status: AuthenticationSessionStatus = 'ready';
  const previous = input.sessions.get(input.authenticationId);
  // Always set new expiresAt or explicitly clear stale previous expiry.
  const session = input.sessions.patch(input.authenticationId, {
    status,
    accessTokenPresent,
    refreshTokenPresent,
    expiresAt,
    issuedAt: now.toISOString(),
    lastAuthenticatedAt: now.toISOString(),
    ...(previous?.login !== undefined ? { login: previous.login } : {}),
    ...(previous?.testUrl !== undefined ? { testUrl: previous.testUrl } : {}),
  });

  return {
    session,
    ...(accessPath !== undefined ? { accessTokenPath: accessPath } : {}),
    ...(refreshPath !== undefined ? { refreshTokenPath: refreshPath } : {}),
  };
}

function pickPath(
  candidates: readonly DetectedAuthTokenCandidate[],
  kinds: readonly DetectedAuthTokenCandidate['kind'][],
): string | undefined {
  for (const kind of kinds) {
    const match = candidates.find((candidate) => candidate.kind === kind);
    if (match !== undefined) {
      return match.path;
    }
  }
  return undefined;
}
