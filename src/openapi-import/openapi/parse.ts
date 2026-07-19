/**
 * Maps a parsed JSON/YAML root into a typed OpenAPI document shape.
 * Unsupported fields are ignored safely; required fields are checked by validate.
 */

import type { ImportDiagnostic } from '../models';
import { maskImportSecretText } from '../sanitize';
import type {
  OpenApiComponents,
  OpenApiDocument,
  OpenApiInfo,
  OpenApiOperation,
  OpenApiPathItem,
  OpenApiServer,
  OpenApiTag,
} from './types';
import { OPENAPI_HTTP_METHODS } from './types';

export interface ParseOpenApiResult {
  readonly document?: OpenApiDocument;
  readonly diagnostics: readonly ImportDiagnostic[];
}

/** Best-effort structural mapping; does not fully validate. */
export function parseOpenApiDocument(root: unknown): ParseOpenApiResult {
  const diagnostics: ImportDiagnostic[] = [];
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    return {
      diagnostics: [
        {
          code: 'invalid-root',
          severity: 'error',
          message: 'OpenAPI document must be an object.',
        },
      ],
    };
  }

  const raw = root as Record<string, unknown>;
  const openapi = typeof raw.openapi === 'string' ? raw.openapi.trim() : '';
  const info = mapInfo(raw.info, diagnostics);
  const servers = mapServers(raw.servers, diagnostics);
  const paths = mapPaths(raw.paths, diagnostics);
  const components = mapComponents(raw.components);
  const tags = mapTags(raw.tags);
  const security = mapSecurity(raw.security);
  const externalDocs = mapExternalDocs(raw.externalDocs);

  if (info === undefined) {
    return { diagnostics };
  }

  const document: OpenApiDocument = {
    openapi,
    info,
    ...(servers === undefined ? {} : { servers }),
    ...(paths === undefined ? {} : { paths }),
    ...(components === undefined ? {} : { components }),
    ...(tags === undefined ? {} : { tags }),
    ...(security === undefined ? {} : { security }),
    ...(externalDocs === undefined ? {} : { externalDocs }),
  };

  return { document, diagnostics };
}

function mapInfo(
  value: unknown,
  diagnostics: ImportDiagnostic[],
): OpenApiInfo | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    diagnostics.push({
      code: 'missing-info',
      severity: 'error',
      path: '/info',
      message: 'OpenAPI document requires an info object.',
    });
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const title = typeof raw.title === 'string' ? raw.title : '';
  const version = typeof raw.version === 'string' ? raw.version : '';
  return {
    title,
    version,
    ...(typeof raw.description === 'string'
      ? { description: raw.description }
      : {}),
    ...(typeof raw.termsOfService === 'string'
      ? { termsOfService: raw.termsOfService }
      : {}),
  };
}

function mapServers(
  value: unknown,
  diagnostics: ImportDiagnostic[],
): readonly OpenApiServer[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    diagnostics.push({
      code: 'invalid-servers',
      severity: 'warning',
      path: '/servers',
      message: 'Ignoring non-array servers field.',
    });
    return undefined;
  }
  const servers: OpenApiServer[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      diagnostics.push({
        code: 'invalid-server',
        severity: 'warning',
        path: `/servers/${index}`,
        message: 'Ignoring malformed server entry.',
      });
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.url !== 'string' || raw.url.trim().length === 0) {
      diagnostics.push({
        code: 'invalid-server-url',
        severity: 'warning',
        path: `/servers/${index}/url`,
        message: 'Ignoring server without a url.',
      });
      continue;
    }
    servers.push({
      url: raw.url,
      ...(typeof raw.description === 'string'
        ? { description: raw.description }
        : {}),
      ...(typeof raw.variables === 'object' &&
      raw.variables !== null &&
      !Array.isArray(raw.variables)
        ? {
            variables: raw.variables as OpenApiServer['variables'],
          }
        : {}),
    });
  }
  return servers.length > 0 ? servers : undefined;
}

function mapPaths(
  value: unknown,
  diagnostics: ImportDiagnostic[],
): OpenApiDocument['paths'] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    diagnostics.push({
      code: 'invalid-paths',
      severity: 'warning',
      path: '/paths',
      message: 'Ignoring non-object paths field.',
    });
    return undefined;
  }
  const result: Record<string, OpenApiPathItem> = {};
  for (const [pathKey, pathValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!pathKey.startsWith('/')) {
      diagnostics.push({
        code: 'invalid-path-key',
        severity: 'warning',
        path: `/paths/${pathKey}`,
        message: maskImportSecretText(
          `Ignoring path key that does not start with "/": ${pathKey}`,
        ),
      });
      continue;
    }
    const mapped = mapPathItem(
      pathValue,
      `/paths/${encodeURIComponent(pathKey)}`,
      diagnostics,
    );
    if (mapped !== undefined) {
      result[pathKey] = mapped;
    }
  }
  return result;
}

function mapPathItem(
  value: unknown,
  pointer: string,
  diagnostics: ImportDiagnostic[],
): OpenApiPathItem | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    diagnostics.push({
      code: 'invalid-path-item',
      severity: 'warning',
      path: pointer,
      message: 'Ignoring malformed path item.',
    });
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const item: Record<string, unknown> = {};
  if (typeof raw.$ref === 'string') {
    item.$ref = raw.$ref;
  }
  if (typeof raw.summary === 'string') {
    item.summary = raw.summary;
  }
  if (typeof raw.description === 'string') {
    item.description = raw.description;
  }
  if (Array.isArray(raw.parameters)) {
    item.parameters = raw.parameters;
  }
  if (Array.isArray(raw.servers)) {
    item.servers = raw.servers;
  }
  for (const method of OPENAPI_HTTP_METHODS) {
    if (raw[method] !== undefined) {
      item[method] = mapOperation(
        raw[method],
        `${pointer}/${method}`,
        diagnostics,
      );
    }
  }
  return item as OpenApiPathItem;
}

function mapOperation(
  value: unknown,
  pointer: string,
  diagnostics: ImportDiagnostic[],
): OpenApiOperation | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    diagnostics.push({
      code: 'invalid-operation',
      severity: 'warning',
      path: pointer,
      message: 'Ignoring malformed operation.',
    });
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const tags = normalizeStringArray(raw.tags);
  const operation: Record<string, unknown> = { ...raw };
  if (tags !== undefined) {
    operation.tags = tags;
  } else {
    delete operation.tags;
  }
  return operation as OpenApiOperation;
}

/** Keeps only non-empty string tags; ignores malformed tag entries. */
function normalizeStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
  return items.length > 0 ? items : undefined;
}

function mapComponents(value: unknown): OpenApiComponents | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as OpenApiComponents;
}

function mapTags(value: unknown): readonly OpenApiTag[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const tags: OpenApiTag[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
      continue;
    }
    tags.push({
      name: raw.name,
      ...(typeof raw.description === 'string'
        ? { description: raw.description }
        : {}),
    });
  }
  return tags.length > 0 ? tags : undefined;
}

function mapSecurity(
  value: unknown,
): OpenApiDocument['security'] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value as OpenApiDocument['security'];
}

function mapExternalDocs(
  value: unknown,
): OpenApiDocument['externalDocs'] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.url !== 'string') {
    return undefined;
  }
  return {
    url: raw.url,
    ...(typeof raw.description === 'string'
      ? { description: raw.description }
      : {}),
  };
}
