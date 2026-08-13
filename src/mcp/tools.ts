/**
 * MCP tool registration for API Hero.
 * No `vscode` imports.
 */

import { z } from 'zod';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { mcpError } from './dto';
import type { ApiHeroMcpService } from './service';
import { redactForMcp } from './redact';

function jsonResult(payload: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  const safe = redactForMcp(payload);
  const text = JSON.stringify(safe, null, 2);
  const isError =
    typeof safe === 'object' &&
    safe !== null &&
    'ok' in safe &&
    (safe as { ok: unknown }).ok === false;
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

async function safeTool(
  run: () => Promise<unknown>,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    return jsonResult(await run());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected MCP tool failure.';
    return jsonResult(mcpError('INTERNAL', message));
  }
}

/** Registers all `apihero_*` tools on an MCP server. */
export function registerApiHeroMcpTools(
  server: McpServer,
  service: ApiHeroMcpService,
): void {
  server.registerTool(
    'apihero_list_collections',
    {
      title: 'List Collections',
      description:
        'List API Hero collections in the workspace (Collections/<Name>/). Returns name, id, request/folder counts, and kind.',
      inputSchema: {},
    },
    async () => safeTool(() => service.listCollections()),
  );

  server.registerTool(
    'apihero_get_collection',
    {
      title: 'Get Collection',
      description:
        'Get one collection by display name (preferred) or id, including folder tree, variable metadata (sensitive values masked), and auth metadata (never secrets).',
      inputSchema: {
        collection: z
          .string()
          .describe('Collection display name or id'),
      },
    },
    async ({ collection }) =>
      safeTool(() => service.getCollection(collection)),
  );

  server.registerTool(
    'apihero_list_requests',
    {
      title: 'List Requests',
      description:
        'List requests in a collection. Optional folder filters by relative folder path.',
      inputSchema: {
        collection: z.string().describe('Collection display name or id'),
        folder: z
          .string()
          .optional()
          .describe('Optional folder relative path within the collection'),
      },
    },
    async ({ collection, folder }) =>
      safeTool(() => service.listRequests(collection, folder)),
  );

  server.registerTool(
    'apihero_get_request',
    {
      title: 'Get Request',
      description:
        'Get request details (method, URL with userinfo redacted, auth metadata, variable refs). Prefer collection + request name; requestId alone is also accepted.',
      inputSchema: {
        collection: z
          .string()
          .optional()
          .describe('Collection display name or id'),
        request: z
          .string()
          .optional()
          .describe('Request display name or folder/name path'),
        requestId: z
          .string()
          .optional()
          .describe('Internal request id when known from a prior list call'),
      },
    },
    async (args) => safeTool(() => service.getRequest(args)),
  );

  server.registerTool(
    'apihero_run_request',
    {
      title: 'Run Request',
      description:
        'Execute a single request through the existing API Hero orchestrator (no live HTTP from the MCP layer). Returns structured outcome, assertions, failureDiagnostics, and secret-safe response presentation.',
      inputSchema: {
        collection: z
          .string()
          .optional()
          .describe('Collection display name or id'),
        request: z
          .string()
          .optional()
          .describe('Request display name or folder/name path'),
        requestId: z
          .string()
          .optional()
          .describe('Internal request id when known'),
      },
    },
    async (args) => safeTool(() => service.runRequest(args)),
  );

  server.registerTool(
    'apihero_run_collection',
    {
      title: 'Run Collection',
      description:
        'Run all requests in a collection via CollectionRunnerService. Optional failurePolicy: stop-on-first-error | continue-on-error | skip-invalid-requests (default continue-on-error). Optional retry (enabled, maxRetries, delayMs, backoff) and skipDestructiveRequests (DELETE only). Defaults omitted = no retries / no destructive skip. Per-request rows are slim; use apihero_get_request_result for full response bodies.',
      inputSchema: {
        collection: z.string().describe('Collection display name or id'),
        failurePolicy: z
          .enum([
            'stop-on-first-error',
            'continue-on-error',
            'skip-invalid-requests',
          ])
          .optional()
          .describe('How to handle request failures during the run'),
        retry: z
          .object({
            enabled: z.boolean().optional(),
            maxRetries: z.number().int().min(0).max(10).optional(),
            delayMs: z.number().int().min(0).max(60_000).optional(),
            backoff: z.enum(['fixed', 'exponential']).optional(),
          })
          .optional()
          .describe(
            'Optional retry controls. enabled default false; when enabled, defaults maxRetries=2, delayMs=500, backoff=exponential.',
          ),
        skipDestructiveRequests: z
          .boolean()
          .optional()
          .describe('When true, skip DELETE requests for this run'),
      },
    },
    async ({ collection, failurePolicy, retry, skipDestructiveRequests }) =>
      safeTool(() =>
        service.runCollection(
          collection,
          failurePolicy,
          retry === undefined && skipDestructiveRequests === undefined
            ? undefined
            : {
                ...(retry === undefined ? {} : { retry }),
                ...(skipDestructiveRequests === undefined
                  ? {}
                  : { skipDestructiveRequests }),
              },
        ),
      ),
  );

  server.registerTool(
    'apihero_get_run',
    {
      title: 'Get Run',
      description:
        'Retrieve a collection run summary (or in-progress session) by runId from the recent/active run manager.',
      inputSchema: {
        runId: z.string().describe('Run identifier returned by apihero_run_collection'),
      },
    },
    async ({ runId }) => safeTool(() => service.getRun(runId)),
  );

  server.registerTool(
    'apihero_get_request_result',
    {
      title: 'Get Request Result',
      description:
        'Retrieve one RequestRunResult from a prior collection run by runId and request id or label.',
      inputSchema: {
        runId: z.string().describe('Run identifier'),
        request: z
          .string()
          .describe('Request id or label within the run'),
      },
    },
    async ({ runId, request }) =>
      safeTool(() => service.getRequestResult(runId, request)),
  );
}
