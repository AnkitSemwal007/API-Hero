/**
 * Authentication session model, health derivation, and secret field names.
 * Core module — no VS Code APIs.
 */

/** Derived / last-known session readiness (never a permanent "Connected"). */
export type AuthenticationSessionStatus =
  | 'unknown'
  | 'ready'
  | 'missing_secret'
  | 'expired'
  | 'unauthorized'
  | 'unhealthy';

/** How a session access token is applied on subsequent requests. */
export type AuthenticationSessionSendAs = 'bearer' | 'apiKey';

/**
 * Optional Login API configuration attached to an Authentication session.
 * Credentials and tokens live in Secret Storage — never in this metadata.
 */
export interface LoginApiConfig {
  readonly method: string;
  readonly url: string;
  /** Optional JSON body template; use `{{loginUsername}}` / `{{loginPassword}}` placeholders. */
  readonly bodyTemplate?: string;
  readonly contentType?: string;
  /** JSON path for access token (e.g. `access_token` or `data.accessToken`). */
  readonly tokenPath?: string;
  readonly refreshTokenPath?: string;
  readonly expiresInPath?: string;
  readonly expiresAtPath?: string;
  readonly sendAs: AuthenticationSessionSendAs;
  /** Optional API key header/query name when sendAs is apiKey. */
  readonly apiKeyName?: string;
  readonly apiKeyLocation?: 'header' | 'query';
}

/**
 * Non-secret session metadata for one Authentication profile.
 * Token material is never stored here — only presence flags and timestamps.
 */
export interface AuthenticationSession {
  readonly authenticationId: string;
  readonly status: AuthenticationSessionStatus;
  readonly accessTokenPresent?: boolean;
  readonly refreshTokenPresent?: boolean;
  /** ISO-8601 expiry when known. */
  readonly expiresAt?: string;
  readonly issuedAt?: string;
  readonly lastAuthenticatedAt?: string;
  readonly lastTestedAt?: string;
  readonly lastTestStatusCode?: number;
  /** Secret-free summary of the last test. */
  readonly lastTestSummary?: string;
  readonly login?: LoginApiConfig;
  /** Optional probe URL for Test Authentication when login is not configured. */
  readonly testUrl?: string;
}

/** Secret Storage field names for session token material. */
export const SESSION_SECRET_FIELDS = Object.freeze({
  accessToken: 'sessionAccessToken',
  refreshToken: 'sessionRefreshToken',
  loginUsername: 'loginUsername',
  loginPassword: 'loginPassword',
} as const);

/** Presentation DTO for Auth Manager / Request Editor health copy. */
export interface AuthenticationHealthPresentation {
  readonly status: AuthenticationSessionStatus;
  /** Short label shown in UI (never secrets). */
  readonly label: string;
  /** Longer hint under the label. */
  readonly detail: string;
}

export interface DeriveAuthenticationHealthOptions {
  readonly session: AuthenticationSession | undefined;
  readonly now?: number;
  /** When true, a configured secret-backed credential exists for the profile. */
  readonly profileSecretPresent?: boolean;
}

/**
 * Derives UI health from session metadata.
 * Never returns a permanent green "Connected" badge.
 */
export function deriveAuthenticationHealth(
  options: DeriveAuthenticationHealthOptions,
): AuthenticationHealthPresentation {
  const now = options.now ?? Date.now();
  const session = options.session;

  if (session === undefined) {
    if (options.profileSecretPresent === false) {
      return {
        status: 'missing_secret',
        label: 'Missing secret',
        detail: 'Credential is not set in Secret Storage.',
      };
    }
    return {
      status: 'unknown',
      label: 'Never tested',
      detail: 'Run Test Authentication to verify this Authentication.',
    };
  }

  if (session.status === 'unauthorized') {
    return {
      status: 'unauthorized',
      label: 'Unauthorized',
      detail: session.lastTestSummary ?? 'Last test returned 401.',
    };
  }

  if (session.status === 'unhealthy') {
    return {
      status: 'unhealthy',
      label: 'Needs Login',
      detail: session.lastTestSummary ?? 'Last test failed — run Login or Test again.',
    };
  }

  const expiresAtMs = parseIsoMs(session.expiresAt);
  if (expiresAtMs !== undefined && expiresAtMs <= now) {
    return {
      status: 'expired',
      label: 'Expired',
      detail: 'Session token has expired.',
    };
  }

  const sessionReady =
    session.accessTokenPresent === true || session.status === 'ready';

  if (expiresAtMs !== undefined && expiresAtMs > now && sessionReady) {
    const minutes = Math.max(1, Math.round((expiresAtMs - now) / 60_000));
    return {
      status: 'ready',
      label: `Expires in ${minutes}m`,
      detail: formatHealthyAge(session, now),
    };
  }

  if (sessionReady) {
    return {
      status: 'ready',
      label: formatHealthyAge(session, now),
      detail: session.lastTestSummary ?? formatLastTestedDetail(session, now),
    };
  }

  // Static profile credential missing — only after session readiness checks.
  if (
    session.status === 'missing_secret' ||
    options.profileSecretPresent === false
  ) {
    return {
      status: 'missing_secret',
      label: 'Missing secret',
      detail: 'Credential or session token is not set in Secret Storage.',
    };
  }

  if (session.lastTestedAt === undefined && session.lastAuthenticatedAt === undefined) {
    return {
      status: 'unknown',
      label: 'Never tested',
      detail: 'Run Test Authentication to verify this Authentication.',
    };
  }

  return {
    status: session.status,
    label: 'Never tested',
    detail: 'Run Test Authentication to verify this Authentication.',
  };
}

