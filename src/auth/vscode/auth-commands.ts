/**
 * Host-side Authentication Evolution commands: test, login, save-as,
 * use-response-as-auth.
 */

import {
  window,
  type QuickPickItem,
} from 'vscode';

import type { RequestExecutor } from '../../execution';
import type {
  AuthenticationProfile,
  ResolvedRequest,
} from '../../models';
import { applySessionTokensFromJson } from '../apply-session-tokens';
import {
  ApiKeyAuthenticationProvider,
  AuthenticationProviderRegistry,
  BasicAuthenticationProvider,
  BearerAuthenticationProvider,
  NoneAuthenticationProvider,
} from '../authentication-provider';
import { DefaultAuthenticationResolver } from '../authentication-resolver';
import type { AuthenticationProfileManager } from '../authentication-profile-manager';
import { secretFieldNamesForProvider } from '../authentication-profile-validation';
import type { AuthenticationSecretRepository } from '../authentication-resolver';
import {
  deriveAuthenticationHealth,
  formatAuthTestSummary,
  SESSION_SECRET_FIELDS,
  sessionStatusFromTestStatusCode,
  type AuthenticationSessionStore,
  type LoginApiConfig,
} from '../authentication-session';
import { detectAuthIdentityFromJson } from '../detect-auth-identity';
import {
  detectAuthTokensInJson,
  readJsonPathValue,
} from '../detect-auth-tokens';
import type { EphemeralAuthenticationBinding } from '../ephemeral-authentication';
import { buildProbeAuthenticatedRequest } from '../probe-request';
import { saveAsAuthenticationProfile } from '../save-as-authentication';
import type {
  AuthManagerLoginResult,
  AuthManagerProfile,
  AuthManagerState,
  AuthManagerTestResult,
} from './auth-manager-html';
import { promptAndStoreAuthSecret } from './auth-secret-prompt';
import { writeAuthManagerState } from './auth-settings-writer';

export interface AuthCommandServices {
  readonly profileManager: AuthenticationProfileManager;
  readonly secrets: AuthenticationSecretRepository;
  readonly sessions: AuthenticationSessionStore;
  readonly executor: RequestExecutor;
}

const authResolver = () =>
  new DefaultAuthenticationResolver(
    new AuthenticationProviderRegistry([
      new NoneAuthenticationProvider(),
      new BasicAuthenticationProvider(),
      new BearerAuthenticationProvider(),
      new ApiKeyAuthenticationProvider(),
    ]),
  );

export interface RunTestAuthenticationOptions {
  readonly testUrl?: string;
  /** When true, skip info toast (Auth Manager shows inline result). */
  readonly silent?: boolean;
}

