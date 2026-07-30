/**
 * Builds a minimal AuthenticatedRequest for Login API / Test Authentication
 * probes. Uses none-auth decoration so credentials live in the body/headers
 * constructed by the caller — no raw fetch.
 */

import type { AuthenticatedRequest, HttpMethod } from '../models';
import { deepFreeze } from '../shared';

export interface ProbeRequestInput {
  readonly method: string;
  readonly url: string;
  readonly headers?: readonly { readonly name: string; readonly value: string }[];
  readonly bodyText?: string;
  readonly contentType?: string;
  readonly timeoutMs?: number;
}

/** Creates a deeply frozen AuthenticatedRequest with scheme `none`. */
export function buildProbeAuthenticatedRequest(
  input: ProbeRequestInput,
): AuthenticatedRequest {
  const method = input.method.trim().toUpperCase() || 'GET';
  const headers = [...(input.headers ?? [])];
  if (
    input.bodyText !== undefined &&
    input.contentType !== undefined &&
    input.contentType.trim().length > 0 &&
    !headers.some((header) => header.name.toLowerCase() === 'content-type')
  ) {
    headers.push({ name: 'Content-Type', value: input.contentType.trim() });
  }
  const hasBody = input.bodyText !== undefined && input.bodyText.length > 0;
  return deepFreeze({
    id: 'auth-probe',
    method: method as HttpMethod,
    url: input.url.trim(),
    headers,
    queryParameters: [],
    pathParameters: [],
    cookies: [],
    ...(hasBody
      ? {
          body: {
            type: 'text' as const,
            content: input.bodyText!,
          },
          bodyType: 'text' as const,
        }
      : { bodyType: 'none' as const }),
    authentication: {
      kind: 'resolved',
      scheme: 'none',
      material: {},
      extensions: {},
    },
    variables: [],
    environment: { kind: 'none', extensions: {} },
    metadata: { declarationIndex: 0, tags: [], extensions: {} },
    configuration: { directives: [], extensions: {} },
    redirectPolicy: { mode: 'follow' },
    ssl: { verifyCertificates: true, extensions: {} },
    executionExtensions: {},
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    resolution: {
      kind: 'resolved',
      presentationUrl: input.url.trim(),
      sensitiveVariableNames: [],
      sensitiveHeaderNames: [],
      sensitiveQueryParameterNames: [],
    },
    authenticationStage: 'authenticated',
  });
}