/**
 * Maps an HTTP status code from a test probe into a session status.
 */
export function sessionStatusFromTestStatusCode(
  statusCode: number,
): AuthenticationSessionStatus {
  if (statusCode === 401) {
    return 'unauthorized';
  }
  if (statusCode === 403) {
    return 'unauthorized';
  }
  if (statusCode >= 200 && statusCode < 300) {
    return 'ready';
  }
  if (statusCode >= 400) {
    return 'unhealthy';
  }
  return 'unknown';
}

/** Optional presentation fields for a richer secret-free last-test summary. */
export interface FormatAuthTestSummaryOptions {
  readonly statusCode: number;
  readonly url?: string;
  readonly latencyMs?: number;
  /** Presentation-only identity (email/username/sub) — never a token. */
  readonly identity?: string;
  readonly expiresAt?: string;
  readonly rateLimitRemaining?: string;
  readonly rateLimitLimit?: string;
}

/** Builds a secret-free last-test summary (optionally richer for Auth Manager). */
export function formatAuthTestSummary(
  statusCodeOrOptions: number | FormatAuthTestSummaryOptions,
): string {
  if (typeof statusCodeOrOptions === 'number') {
    return `HTTP ${statusCodeOrOptions}`;
  }
  const options = statusCodeOrOptions;
  const parts: string[] = [`HTTP ${options.statusCode}`];
  if (options.url !== undefined && options.url.trim().length > 0) {
    parts.push(options.url.trim());
  }
  if (options.latencyMs !== undefined && Number.isFinite(options.latencyMs)) {
    parts.push(`${Math.max(0, Math.round(options.latencyMs))}ms`);
  }
  if (options.identity !== undefined && options.identity.trim().length > 0) {
    parts.push(`user ${options.identity.trim()}`);
  }
  if (options.expiresAt !== undefined && options.expiresAt.trim().length > 0) {
    parts.push(`expires ${options.expiresAt.trim()}`);
  }
  const remaining = options.rateLimitRemaining?.trim();
  const limit = options.rateLimitLimit?.trim();
  if (remaining !== undefined && remaining.length > 0) {
    parts.push(
      limit !== undefined && limit.length > 0
        ? `rate ${remaining}/${limit}`
        : `rate remaining ${remaining}`,
    );
  }
  return parts.join(' · ');
}

function formatHealthyAge(
  session: AuthenticationSession,
  now: number,
): string {
  const anchor =
    parseIsoMs(session.lastTestedAt) ??
    parseIsoMs(session.lastAuthenticatedAt);
  if (anchor === undefined) {
    return 'Healthy';
  }
  const elapsedMs = Math.max(0, now - anchor);
  if (elapsedMs < 60_000) {
    return 'Healthy (just now)';
  }
  const minutes = Math.round(elapsedMs / 60_000);
  if (minutes < 60) {
    return `Healthy (${minutes}m ago)`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `Healthy (${hours}h ago)`;
  }
  const days = Math.round(hours / 24);
  return `Healthy (${days}d ago)`;
}

