/**
 * Shared headless composition for CLI and MCP — no protocol, no vscode.
 */

export {
  createHeadlessApiHeroRuntime,
  createNodeCollectionVariableStorePorts,
  resolveEnvironmentSelector,
  resolveMcpWorkspaceRoot,
  ProcessEnvSecretStore,
  NodeProjectStoreFilesystem,
  toApiHeroSecretEnvName,
} from './composition';
export type {
  CreateHeadlessApiHeroRuntimeOptions,
  HeadlessApiHeroRuntime,
  ResolveMcpWorkspaceRootOptions,
} from './composition';
