/** VS Code adapters for environments and the Environment Manager panel. */
export {
  allocateEnvironmentId,
  escapeAttribute,
  isValidVariableName,
  maskEnvironmentManagerState,
  parseEnvironmentManagerMessage,
  renderEnvironmentManagerHtml,
  restoreEnvironmentManagerState,
  validateEnvironmentManagerState,
} from './environment-manager-html';
export type {
  EnvironmentManagerEnvironment,
  EnvironmentManagerInboundMessage,
  EnvironmentManagerOutboundMessage,
  EnvironmentManagerState,
  EnvironmentManagerVariable,
} from './environment-manager-html';
export { EnvironmentManagerPanel } from './environment-manager-panel';
export { EnvironmentStatusBar } from './environment-status-bar';
export {
  writeActiveEnvironmentId,
  writeEnvironmentManagerState,
} from './environment-settings-writer';
export { registerEnvironments } from './register-environments';
export type {
  EnvironmentsRegistration,
  RegisterEnvironmentsOptions,
} from './register-environments';
