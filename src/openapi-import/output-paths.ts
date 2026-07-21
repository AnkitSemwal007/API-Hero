/**
 * Output-path helpers for OpenAPI import.
 *
 * Imports write under `Collections/<name>/` with an `api-hero.collection.json`
 * marker so they become native collections.
 */

import { COLLECTIONS_DIRECTORY_NAME } from '../collections/constants';
import { sanitizePathSegment, slugifyIdentifier } from './sanitize';

/**
 * Native-collection output directory for OpenAPI import:
 * `Collections/<sanitized-slug>/`.
 */
export function collectionsImportOutputDirectory(apiSlug: string): string {
  const segment =
    sanitizePathSegment(apiSlug) ||
    slugifyIdentifier(apiSlug, 'imported-api');
  return `${COLLECTIONS_DIRECTORY_NAME}/${segment}`;
}
