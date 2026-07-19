/**
 * Builds workspace environments from OpenAPI `servers`.
 *
 * Strategy:
 * - First server → primary environment `{apiName}` with `baseUrl` (and host/port
 *   when parseable), activated by default.
 * - Additional servers (up to 5) → separate environments with distinct ids.
 * - Server `{variables}` become environment variables; URL placeholders use
 *   `{{varName}}` syntax in `baseUrl`.
 */

import type {
  GeneratedEnvironment,
  GeneratedVariable,
  ImportDiagnostic,
} from '../models';
import type { OpenApiDocument, OpenApiServer } from '../openapi/types';
import { slugifyIdentifier } from '../sanitize';

export interface EnvironmentGenerationResult {
  readonly environments: readonly GeneratedEnvironment[];
  readonly diagnostics: readonly ImportDiagnostic[];
}

export function generateEnvironments(
  document: OpenApiDocument,
  apiSlug: string,
  existingIds: ReadonlySet<string>,
): EnvironmentGenerationResult {
  const diagnostics: ImportDiagnostic[] = [];
  const servers = document.servers ?? [];
  const environments: GeneratedEnvironment[] = [];

  if (servers.length === 0) {
    const id = uniqueEnvId(`imported-${apiSlug}`, existingIds, environments);
    environments.push({
      id,
      name: `${document.info.title} (imported)`,
      activate: true,
      variables: [
        { name: 'baseUrl', value: 'https://api.example.com', sensitive: false },
      ],
    });
    diagnostics.push({
      code: 'default-base-url',
      severity: 'info',
      message:
        'No servers defined; created environment with placeholder baseUrl https://api.example.com.',
    });
    return { environments, diagnostics };
  }

  const limited = servers.slice(0, 5);
  if (servers.length > 5) {
    diagnostics.push({
      code: 'servers-truncated',
      severity: 'warning',
      path: '/servers',
      message: `Only the first 5 of ${servers.length} servers were imported as environments.`,
    });
  }

  for (const [index, server] of limited.entries()) {
    const mapped = mapServer(server, document.info.title, apiSlug, index, existingIds, environments);
    environments.push(mapped.environment);
    diagnostics.push(...mapped.diagnostics);
  }

  return { environments, diagnostics };
}

function mapServer(
  server: OpenApiServer,
  apiTitle: string,
  apiSlug: string,
  index: number,
  existingIds: ReadonlySet<string>,
  pending: readonly GeneratedEnvironment[],
): {
  readonly environment: GeneratedEnvironment;
  readonly diagnostics: readonly ImportDiagnostic[];
} {
  const diagnostics: ImportDiagnostic[] = [];
  const suffix =
    index === 0
      ? ''
      : `-${slugifyIdentifier(server.description ?? `server${index + 1}`, `s${index + 1}`)}`;
  const id = uniqueEnvId(`imported-${apiSlug}${suffix}`, existingIds, pending);
  const name =
    index === 0
      ? `${apiTitle} (imported)`
      : `${apiTitle} — ${server.description ?? `Server ${index + 1}`}`;

  const { baseUrl, variables } = expandServerUrl(server);
  const hostPort = deriveHostPort(baseUrl);
  const allVariables: GeneratedVariable[] = [
    { name: 'baseUrl', value: baseUrl, sensitive: false },
    ...hostPort,
    ...variables,
  ];

  if (server.url.includes('{') && Object.keys(server.variables ?? {}).length === 0) {
    diagnostics.push({
      code: 'server-variables-missing',
      severity: 'warning',
      path: `/servers/${index}`,
      message: `Server URL "${server.url}" contains templates but no variables map; placeholders may be incomplete.`,
    });
  }

  return {
    environment: {
      id,
      name,
      activate: index === 0,
      variables: allVariables,
    },
    diagnostics,
  };
}

function expandServerUrl(server: OpenApiServer): {
  readonly baseUrl: string;
  readonly variables: readonly GeneratedVariable[];
} {
  const variables: GeneratedVariable[] = [];
  let baseUrl = server.url.replace(/\/$/u, '');

  const serverVars = server.variables ?? {};
  for (const [name, definition] of Object.entries(serverVars)) {
    if (definition === undefined) {
      continue;
    }
    const value =
      typeof definition.default === 'string' ? definition.default : '';
    variables.push({
      name: sanitizeVarName(name),
      value,
      sensitive: false,
    });
    baseUrl = baseUrl.replaceAll(`{${name}}`, `{{${sanitizeVarName(name)}}}`);
  }

  // Any remaining {var} without definition → {{var}}
  baseUrl = baseUrl.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, '{{$1}}');

  return { baseUrl, variables };
}

function deriveHostPort(baseUrl: string): readonly GeneratedVariable[] {
  const result: GeneratedVariable[] = [];
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(baseUrl)
      ? baseUrl
      : `https://${baseUrl}`;
    // Template vars break URL parsing — skip host/port when present.
    if (withScheme.includes('{{')) {
      return result;
    }
    const url = new URL(withScheme);
    if (url.hostname.length > 0) {
      result.push({ name: 'host', value: url.hostname, sensitive: false });
    }
    if (url.port.length > 0) {
      result.push({ name: 'port', value: url.port, sensitive: false });
    } else if (url.protocol === 'https:') {
      result.push({ name: 'port', value: '443', sensitive: false });
    } else if (url.protocol === 'http:') {
      result.push({ name: 'port', value: '80', sensitive: false });
    }
  } catch {
    // Ignore unparsable base URLs.
  }
  return result;
}

function sanitizeVarName(name: string): string {
  const cleaned = name.replace(/[^\w.-]/gu, '_');
  return /^[A-Za-z_]/u.test(cleaned) ? cleaned : `var_${cleaned}`;
}

function uniqueEnvId(
  preferred: string,
  existing: ReadonlySet<string>,
  pending: readonly GeneratedEnvironment[],
): string {
  const pendingIds = new Set(pending.map((item) => item.id));
  if (!existing.has(preferred) && !pendingIds.has(preferred)) {
    return preferred;
  }
  let index = 2;
  while (
    existing.has(`${preferred}-${index}`) ||
    pendingIds.has(`${preferred}-${index}`)
  ) {
    index += 1;
  }
  return `${preferred}-${index}`;
}
