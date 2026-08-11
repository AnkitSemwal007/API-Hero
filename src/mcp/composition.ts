/**
 * Re-exports shared headless composition for MCP call sites.
 * Prefer importing from `../headless` in new CLI code.
 */

export {
  createHeadlessApiHeroRuntime,
  createNodeCollectionVariableStorePorts,
  resolveEnvironmentSelector,
  resolveMcpWorkspaceRoot,
  ProcessEnvSecretStore,
  NodeProjectStoreFilesystem,
  toApiHeroSecretEnvName,
} from '../headless/composition';
export type {
  CreateHeadlessApiHeroRuntimeOptions,
  HeadlessApiHeroRuntime,
  ResolveMcpWorkspaceRootOptions,
} from '../headless/composition';
