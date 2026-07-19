import type { AuthenticationProfile } from '../../models';
import type {
  AuthenticationProfileIssue,
  AuthenticationProfileValidation,
  AuthenticationSecretRepository,
} from '../../auth';
import type {
  ApiDocument,
  AstDiagnostic,
  DirectiveNode,
} from '../../parser';

export const AUTHENTICATION_DIAGNOSTIC_CODES = Object.freeze({
  missingProfile: 'authentication.missing-profile',
  duplicateProfile: 'authentication.duplicate-profile',
  unsupportedProvider: 'authentication.unsupported-provider',
  invalidProfile: 'authentication.invalid-profile',
  missingSecret: 'authentication.missing-secret',
});

export interface AuthenticationDiagnosticContext {
  /** The shared validated snapshot; diagnostics never reinterpret raw profiles. */
  readonly validation: AuthenticationProfileValidation;
  readonly providerIds: readonly string[];
}

export interface AuthenticationAvailabilityContext
extends AuthenticationDiagnosticContext {
  readonly secrets: AuthenticationSecretRepository;
}

/** Dynamic profile checks layered once onto canonical parser diagnostics. */
export function createAuthenticationDiagnostics(
  document: ApiDocument,
  context?: AuthenticationDiagnosticContext,
): readonly AstDiagnostic[] {
  if (context === undefined) {
    return [];
  }
  const validProfiles = new Map(
    context.validation.profiles.map((profile) => [profile.id, profile]),
  );
  const issuesById = new Map<string, AuthenticationProfileIssue>();
  for (const issue of context.validation.issues) {
    if (issue.profileId !== undefined && !issuesById.has(issue.profileId)) {
      issuesById.set(issue.profileId, issue);
    }
  }
  const providerIds = new Set(context.providerIds);
  const directives = authDirectives(document);
  return directives.flatMap((directive) =>
    diagnosticForDirective(directive, validProfiles, issuesById, providerIds));
}

/** Async availability checks reuse the already parsed canonical document. */
export async function createAuthenticationAvailabilityDiagnostics(
  document: ApiDocument,
  context?: AuthenticationAvailabilityContext,
): Promise<readonly AstDiagnostic[]> {
  if (context === undefined) {
    return [];
  }
  const byId = new Map(
    context.validation.profiles.map((profile) => [profile.id, profile]),
  );
  const directives = authDirectives(document);
  const diagnostics: AstDiagnostic[] = [];
  for (const directive of directives) {
    const profile = byId.get(directive.value.trim());
    if (profile === undefined) {
      continue;
    }
    for (const field of secretFields(profile)) {
      if (await context.secrets.get(profile.id, field) === undefined) {
        diagnostics.push(diagnostic(
          directive,
          AUTHENTICATION_DIAGNOSTIC_CODES.missingSecret,
          `Authentication profile "${profile.id}" is missing secret field "${field}".`,
        ));
      }
    }
  }
  return Object.freeze(diagnostics);
}

function secretFields(profile: AuthenticationProfile): readonly string[] {
  const fields = profile.providerId === 'basic'
    ? ['username', 'password']
    : profile.providerId === 'bearer'
      ? ['token']
      : profile.providerId === 'apiKey'
        ? ['value']
        : [];
  const data = profile as Readonly<Record<string, unknown>>;
  return fields.filter((field) => {
    const source = data[field];
    return typeof source === 'object' &&
      source !== null &&
      'kind' in source &&
      source.kind === 'secret';
  });
}

function authDirectives(document: ApiDocument): readonly DirectiveNode[] {
  return [
    ...document.directives,
    ...document.requests.flatMap((request) => request.directives),
  ].filter((directive) => directive.knownName === 'auth');
}

function diagnosticForDirective(
  directive: DirectiveNode,
  validProfiles: ReadonlyMap<string, AuthenticationProfile>,
  issuesById: ReadonlyMap<string, AuthenticationProfileIssue>,
  providerIds: ReadonlySet<string>,
): readonly AstDiagnostic[] {
  const id = directive.value.trim();
  const issue = issuesById.get(id);
  if (issue !== undefined) {
    if (issue.code === 'duplicate-id') {
      return [diagnostic(
        directive,
        AUTHENTICATION_DIAGNOSTIC_CODES.duplicateProfile,
        `Authentication profile "${id}" is configured more than once.`,
      )];
    }
    return [diagnostic(
      directive,
      AUTHENTICATION_DIAGNOSTIC_CODES.invalidProfile,
      `Authentication profile "${id}" has invalid configuration.`,
    )];
  }
  const profile = validProfiles.get(id);
  if (profile === undefined) {
    return [diagnostic(
      directive,
      AUTHENTICATION_DIAGNOSTIC_CODES.missingProfile,
      `Authentication profile "${id}" is not configured.`,
    )];
  }
  if (!providerIds.has(profile.providerId)) {
    return [diagnostic(
      directive,
      AUTHENTICATION_DIAGNOSTIC_CODES.unsupportedProvider,
      `Authentication profile "${id}" uses an unsupported provider.`,
    )];
  }
  return [];
}

function diagnostic(
  directive: DirectiveNode,
  code: string,
  message: string,
): AstDiagnostic {
  return Object.freeze({
    code,
    message,
    severity: 'error',
    range: directive.range,
    location: directive.location,
    source: 'api-runner',
  });
}
