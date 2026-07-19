import type {
  AuthenticatedRequest,
  AuthenticationProfile,
  ResolvedRequest,
  RuntimeHeader,
} from '../models';
import { cloneDetached, deepFreeze } from '../shared';

export interface AuthenticationProviderMetadata {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly string[];
  readonly capabilities: readonly ('header' | 'query')[];
}

export interface AuthenticationDecoration {
  readonly headers?: readonly RuntimeHeader[];
  readonly query?: {
    readonly name: string;
    readonly value: string;
  };
  readonly sensitiveHeaderNames?: readonly string[];
}

/** Compatibility name for the provider decoration result. */
export type AuthenticationResult = AuthenticationDecoration;

/** Typed provider extension point; providers never access storage or VS Code. */
export interface AuthenticationProvider<
  TProfile extends AuthenticationProfile = AuthenticationProfile,
> {
  readonly metadata: AuthenticationProviderMetadata;
  decorate(
    request: ResolvedRequest,
    profile: TProfile,
    material: Readonly<Record<string, string>>,
  ): AuthenticationDecoration;
}

export class AuthenticationProviderRegistry {
  private readonly providers = new Map<string, AuthenticationProvider>();

  public constructor(providers: readonly AuthenticationProvider[] = []) {
    providers.forEach((provider) => this.register(provider));
  }

  public register(provider: AuthenticationProvider): void {
    const id = provider.metadata.id;
    if (id.length === 0 || this.providers.has(id)) {
      throw new AuthenticationError(
        this.providers.has(id) ? 'DUPLICATE_PROVIDER' : 'INVALID_PROVIDER',
        undefined,
        id || undefined,
      );
    }
    this.providers.set(id, provider);
  }

  public get(id: string): AuthenticationProvider | undefined {
    return this.providers.get(id);
  }

  public list(): readonly AuthenticationProviderMetadata[] {
    return Object.freeze([...this.providers.values()].map((provider) =>
      Object.freeze({ ...provider.metadata })));
  }
}

export type AuthenticationErrorCode =
  | 'DUPLICATE_PROVIDER'
  | 'INVALID_PROVIDER'
  | 'UNKNOWN_PROVIDER'
  | 'MISSING_PROFILE'
  | 'INVALID_PROFILE'
  | 'MISSING_CREDENTIAL'
  | 'INVALID_CREDENTIAL'
  | 'CONFLICT';

/** Safe error: it carries identifiers and field names, never credential data. */
export class AuthenticationError extends Error {
  public constructor(
    public readonly code: AuthenticationErrorCode,
    public readonly profileId?: string,
    public readonly field?: string,
  ) {
    super(authenticationErrorMessage(code, profileId, field));
    this.name = 'AuthenticationError';
  }
}

export interface BasicEncoder {
  encodeUtf8Base64(value: string): string;
}

export const NODE_BASIC_ENCODER: BasicEncoder = Object.freeze({
  encodeUtf8Base64: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
});

export class NoneAuthenticationProvider implements AuthenticationProvider {
  public readonly metadata = Object.freeze({
    id: 'none',
    label: 'No authentication',
    fields: [],
    capabilities: [],
  } as const);

  public decorate(): AuthenticationDecoration {
    return Object.freeze({});
  }
}

export class BasicAuthenticationProvider implements AuthenticationProvider {
  public readonly metadata = Object.freeze({
    id: 'basic',
    label: 'Basic',
    fields: ['username', 'password'],
    capabilities: ['header'],
  } as const);

  public constructor(private readonly encoder: BasicEncoder = NODE_BASIC_ENCODER) {}