/** Prompts for a profile and runs a health probe against testUrl or login URL. */
export async function runTestAuthenticationCommand(
  services: AuthCommandServices,
  profileId?: string,
  options?: RunTestAuthenticationOptions,
): Promise<AuthManagerTestResult | undefined> {
  const profile = await pickProfile(services.profileManager, profileId);
  if (profile === undefined) {
    return undefined;
  }
  const session = services.sessions.get(profile.id);
  let url =
    options?.testUrl?.trim() ||
    session?.testUrl?.trim() ||
    session?.login?.url?.trim() ||
    '';
  if (url.length === 0) {
    url =
      (
        await window.showInputBox({
          prompt: `Test URL for Authentication "${profile.id}"`,
          placeHolder: 'https://api.example.com/me',
          ignoreFocusOut: true,
        })
      )?.trim() ?? '';
  }
  if (url.length === 0) {
    return undefined;
  }

  const method = session?.login?.method?.trim().toUpperCase() || 'GET';
  const probe = buildProbeAuthenticatedRequest({ method, url });
  const unresolved = toUnresolvedProfileRequest(probe, profile.id);

  let authenticated;
  try {
    authenticated = await authResolver().resolve(unresolved, {
      profiles: services.profileManager.list(),
      secrets: services.secrets,
      sessions: services.sessions,
      variables: new Map(),
      ...(services.profileManager.defaultProfileId === undefined
        ? {}
        : { defaultProfileId: services.profileManager.defaultProfileId }),
    });
  } catch (error) {
    const text =
      error instanceof Error ? error.message : 'Authentication resolve failed.';
    void window.showErrorMessage(text);
    return {
      ok: false,
      url,
      summary: text,
      error: text,
    };
  }

  const started = Date.now();
  const result = await services.executor.execute(authenticated);
  const latencyMs = Date.now() - started;
  if (!result.success) {
    services.sessions.patch(profile.id, {
      status: 'unhealthy',
      lastTestedAt: new Date().toISOString(),
      lastTestSummary: result.error.message,
    });
    if (options?.silent !== true) {
      void window.showErrorMessage(
        `Test Authentication failed: ${result.error.message}`,
      );
    }
    return {
      ok: false,
      url,
      latencyMs,
      summary: result.error.message,
      error: result.error.message,
    };
  }

  const statusCode = result.response.statusCode;
  const status = sessionStatusFromTestStatusCode(statusCode);
  const body = parseJsonBody(result.response.body.json, result.response.body.text);
  const identity = body !== undefined ? detectAuthIdentityFromJson(body) : undefined;
  const rateLimitRemaining = headerValue(
    result.response.headers,
    'x-ratelimit-remaining',
  );
  const rateLimitLimit = headerValue(result.response.headers, 'x-ratelimit-limit');
  const expiresAt = services.sessions.get(profile.id)?.expiresAt;
  const summary = formatAuthTestSummary({
    statusCode,
    url,
    latencyMs,
    ...(identity !== undefined ? { identity } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(rateLimitRemaining !== undefined
      ? { rateLimitRemaining }
      : {}),
    ...(rateLimitLimit !== undefined ? { rateLimitLimit } : {}),
  });
  const testedAt = new Date().toISOString();
  services.sessions.patch(profile.id, {
    status,
    lastTestedAt: testedAt,
    lastTestStatusCode: statusCode,
    lastTestSummary: summary,
    testUrl: url,
    ...(status === 'ready' ? { lastAuthenticatedAt: testedAt } : {}),
  });
  const health = deriveAuthenticationHealth({
    session: services.sessions.get(profile.id),
  });
  if (options?.silent !== true) {
    void window.showInformationMessage(
      `Authentication "${profile.id}": ${health.label} (${health.detail})`,
    );
  }
  return {
    ok: statusCode >= 200 && statusCode < 300,
    url,
    statusCode,
    latencyMs,
    ...(identity !== undefined ? { identity } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(rateLimitRemaining !== undefined ? { rateLimitRemaining } : {}),
    ...(rateLimitLimit !== undefined ? { rateLimitLimit } : {}),
    ...(status === 'ready' ? { lastSuccessfulTestAt: testedAt } : {}),
    summary,
  };
}

/** Login API via InputBox fallback (command palette). Prefer Auth Manager wizard. */
export async function runAuthenticationLoginCommand(
  services: AuthCommandServices,
  profileId?: string,
): Promise<void> {
  const profile = await pickProfile(services.profileManager, profileId);
  if (profile === undefined) {
    return;
  }
  const session = services.sessions.get(profile.id);
  if (session?.login === undefined) {
    const configured = await promptLoginConfig();
    if (configured === undefined) {
      return;
    }
    services.sessions.patch(profile.id, {
      status: session?.status ?? 'unknown',
      login: configured,
    });
  }

  const usernameSaved = await promptAndStoreAuthSecret(
    services.secrets,
    profile.id,
    SESSION_SECRET_FIELDS.loginUsername,
  );
  if (!usernameSaved) {
    return;
  }
  const passwordSaved = await promptAndStoreAuthSecret(
    services.secrets,
    profile.id,
    SESSION_SECRET_FIELDS.loginPassword,
  );
  if (!passwordSaved) {
    return;
  }

  const outcome = await runAuthenticationLoginFromWizard(services, profile.id);
  if (!outcome.result.ok) {
    void window.showErrorMessage(outcome.result.error ?? 'Login failed.');
    return;
  }
  if (outcome.body === undefined) {
    return;
  }
  const candidates = detectAuthTokensInJson(outcome.body);
  const access = candidates.find(
    (candidate) =>
      candidate.kind === 'access_token' ||
      candidate.kind === 'id_token' ||
      candidate.kind === 'generic_token',
  );
  if (access === undefined) {
    void window.showWarningMessage(
      'Login succeeded but no token fields were detected.',
    );
    return;
  }
  const existing = services.sessions.get(profile.id);
  if (existing?.accessTokenPresent === true) {
    const choice = await window.showWarningMessage(
      `Session already exists for "${profile.id}". Overwrite with ${access.path}?`,
      { modal: true },
      'Overwrite',
    );
    if (choice !== 'Overwrite') {
      return;
    }
  }
  await applyLoginTokensFromWizard(services, {
    profileId: profile.id,
    body: outcome.body,
    accessTokenPath: access.path,
  });
  void window.showInformationMessage(
    `Session ready for "${profile.id}" (token from ${access.path}).`,
  );
}

/** Executes Login API using secrets already in Secret Storage (Auth Manager wizard). */
export async function runAuthenticationLoginFromWizard(
  services: AuthCommandServices,
  profileId: string,
): Promise<{
  readonly result: AuthManagerLoginResult;
  readonly body?: unknown;
}> {
  const session = services.sessions.get(profileId);
  const login = session?.login;
  if (login === undefined || login.url.trim().length === 0) {
    return {
      result: {
        ok: false,
        summary: 'Login API is not configured.',
        candidates: [],
        sessionExists: session?.accessTokenPresent === true,
        error: 'Login API is not configured.',
      },
    };
  }

  const username =
    (await services.secrets.get(
      profileId,
      SESSION_SECRET_FIELDS.loginUsername,
    )) ?? '';
  const password =
    (await services.secrets.get(
      profileId,
      SESSION_SECRET_FIELDS.loginPassword,
    )) ?? '';
  const bodyTemplate =
    login.bodyTemplate ??
    '{"username":"{{loginUsername}}","password":"{{loginPassword}}"}';
  const bodyText = bodyTemplate
    .replaceAll('{{loginUsername}}', escapeJsonString(username))
    .replaceAll('{{loginPassword}}', escapeJsonString(password));

  const request = buildProbeAuthenticatedRequest({
    method: login.method,
    url: login.url,
    bodyText,
    contentType: login.contentType ?? 'application/json',
  });
  const started = Date.now();
  const result = await services.executor.execute(request);
  const latencyMs = Date.now() - started;
  if (!result.success) {
    return {
      result: {
        ok: false,
        latencyMs,
        summary: result.error.message,
        candidates: [],
        sessionExists: session?.accessTokenPresent === true,
        error: result.error.message,
      },
    };
  }

  const body = parseJsonBody(result.response.body.json, result.response.body.text);
  if (body === undefined) {
    return {
      result: {
        ok: false,
        statusCode: result.response.statusCode,
        latencyMs,
        summary: 'Login response is not JSON.',
        candidates: [],
        sessionExists: session?.accessTokenPresent === true,
        error: 'Login response is not JSON.',
      },
    };
  }

  const candidates = detectAuthTokensInJson(body).map((candidate) => ({
    path: candidate.path,
    kind: candidate.kind,
    key: candidate.key,
  }));
  const identity = detectAuthIdentityFromJson(body);
  return {
    body,
    result: {
      ok: true,
      statusCode: result.response.statusCode,
      latencyMs,
      ...(identity !== undefined ? { identity } : {}),
      summary: `HTTP ${result.response.statusCode}`,
      candidates,
      sessionExists: session?.accessTokenPresent === true,
    },
  };
}

/** Applies confirmed token paths from a retained host-side login body. */
export async function applyLoginTokensFromWizard(
  services: AuthCommandServices,
  options: {
    readonly profileId: string;
    readonly body: unknown;
    readonly accessTokenPath: string;
    readonly refreshTokenPath?: string;
  },
): Promise<void> {
  await applySessionTokensFromJson({
    authenticationId: options.profileId,
    body: options.body,
    secrets: services.secrets,
    sessions: services.sessions,
    accessTokenPath: options.accessTokenPath,
    ...(options.refreshTokenPath !== undefined
      ? { refreshTokenPath: options.refreshTokenPath }
      : {}),
  });
  const login = services.sessions.get(options.profileId)?.login;
  if (login !== undefined) {
    services.sessions.patch(options.profileId, {
      login: {
        ...login,
        tokenPath: options.accessTokenPath,
        ...(options.refreshTokenPath !== undefined
          ? { refreshTokenPath: options.refreshTokenPath }
          : {}),
      },
    });
  }
}

/** Saves one-shot credentials as a reusable Authentication profile. */
export async function runSaveAsAuthenticationCommand(
  services: AuthCommandServices,
  ephemeral: EphemeralAuthenticationBinding,
  suggestedId?: string,
): Promise<AuthenticationProfile | undefined> {
  const id =
    (
      await window.showInputBox({
        prompt: 'Authentication id',
        value: suggestedId ?? 'bearer',
        ignoreFocusOut: true,
        validateInput: (value) =>
          value.trim().length === 0 ? 'Id is required' : undefined,
      })
    )?.trim() ?? '';
  if (id.length === 0) {
    return undefined;
  }
  const label =
    (
      await window.showInputBox({
        prompt: 'Display name',
        value: id,
        ignoreFocusOut: true,
      })
    )?.trim() || id;

  const result = await saveAsAuthenticationProfile({
    id,
    label,
    ephemeral,
    existingProfiles: services.profileManager.list(),
    secrets: services.secrets,
  });
  if (!result.ok) {
    void window.showErrorMessage(result.message);
    return undefined;
  }

  await persistProfiles(services, [
    ...services.profileManager.list(),
    result.profile,
  ]);
  void window.showInformationMessage(
    `Saved Authentication "${result.profile.id}".`,
  );
  return result.profile;
}

/** Applies a JSON response body token into a chosen Authentication session. */
export async function runUseResponseAsAuthenticationCommand(
  services: AuthCommandServices,
  body: unknown,
  preferredProfileId?: string,
): Promise<void> {
  const candidates = detectAuthTokensInJson(body);
  if (candidates.length === 0) {
    void window.showWarningMessage(
      'No likely token fields found in the response.',
    );
    return;
  }
  const access = candidates.find(
    (candidate) =>
      candidate.kind === 'access_token' ||
      candidate.kind === 'id_token' ||
      candidate.kind === 'generic_token',
  );
  if (access === undefined) {
    void window.showWarningMessage('No access token candidate found.');
    return;
  }

  const action = await window.showQuickPick(
    [
      {
        label: '$(key) Create Session',
        description: `Apply ${access.path} to Authentication Session`,
        action: 'session' as const,
      },
      {
        label: '$(add) Use as Authentication',
        description: 'Create or update saved Authentication',
        action: 'auth' as const,
      },
    ],
    {
      title: 'Detected Authentication',
      placeHolder: 'Choose how to reuse detected tokens',
      ignoreFocusOut: true,
    },
  );
  if (action === undefined) {
    return;
  }

  const profiles = services.profileManager
    .list()
    .filter(
      (profile) =>
        profile.providerId === 'bearer' || profile.providerId === 'apiKey',
    );
  const createNew: QuickPickItem & { readonly create?: true } = {
    label: '$(add) Create new Bearer Authentication',
    description: 'New Authentication',
    create: true,
  };
  const items: Array<QuickPickItem & { readonly id?: string; readonly create?: true }> = [
    createNew,
    ...profiles.map((profile) => ({
      label: profile.label ?? profile.id,
      description: profile.id,
      id: profile.id,
      picked: profile.id === preferredProfileId,
    })),
  ];
  const picked = await window.showQuickPick(items, {
    title: `Token at ${access.path}`,
    placeHolder: 'Choose Authentication',
    ignoreFocusOut: true,
  });
  if (picked === undefined) {
    return;
  }

  let authenticationId: string;
  if (picked.create === true) {
    const id =
      (
        await window.showInputBox({
          prompt: 'New Authentication id',
          value: 'session',
          ignoreFocusOut: true,
        })
      )?.trim() ?? '';
    if (id.length === 0) {
      return;
    }
    const label =
      (
        await window.showInputBox({
          prompt: 'Display name',
          value: id,
          ignoreFocusOut: true,
        })
      )?.trim() || id;
    const profile: AuthenticationProfile = {
      id,
      label,
      providerId: 'bearer',
      token: { kind: 'secret' },
    };
    await persistProfiles(services, [
      ...services.profileManager.list(),
      profile,
    ]);
    authenticationId = id;
  } else {
    authenticationId = picked.id ?? picked.description ?? picked.label;
  }

  if (action.action === 'auth') {
    const tokenValue = readJsonPathValue(body, access.path);
    if (tokenValue === undefined || String(tokenValue).length === 0) {
      void window.showWarningMessage(
        `Could not read token at ${access.path}.`,
      );
      return;
    }
    const profile = services.profileManager
      .list()
      .find((entry) => entry.id === authenticationId);
    const secretField =
      secretFieldNamesForProvider(profile?.providerId ?? 'bearer')[0] ?? 'token';
    const existingSecret = await services.secrets.get(
      authenticationId,
      secretField,
    );
    if (existingSecret !== undefined && existingSecret.length > 0) {
      const choice = await window.showWarningMessage(
        `Authentication already exists for "${authenticationId}". Overwrite with ${access.path}?`,
        { modal: true },
        'Overwrite',
      );
      if (choice !== 'Overwrite') {
        return;
      }
    }
    await services.secrets.store(
      authenticationId,
      secretField,
      String(tokenValue),
    );
    void window.showInformationMessage(
      `Authentication "${authenticationId}" updated from ${access.path}.`,
    );
    return;
  }

  const existing = services.sessions.get(authenticationId);
  if (existing?.accessTokenPresent === true) {
    const choice = await window.showWarningMessage(
      `Session already exists for "${authenticationId}". Overwrite with ${access.path}?`,
      { modal: true },
      'Overwrite',
    );
    if (choice !== 'Overwrite') {
      return;
    }
  }

  const applied = await applySessionTokensFromJson({
    authenticationId,
    body,
    secrets: services.secrets,
    sessions: services.sessions,
    accessTokenPath: access.path,
  });
  void window.showInformationMessage(
    applied.session.accessTokenPresent
      ? `Session updated for "${authenticationId}" from ${access.path}.`
      : `Could not apply token for "${authenticationId}".`,
  );
}

function toUnresolvedProfileRequest(
  probe: ReturnType<typeof buildProbeAuthenticatedRequest>,
  profileId: string,
): ResolvedRequest {
  const { authenticationStage, authentication, ...rest } = probe;
  void authenticationStage;
  void authentication;
  return {
    ...rest,
    authentication: {
      kind: 'unresolved',
      reference: profileId,
      extensions: {},
    },
  };
}

async function persistProfiles(
  services: AuthCommandServices,
  profiles: readonly AuthenticationProfile[],
): Promise<void> {
  const managerProfiles: AuthManagerProfile[] = profiles.map((profile) => {
    const data = profile as Readonly<Record<string, unknown>>;
    return {
      id: profile.id,
      label: profile.label ?? profile.id,
      providerId: (['none', 'basic', 'bearer', 'apiKey'].includes(
        profile.providerId,
      )
        ? profile.providerId
        : 'none') as AuthManagerProfile['providerId'],
      ...(typeof data.name === 'string' ? { apiKeyName: data.name } : {}),
      ...(data.location === 'header' || data.location === 'query'
        ? { apiKeyLocation: data.location }
        : {}),
      secretFields: [],
      credentialSources: [],
    };
  });
  const state: AuthManagerState = {
    profiles: managerProfiles,
    ...(services.profileManager.defaultProfileId === undefined
      ? {}
      : { defaultProfileId: services.profileManager.defaultProfileId }),
  };
  await writeAuthManagerState(state, services.profileManager.list());
}

async function pickProfile(
  manager: AuthenticationProfileManager,
  profileId?: string,
): Promise<AuthenticationProfile | undefined> {
  const profiles = manager
    .list()
    .filter((profile) => profile.providerId !== 'none');
  if (profiles.length === 0) {
    void window.showWarningMessage('No Authentication configured.');
    return undefined;
  }
  if (profileId !== undefined) {
    const match = profiles.find((profile) => profile.id === profileId);
    if (match !== undefined) {
      return match;
    }
  }
  const picked = await window.showQuickPick(
    profiles.map((profile) => ({
      label: profile.label ?? profile.id,
      description: profile.id,
      profile,
    })),
    { title: 'Select Authentication', ignoreFocusOut: true },
  );
  return picked?.profile;
}

async function promptLoginConfig(): Promise<LoginApiConfig | undefined> {
  const url =
    (
      await window.showInputBox({
        prompt: 'Login API URL',
        placeHolder: 'https://api.example.com/auth/login',
        ignoreFocusOut: true,
      })
    )?.trim() ?? '';
  if (url.length === 0) {
    return undefined;
  }
  const method =
    (
      await window.showQuickPick(['POST', 'PUT', 'PATCH', 'GET'], {
        title: 'Login HTTP method',
      })
    ) ?? 'POST';
  const tokenPath =
    (
      await window.showInputBox({
        prompt: 'Access token JSON path (optional — auto-detect when empty)',
        placeHolder: 'access_token',
        ignoreFocusOut: true,
      })
    )?.trim() || undefined;
  return {
    method,
    url,
    sendAs: 'bearer',
    ...(tokenPath !== undefined ? { tokenPath } : {}),
    bodyTemplate:
      '{"username":"{{loginUsername}}","password":"{{loginPassword}}"}',
    contentType: 'application/json',
  };
}

function parseJsonBody(
  json: unknown,
  text: string | undefined,
): unknown | undefined {
  if (json !== undefined) {
    return json;
  }
  if (text === undefined || text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function headerValue(
  headers: readonly { readonly name: string; readonly value: string }[],
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  const match = headers.find((header) => header.name.toLowerCase() === lower);
  return match?.value;
}

function escapeJsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}
