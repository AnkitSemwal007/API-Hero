/**
 * Validates OpenAPI version and required document fields.
 * Returns diagnostics without throwing.
 */

import type { ImportDiagnostic } from '../models';
import type { OpenApiDocument } from './types';

const OPENAPI_VERSION = /^3\.(0|1)(\.\d+)?$/u;

export interface ValidateOpenApiResult {
  readonly ok: boolean;
  readonly diagnostics: readonly ImportDiagnostic[];
}

/** Validates version 3.0.x / 3.1.x and required info fields. */
export function validateOpenApiDocument(
  document: OpenApiDocument,
): ValidateOpenApiResult {
  const diagnostics: ImportDiagnostic[] = [];

  if (!OPENAPI_VERSION.test(document.openapi)) {
    diagnostics.push({
      code: 'unsupported-openapi-version',
      severity: 'error',
      path: '/openapi',
      message:
        document.openapi.length === 0
          ? 'Missing openapi version. Only OpenAPI 3.0.x and 3.1.x are supported.'
          : `Unsupported OpenAPI version "${document.openapi}". Only 3.0.x and 3.1.x are supported (Swagger 2.0 is not).`,
    });
  }

  if (document.info.title.trim().length === 0) {
    diagnostics.push({
      code: 'missing-info-title',
      severity: 'error',
      path: '/info/title',
      message: 'info.title is required.',
    });
  }

  if (document.info.version.trim().length === 0) {
    diagnostics.push({
      code: 'missing-info-version',
      severity: 'error',
      path: '/info/version',
      message: 'info.version is required.',
    });
  }

  if (document.paths === undefined) {
    diagnostics.push({
      code: 'missing-paths',
      severity: 'warning',
      path: '/paths',
      message: 'Document has no paths object; no requests will be generated.',
    });
  }

  const hasError = diagnostics.some((item) => item.severity === 'error');
  return { ok: !hasError, diagnostics };
}

/** True when the openapi field is a supported 3.0 / 3.1 version string. */
export function isSupportedOpenApiVersion(version: string): boolean {
  return OPENAPI_VERSION.test(version.trim());
}