  public decorate(
    _request: ResolvedRequest,
    profile: AuthenticationProfile,
    material: Readonly<Record<string, string>>,
  ): AuthenticationDecoration {
    const username = credential(material, 'username', profile.id, true);
    const password = credential(material, 'password', profile.id, true);
    if (username.includes(':')) {
      throw new AuthenticationError('INVALID_CREDENTIAL', profile.id, 'username');
    }
    rejectHeaderValue(username, profile.id, 'username');
    rejectHeaderValue(password, profile.id, 'password');
    return headerDecoration(
      'Authorization',
      `Basic ${this.encoder.encodeUtf8Base64(`${username}:${password}`)}`,
    );
  }
}

export class BearerAuthenticationProvider implements AuthenticationProvider {
  public readonly metadata = Object.freeze({
    id: 'bearer',
    label: 'Bearer token',
    fields: ['token'],
    capabilities: ['header'],
  } as const);

  public decorate(
    _request: ResolvedRequest,
    profile: AuthenticationProfile,
    material: Readonly<Record<string, string>>,
  ): AuthenticationDecoration {
    const token = credential(material, 'token', profile.id);
    rejectHeaderValue(token, profile.id, 'token');
    return headerDecoration('Authorization', `Bearer ${token}`);
  }
}

export class ApiKeyAuthenticationProvider implements AuthenticationProvider {
  public readonly metadata = Object.freeze({
    id: 'apiKey',
    label: 'API key',
    fields: ['value'],
    capabilities: ['header', 'query'],
  } as const);

  public decorate(
    request: ResolvedRequest,
    profile: AuthenticationProfile,
    material: Readonly<Record<string, string>>,
  ): AuthenticationDecoration {
    const profileData = profile as Readonly<Record<string, unknown>>;
    const name = typeof profileData.name === 'string' ? profileData.name : '';
    const location = profileData.location;
    if (name.length === 0 || (location !== 'header' && location !== 'query')) {
      throw new AuthenticationError('INVALID_PROFILE', profile.id, 'name');
    }
    const value = credential(material, 'value', profile.id);
    if (location === 'header') {
      if (!HTTP_TOKEN.test(name)) {
        throw new AuthenticationError('INVALID_PROFILE', profile.id, 'name');
      }
      rejectHeaderValue(value, profile.id, 'value');
      // Header conflict detection is owned solely by applyAuthenticationDecoration,
      // which rejects case-insensitive collisions for every added header.
      return headerDecoration(name, value);
    }
    assertNoQuery(request.url, name, profile.id);
    return Object.freeze({ query: Object.freeze({ name, value }) });
  }
}

export function applyAuthenticationDecoration(
  request: ResolvedRequest,
  profile: AuthenticationProfile,
  decoration: AuthenticationDecoration,
): AuthenticatedRequest {
  const detached = cloneDetached(request);
  const addedHeaders = decoration.headers?.map((header) => ({ ...header })) ?? [];
  for (const header of addedHeaders) {
    assertNoHeader(request, header.name, profile.id);
  }
  const query = decoration.query;
  const url = query === undefined
    ? request.url
    : appendQuery(request.url, query.name, query.value);
  const presentationUrl = query === undefined
    ? request.resolution.presentationUrl
    : appendQuery(request.resolution.presentationUrl, query.name, '••••••••');
  const sensitiveHeaders = [
    ...request.resolution.sensitiveHeaderNames,
    ...(decoration.sensitiveHeaderNames ?? addedHeaders.map((header) =>
      header.name.toLowerCase())),
  ];
  return deepFreeze({
    ...detached,
    url,
    headers: [...detached.headers, ...addedHeaders],
    queryParameters: query === undefined
      ? detached.queryParameters
      : [...detached.queryParameters, {
          name: encodeURIComponent(query.name),
          value: encodeURIComponent(query.value),
        }],
    authentication: {
      kind: 'resolved',
      scheme: profile.providerId,
      material: {},
      extensions: { profileId: profile.id },
    },
    resolution: {
      ...request.resolution,
      presentationUrl,
      sensitiveHeaderNames: [...new Set(sensitiveHeaders)].sort(),
      sensitiveQueryParameterNames: query === undefined
        ? [...request.resolution.sensitiveQueryParameterNames]
        : [...new Set([
            ...request.resolution.sensitiveQueryParameterNames,
            query.name,
          ])].sort(),
    },
    authenticationStage: 'authenticated',
  });
}

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const UNRESOLVED = /\{\{[^{}]+\}\}/u;

