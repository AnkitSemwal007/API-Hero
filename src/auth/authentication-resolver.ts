import type {
  AuthenticatedRequest,
  AuthenticationProfile,
  AuthenticationValueSource,
  ResolvedRequest,
  VariableValue,
} from '../models';
import {
  applyAuthenticationDecoration,
  AuthenticationError,
  type AuthenticationProviderRegistry,
} from './authentication-provider';
import type { AuthenticationProfileIssue } from './authentication-profile-validation';

/** Stable secret names are derived; profiles cannot redirect reads arbitrarily. */
export function authenticationSecretKey(profileId: string, field: string): string {
  return `apiRunner.auth.profile.${encodeURIComponent(profileId)}.${encodeURIComponent(field)}`;
}

export interface AuthenticationSecretRepository {
  get(profileId: string, field: string): Promise<string | undefined>;
  store(profileId: string, field: string, value: string): Promise<void>;
  delete(profileId: string, field: string): Promise<void>;
}

export class DefaultAuthenticationSecretRepository
implements AuthenticationSecretRepository {
  public constructor(
    private readonly secretStore: {
      get(key: string): Promise<string | undefined>;
      set(key: string, value: string): Promise<void>;
      delete(key: string): Promise<void>;
    },
  ) {}

  public get(profileId: string, field: string): Promise<string | undefined> {
    return this.secretStore.get(authenticationSecretKey(profileId, field));
  }

  public store(
    profileId: string,
    field: string,
    value: string,
  ): Promise<void> {
    return this.secretStore.set(authenticationSecretKey(profileId, field), value);
  }

  public delete(profileId: string, field: string): Promise<void> {
    return this.secretStore.delete(authenticationSecretKey(profileId, field));
  }
}

/** Immutable profile/default/variable snapshot captured once for a run. */
export interface AuthenticationResolutionContext {
  readonly profiles: readonly AuthenticationProfile[];
  /** Structured issues for entries excluded by profile validation. */
  readonly issues?: readonly AuthenticationProfileIssue[];
  readonly defaultProfileId?: string;
  readonly variables: ReadonlyMap<string, VariableValue>;
  readonly secrets: AuthenticationSecretRepository;
}

export interface AuthenticationResolver {
  resolve(
    request: ResolvedRequest,
    context: AuthenticationResolutionContext,
    signal?: AbortSignal,
  ): Promise<AuthenticatedRequest>;
}

export class DefaultAuthenticationResolver implements AuthenticationResolver {
  public constructor(private readonly registry: AuthenticationProviderRegistry) {}

  public async resolve(
    request: ResolvedRequest,
    context: AuthenticationResolutionContext,
    signal?: AbortSignal,
  ): Promise<AuthenticatedRequest> {
    assertNotAborted(signal);
    const reference = request.authentication.kind === 'unresolved'
      ? request.authentication.reference?.trim()
      : context.defaultProfileId?.trim();
    const profile = reference === undefined || reference.length === 0
      ? NO_AUTH_PROFILE
      : findProfile(context, reference);
    const provider = this.registry.get(profile.providerId);
    if (provider === undefined) {
      throw new AuthenticationError(
        'UNKNOWN_PROVIDER',
        profile.id,
        profile.providerId,
      );
    }
    const material = await resolveMaterial(profile, context, signal);
    assertNotAborted(signal);
    return applyAuthenticationDecoration(
      request,
      profile,
      provider.decorate(request, profile, material),
    );
  }
}

const NO_AUTH_PROFILE: AuthenticationProfile = Object.freeze({
  id: 'none',
  providerId: 'none',
  label: 'No authentication',
});

function findProfile(
  context: AuthenticationResolutionContext,
  id: string,
): AuthenticationProfile {
  // Validated profiles are de-duplicated, so at most one match exists.
  const match = context.profiles.find((profile) => profile.id === id);
  if (match !== undefined) {
    return match;
  }
  // A validation issue (duplicate/malformed) means the id exists but was
  // rejected; distinguish that from an id that was never configured.
  const excluded = context.issues?.some((issue) => issue.profileId === id) === true;
  throw new AuthenticationError(
    excluded ? 'INVALID_PROFILE' : 'MISSING_PROFILE',
    id,
  );
}

async function resolveMaterial(
  profile: AuthenticationProfile,
  context: AuthenticationResolutionContext,
  signal?: AbortSignal,
): Promise<Readonly<Record<string, string>>> {
  const fields = profileFields(profile);
  const material = Object.create(null) as Record<string, string>;
  for (const [field, source] of fields) {
    assertNotAborted(signal);
    const value = await resolveSource(profile.id, field, source, context);
    assertNotAborted(signal);
    if (value === undefined) {
      throw new AuthenticationError('MISSING_CREDENTIAL', profile.id, field);
    }
    Object.defineProperty(material, field, {
      value,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(material);
}

function profileFields(
  profile: AuthenticationProfile,
): readonly (readonly [string, AuthenticationValueSource])[] {
  switch (profile.providerId) {
    case 'none':
      return [];
    case 'basic':
      return [
        ['username', requireSource(profile, 'username')],
        ['password', requireSource(profile, 'password')],
      ];
    case 'bearer':
      return [['token', requireSource(profile, 'token')]];
    case 'apiKey':
      return [['value', requireSource(profile, 'value')]];
    default:
      return Object.entries(profile)
        .filter((entry): entry is [string, AuthenticationValueSource] =>
          isValueSource(entry[1]))
        .map(([field, source]) => [field, source] as const);
  }
}

function requireSource(
  profile: AuthenticationProfile,
  field: string,
): AuthenticationValueSource {
  const source = (profile as Readonly<Record<string, unknown>>)[field];
  if (!isValueSource(source)) {
    throw new AuthenticationError('INVALID_PROFILE', profile.id, field);
  }
  return source;
}

function isValueSource(value: unknown): value is AuthenticationValueSource {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false;
  }
  const source = value as Partial<AuthenticationValueSource>;
  return source.kind === 'secret' ||
    (source.kind === 'variable' && typeof source.name === 'string') ||
    (source.kind === 'literal' &&
      typeof source.value === 'string' &&
      source.unsafe === true);
}

async function resolveSource(
  profileId: string,
  field: string,
  source: AuthenticationValueSource,
  context: AuthenticationResolutionContext,
): Promise<string | undefined> {
  switch (source.kind) {
    case 'secret':
      return context.secrets.get(profileId, field);
    case 'variable':
      return context.variables.get(source.name)?.value;
    case 'literal':
      return source.value;
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new AuthenticationAbortError();
  }
}

export class AuthenticationAbortError extends Error {
  public constructor() {
    super('Authentication resolution was cancelled.');
    this.name = 'AuthenticationAbortError';
  }
}
