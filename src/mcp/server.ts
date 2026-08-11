#!/usr/bin/env node
/**
 * Standalone MCP stdio server entry for API Hero.
 * Spawn via `api-hero-mcp` or `node dist/mcp/server.js`.
 * Workspace (priority): `--workspace` → `APIHERO_WORKSPACE` → process cwd
 * (must contain Collections/).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  createHeadlessApiHeroRuntime,
  resolveMcpWorkspaceRoot,
} from './composition';
import { ApiHeroMcpService } from './service';
import { registerApiHeroMcpTools } from './tools';
import { parseWorkspaceCliArg } from './workspace-cli';

async function main(): Promise<void> {
  const parsed = parseWorkspaceCliArg(process.argv.slice(2));
  if (parsed.status === 'error') {
    process.stderr.write(`api-hero-mcp: ${parsed.message}\n`);
    process.exit(1);
  }

  const workspaceRoot = resolveMcpWorkspaceRoot({
    cliWorkspace: parsed.status === 'set' ? parsed.workspace : undefined,
  });
  const runtime = createHeadlessApiHeroRuntime({
    workspaceRoot,
    verbose: process.env.APIHERO_MCP_VERBOSE === '1',
  });
  // Prime discovery so the first tool call is warm.
  await runtime.discovery.refresh().catch(() => undefined);

  const service = ApiHeroMcpService.fromRuntime(runtime);
  const server = new McpServer({
    name: 'api-hero',
    version: '2.8.2',
  });
  registerApiHeroMcpTools(server, service);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`api-hero-mcp failed: ${message}\n`);
  process.exit(1);
});
