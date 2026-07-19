/**
 * Maps OpenAPI securitySchemes to API Runner authentication profiles.
 *
 * Secrets are never copied from the specification. Profiles use
 * `{ kind: 'secret' }` placeholders. OAuth2 / OpenID Connect are metadata-only
 * (notes + summary diagnostics) because login flows are out of scope.
 */

import type { GeneratedAuthProfile, ImportDiagnostic } from '../models';
import type { OpenApiRefResolver } from '../openapi/resolve';
import type {
  OpenApiDocument,
  OpenApiSecurityScheme,
} from '../openapi/types';
import { isReference } from '../openapi/types';
import { slugifyIdentifier } from '../sanitize';

export interface AuthGenerationResult {
  readonly profiles: readonly GeneratedAuthProfile[];
  /** scheme name → generated profile id */
  readonly schemeToProfileId: ReadonlyMap<string, string>;
  readonly diagnostics: readonly ImportDiagnostic[];
}

export function generateAuthProfiles(
  document: OpenApiDocument,
  resolver: OpenApiRefResolver,
  apiSlug: string,
  existingIds: ReadonlySet<string>,
): AuthGenerationResult {
  const diagnostics: ImportDiagnostic[] = [];
  const profiles: GeneratedAuthProfile[] = [];
  const schemeToProfileId = new Map<string, string>();
  const schemes = document.components?.securitySchemes ?? {};

  for (const [schemeName, schemeOrRef] of Object.entries(schemes)) {
    if (schemeOrRef === undefined) {
      continue;
    }

    let scheme: OpenApiSecurityScheme | undefined;
    if (isReference(schemeOrRef)) {
      const resolved = resolver.resolveRef<OpenApiSecurityScheme>(
        schemeOrRef.$ref,
      );
      diagnostics.push(...resolved.diagnostics);
      scheme = resolved.value;
    } else {
      scheme = schemeOrRef;
    }

    if (
      scheme === undefined ||
      typeof (scheme as { type?: unknown }).type !== 'string'
    ) {
      diagnostics.push({
        code: 'invalid-security-scheme',
        severity: 'warning',
        path: `/components/securitySchemes/${schemeName}`,
        message: `Ignoring security scheme "${schemeName}" with unknown shape.`,
      });
      continue;
    }

    const profileId = uniqueId(
      `imported-${apiSlug}-${slugifyIdentifier(schemeName, 'scheme')}`,
      existingIds,
      new Set(profiles.map((item) => item.profile.id)),
    );

    const mapped = mapScheme(schemeName, scheme, profileId, diagnostics);
    if (mapped === undefined) {
      continue;
    }

    profiles.push(mapped);
    schemeToProfileId.set(schemeName, profileId);

    if (mapped.notes !== undefined) {
      diagnostics.push({
        code: 'auth-metadata-only',
        severity: 'info',
        path: `/components/securitySchemes/${schemeName}`,
        message: mapped.notes,
      });
    }
  }

  return { profiles, schemeToProfileId, diagnostics };
}