function credential(
  material: Readonly<Record<string, string>>,
  field: string,
  profileId: string,
  allowEmpty = false,
): string {
  const value = Object.prototype.hasOwnProperty.call(material, field)
    ? material[field]
    : undefined;
  if (value === undefined || (!allowEmpty && value.length === 0)) {
    throw new AuthenticationError('MISSING_CREDENTIAL', profileId, field);
  }
  if (UNRESOLVED.test(value)) {
    throw new AuthenticationError('INVALID_CREDENTIAL', profileId, field);
  }
  return value;
}

function rejectHeaderValue(value: string, profileId: string, field: string): void {
  if (/[\r\n\0]/u.test(value)) {
    throw new AuthenticationError('INVALID_CREDENTIAL', profileId, field);
  }
}

function assertNoHeader(
  request: ResolvedRequest,
  name: string,
  profileId: string,
): void {
  if (request.headers.some((header) =>
    header.name.toLowerCase() === name.toLowerCase())) {
    throw new AuthenticationError('CONFLICT', profileId, name);
  }
}

function assertNoQuery(url: string, name: string, profileId: string): void {
  const question = url.indexOf('?');
  if (question < 0) {
    return;
  }
  const hash = url.indexOf('#', question);
  const query = url.slice(question + 1, hash < 0 ? undefined : hash);
  const conflict = query.split('&').some((entry) => {
    const rawName = entry.split('=', 1)[0] ?? '';
    try {
      return decodeURIComponent(rawName.replace(/\+/gu, ' ')) === name;
    } catch {
      return rawName === name;
    }
  });
  if (conflict) {
    throw new AuthenticationError('CONFLICT', profileId, name);
  }
}

function appendQuery(url: string, name: string, value: string): string {
  const hash = url.indexOf('#');
  const beforeFragment = hash < 0 ? url : url.slice(0, hash);
  const fragment = hash < 0 ? '' : url.slice(hash);
  const separator = beforeFragment.includes('?')
    ? (beforeFragment.endsWith('?') || beforeFragment.endsWith('&') ? '' : '&')
    : '?';
  return `${beforeFragment}${separator}${encodeURIComponent(name)}=${encodeURIComponent(value)}${fragment}`;
}

function headerDecoration(name: string, value: string): AuthenticationDecoration {
  return Object.freeze({
    headers: Object.freeze([Object.freeze({ name, value })]),
    sensitiveHeaderNames: Object.freeze([name.toLowerCase()]),
  });
}

function authenticationErrorMessage(
  code: AuthenticationErrorCode,
  profileId?: string,
  field?: string,
): string {
  const profile = profileId === undefined ? '' : ` profile "${profileId}"`;
  const namedField = field === undefined ? '' : ` field "${field}"`;
  switch (code) {
    case 'DUPLICATE_PROVIDER': return `Authentication provider "${field ?? 'unknown'}" is registered more than once.`;
    case 'INVALID_PROVIDER': return 'Authentication provider registration is invalid.';
    case 'UNKNOWN_PROVIDER': return `Authentication${profile} uses an unsupported provider.`;
    case 'MISSING_PROFILE': return `Authentication profile "${profileId ?? 'unknown'}" is not configured.`;
    case 'INVALID_PROFILE': return `Authentication${profile} has an invalid${namedField}.`;
    case 'MISSING_CREDENTIAL': return `Authentication${profile} is missing${namedField}.`;
    case 'INVALID_CREDENTIAL': return `Authentication${profile} has an invalid${namedField}.`;
    case 'CONFLICT': return `Authentication${profile} conflicts with existing request${namedField}.`;
  }
}
