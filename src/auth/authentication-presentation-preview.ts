/**
 * Secret-free Auth Manager presentation preview strings.
 * Shared by host tests and the Auth Manager webview (via injected constants).
 * Never includes credential values.
 */

/** Presentation mask matching auth provider URL decoration glyphs. */
export const AUTHENTICATION_PRESENTATION_MASK = '••••••••';

/** Prefix for Basic-auth missing-secret validation copy. */
export const BASIC_MISSING_VALIDATION_PREFIX = 'Missing: ';

/** Suffix for Basic-auth missing-secret validation copy. */
export const BASIC_MISSING_VALIDATION_SUFFIX = '.';

/** Secret field status used for preview readiness copy (never includes values). */
export interface AuthenticationPresentationSecretField {
  readonly field: string;
  readonly label: string;
  readonly status: 'set' | 'missing';
}

/** Input for Auth Manager presentation preview (metadata + secret status only). */
export interface AuthenticationPresentationPreviewInput {
  readonly providerId: string;
  readonly secretFields?: readonly AuthenticationPresentationSecretField[];
  readonly apiKeyName?: string;
  readonly apiKeyLocation?: 'header' | 'query';
}

/** Preview line and validation hint shown beside Auth Manager Preview. */
export interface AuthenticationPresentationPreview {
  readonly preview: string;
  readonly validation: string;
}

/**
 * Formats Basic-auth missing-secret validation from field labels.
 * Shared by the core preview helper and the Auth Manager webview adapter.
 */
export function formatBasicMissingValidation(
  labels: readonly string[],
): string {
  return `${BASIC_MISSING_VALIDATION_PREFIX}${labels.join(', ')}${BASIC_MISSING_VALIDATION_SUFFIX}`;
}

/**
 * Builds the Auth Manager Preview tab strings for a profile draft.
 * Empty-selection copy (`Select a profile to preview.`) stays in the webview.
 */
export function buildAuthenticationPresentationPreview(
  input: AuthenticationPresentationPreviewInput,
): AuthenticationPresentationPreview {
  const missing = (input.secretFields ?? []).filter(
    (field) => field.status === 'missing',
  );
  const mask = AUTHENTICATION_PRESENTATION_MASK;

  if (input.providerId === 'none') {
    return {
      preview: 'No authentication headers will be added.',
      validation: '',
    };
  }
  if (input.providerId === 'bearer') {
    return {
      preview: `Authorization: Bearer ${mask}`,
      validation:
        missing.length > 0
          ? 'Token secret is missing.'
          : 'Ready — token is set.',
    };
  }
  if (input.providerId === 'basic') {
    return {
      preview: `Authorization: Basic ${mask}`,
      validation:
        missing.length > 0
          ? formatBasicMissingValidation(missing.map((field) => field.label))
          : 'Ready — username and password are set.',
    };
  }
  if (input.providerId === 'apiKey') {
    const name = (input.apiKeyName || 'X-API-Key').trim() || 'X-API-Key';
    const location = input.apiKeyLocation === 'query' ? 'query' : 'header';
    return {
      preview:
        location === 'query'
          ? `Query: ${name}=${mask}`
          : `${name}: ${mask}`,
      validation:
        missing.length > 0
          ? 'API key secret is missing.'
          : !input.apiKeyName || !input.apiKeyName.trim()
            ? 'Key name is empty — set a header or query parameter name.'
            : 'Ready — API key secret is set.',
    };
  }
  return { preview: 'Unknown provider.', validation: 'Unsupported provider.' };
}
