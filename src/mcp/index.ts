/**
 * API Hero MCP adapter — headless discovery and execution for AI agents.
 * Framework-free except the MCP SDK server entry (`server.ts`).
 */

export {
  createHeadlessApiHeroRuntime,
  createNodeCollectionVariableStorePorts,
  resolveMcpWorkspaceRoot,
} from './composition';
export type {
  CreateHeadlessApiHeroRuntimeOptions,
  HeadlessApiHeroRuntime,
} from './composition';

export { ApiHeroMcpService } from './service';
export type { ApiHeroMcpServiceDeps } from './service';

export { registerApiHeroMcpTools } from './tools';

export {
  mcpError,
  mcpOk,
  projectCollectionSummary,
  projectRequestRunResult,
  projectRunSummary,
} from './dto';
export type {
  McpAuthMetadata,
  McpCollectionDetail,
  McpCollectionSummary,
  McpErrorResult,
  McpOkResult,
  McpRequestDetail,
  McpRequestRunDto,
  McpRequestSummary,
  McpResult,
  McpRunSummaryDto,
} from './dto';

export {
  MCP_SECRET_MASK,
  isSensitiveKey,
  maskVariableIfSensitive,
  redactForMcp,
  redactRequestUrl,
} from './redact';
