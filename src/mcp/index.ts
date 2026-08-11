/**
 * API Hero MCP adapter — headless discovery and execution for AI agents.
 * Framework-free except the MCP SDK server entry (`server.ts`).
 */

export {
  createHeadlessApiHeroRuntime,
  createNodeCollectionVariableStorePorts,
  resolveEnvironmentSelector,
  resolveMcpWorkspaceRoot,
  ProcessEnvSecretStore,
  toApiHeroSecretEnvName,
} from './composition';
export type {
  CreateHeadlessApiHeroRuntimeOptions,
  HeadlessApiHeroRuntime,
  ResolveMcpWorkspaceRootOptions,
} from './composition';

export { parseWorkspaceCliArg } from './workspace-cli';
export type { ParseWorkspaceCliArgResult } from './workspace-cli';

export { ApiHeroMcpService } from './service';
export type { ApiHeroMcpServiceDeps } from './service';

export { registerApiHeroMcpTools } from './tools';

export {
  mcpError,
  mcpOk,
  projectCollectionSummary,
  projectRequestRunResult,
  projectRunSummary,
  projectScenarioReport,
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
  McpScenarioRunDto,
} from './dto';

export {
  MCP_SECRET_MASK,
  isSensitiveKey,
  maskVariableIfSensitive,
  redactForMcp,
  redactRequestUrl,
} from './redact';