function formatLastTestedDetail(
  session: AuthenticationSession,
  now: number,
): string {
  const tested = parseIsoMs(session.lastTestedAt);
  if (tested === undefined) {
    return 'Session is ready.';
  }
  const elapsedMs = Math.max(0, now - tested);
  if (elapsedMs < 60_000) {
    return 'Last tested just now.';
  }
  const minutes = Math.round(elapsedMs / 60_000);
  if (minutes < 60) {
    return `Last tested ${minutes}m ago.`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `Last tested ${hours}h ago.`;
  }
  return `Last tested ${Math.round(hours / 24)}d ago.`;
}

function parseIsoMs(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Patch for {@link AuthenticationSessionStore.patch}; `expiresAt: null` clears expiry. */
export type AuthenticationSessionPatch = Partial<
  Omit<AuthenticationSession, 'authenticationId' | 'expiresAt'>
> & {
  readonly expiresAt?: string | null;
};

/** Immutable in-memory session map with optional change notifications. */
export class AuthenticationSessionStore {
  private readonly sessions = new Map<string, AuthenticationSession>();
  private readonly listeners = new Set<() => void>();

  public get(authenticationId: string): AuthenticationSession | undefined {
    return this.sessions.get(authenticationId);
  }

  public list(): readonly AuthenticationSession[] {
    return Object.freeze([...this.sessions.values()]);
  }

  public set(session: AuthenticationSession): void {
    this.sessions.set(session.authenticationId, Object.freeze({ ...session }));
    this.notify();
  }

  public patch(
    authenticationId: string,
    patch: AuthenticationSessionPatch,
  ): AuthenticationSession {
    const previous = this.sessions.get(authenticationId);
    const nextExpiresAt =
      patch.expiresAt === null
        ? undefined
        : patch.expiresAt !== undefined
          ? patch.expiresAt
          : previous?.expiresAt;
    const next: AuthenticationSession = Object.freeze({
      authenticationId,
      status: patch.status ?? previous?.status ?? 'unknown',
      ...(patch.accessTokenPresent !== undefined
        ? { accessTokenPresent: patch.accessTokenPresent }
        : previous?.accessTokenPresent !== undefined
          ? { accessTokenPresent: previous.accessTokenPresent }
          : {}),
      ...(patch.refreshTokenPresent !== undefined
        ? { refreshTokenPresent: patch.refreshTokenPresent }
        : previous?.refreshTokenPresent !== undefined
          ? { refreshTokenPresent: previous.refreshTokenPresent }
          : {}),
      ...(nextExpiresAt !== undefined ? { expiresAt: nextExpiresAt } : {}),
      ...(patch.issuedAt !== undefined
        ? { issuedAt: patch.issuedAt }
        : previous?.issuedAt !== undefined
          ? { issuedAt: previous.issuedAt }
          : {}),
      ...(patch.lastAuthenticatedAt !== undefined
        ? { lastAuthenticatedAt: patch.lastAuthenticatedAt }
        : previous?.lastAuthenticatedAt !== undefined
          ? { lastAuthenticatedAt: previous.lastAuthenticatedAt }
          : {}),
      ...(patch.lastTestedAt !== undefined
        ? { lastTestedAt: patch.lastTestedAt }
        : previous?.lastTestedAt !== undefined
          ? { lastTestedAt: previous.lastTestedAt }
          : {}),
      ...(patch.lastTestStatusCode !== undefined
        ? { lastTestStatusCode: patch.lastTestStatusCode }
        : previous?.lastTestStatusCode !== undefined
          ? { lastTestStatusCode: previous.lastTestStatusCode }
          : {}),
      ...(patch.lastTestSummary !== undefined
        ? { lastTestSummary: patch.lastTestSummary }
        : previous?.lastTestSummary !== undefined
          ? { lastTestSummary: previous.lastTestSummary }
          : {}),
      ...(patch.login !== undefined
        ? { login: patch.login }
        : previous?.login !== undefined
          ? { login: previous.login }
          : {}),
      ...(patch.testUrl !== undefined
        ? { testUrl: patch.testUrl }
        : previous?.testUrl !== undefined
          ? { testUrl: previous.testUrl }
          : {}),
    });
    this.sessions.set(authenticationId, next);
    this.notify();
    return next;
  }

  public delete(authenticationId: string): void {
    if (this.sessions.delete(authenticationId)) {
      this.notify();
    }
  }

  public replaceAll(sessions: readonly AuthenticationSession[]): void {
    this.sessions.clear();
    for (const session of sessions) {
      this.sessions.set(session.authenticationId, Object.freeze({ ...session }));
    }
    this.notify();
  }

  public onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}