function mapScheme(
  schemeName: string,
  scheme: OpenApiSecurityScheme,
  profileId: string,
  diagnostics: ImportDiagnostic[],
): GeneratedAuthProfile | undefined {
  const label = schemeName;
  const path = `/components/securitySchemes/${schemeName}`;

  switch (scheme.type) {
    case 'http': {
      const rawScheme = (scheme as { scheme?: unknown }).scheme;
      if (typeof rawScheme !== 'string' || rawScheme.trim().length === 0) {
        diagnostics.push({
          code: 'invalid-http-scheme',
          severity: 'warning',
          path,
          message: `HTTP security scheme "${schemeName}" is missing a scheme field; imported as none.`,
        });
        return {
          profile: { id: profileId, label, providerId: 'none' },
          secretHints: [],
          notes: `HTTP scheme "${schemeName}" missing scheme; provider none.`,
        };
      }
      const httpScheme = rawScheme.toLowerCase();
      if (httpScheme === 'bearer') {
        return {
          profile: {
            id: profileId,
            label,
            providerId: 'bearer',
            token: { kind: 'secret' },
          },
          secretHints: [
            `Populate SecretStorage for bearer profile "${profileId}" (token).`,
          ],
        };
      }
      if (httpScheme === 'basic') {
        return {
          profile: {
            id: profileId,
            label,
            providerId: 'basic',
            username: { kind: 'secret' },
            password: { kind: 'secret' },
          },
          secretHints: [
            `Populate SecretStorage for basic profile "${profileId}" (username, password).`,
          ],
        };
      }
      diagnostics.push({
        code: 'unsupported-http-scheme',
        severity: 'warning',
        path,
        message: `HTTP auth scheme "${rawScheme}" is not supported; imported as none.`,
      });
      return {
        profile: { id: profileId, label, providerId: 'none' },
        secretHints: [],
        notes: `HTTP auth scheme "${rawScheme}" is not a first-class provider; mapped to none.`,
      };
    }
    case 'apiKey': {
      const name = (scheme as { name?: unknown }).name;
      const location = (scheme as { in?: unknown }).in;
      if (typeof name !== 'string' || name.trim().length === 0) {
        diagnostics.push({
          code: 'invalid-api-key-scheme',
          severity: 'warning',
          path,
          message: `apiKey scheme "${schemeName}" is missing name; skipped.`,
        });
        return undefined;
      }
      if (
        location !== 'header' &&
        location !== 'query' &&
        location !== 'cookie'
      ) {
        diagnostics.push({
          code: 'invalid-api-key-scheme',
          severity: 'warning',
          path,
          message: `apiKey scheme "${schemeName}" has invalid in="${String(location)}"; skipped.`,
        });
        return undefined;
      }
      if (location === 'cookie') {
        return {
          profile: {
            id: profileId,
            label: `${label} (cookie)`,
            providerId: 'apiKey',
            name,
            location: 'header',
            value: { kind: 'secret' },
          },
          secretHints: [
            `Cookie API key "${name}" mapped as header apiKey profile "${profileId}". Prefer setting a Cookie header manually if needed.`,
          ],
          notes: `apiKey in cookie for "${schemeName}" is approximated as a header API key; cookie jar is not implemented.`,
        };
      }
      return {
        profile: {
          id: profileId,
          label,
          providerId: 'apiKey',
          name,
          location,
          value: { kind: 'secret' },
        },
        secretHints: [
          `Populate SecretStorage for API key profile "${profileId}" (${name} in ${location}).`,
        ],
      };
    }
    case 'oauth2':
      return {
        profile: {
          id: profileId,
          label: `${label} (OAuth2 metadata)`,
          providerId: 'none',
        },
        secretHints: [],
        notes: `OAuth2 scheme "${schemeName}" imported as metadata only (provider none). No login flow is configured.`,
      };
    case 'openIdConnect': {
      const url = (scheme as { openIdConnectUrl?: unknown }).openIdConnectUrl;
      const urlNote =
        typeof url === 'string' && url.length > 0
          ? ` Discovery URL: ${url}.`
          : '';
      return {
        profile: {
          id: profileId,
          label: `${label} (OpenID Connect metadata)`,
          providerId: 'none',
        },
        secretHints: [],
        notes: `OpenID Connect scheme "${schemeName}" imported as metadata only (provider none).${urlNote}`,
      };
    }
    case 'mutualTLS':
      return {
        profile: {
          id: profileId,
          label: `${label} (mTLS metadata)`,
          providerId: 'none',
        },
        secretHints: [],
        notes: `mutualTLS scheme "${schemeName}" imported as metadata only.`,
      };
    default:
      diagnostics.push({
        code: 'unsupported-security-scheme',
        severity: 'info',
        path,
        message: `Security scheme "${schemeName}" (type ${(scheme as { type: string }).type}) is recorded as metadata only.`,
      });
      return undefined;
  }
}

function uniqueId(
  preferred: string,
  existing: ReadonlySet<string>,
  pending: ReadonlySet<string>,
): string {
  if (!existing.has(preferred) && !pending.has(preferred)) {
    return preferred;
  }
  let index = 2;
  while (existing.has(`${preferred}-${index}`) || pending.has(`${preferred}-${index}`)) {
    index += 1;
  }
  return `${preferred}-${index}`;
}
