/** VS Code adapters for the Auth Profiles Manager panel. */
export {
  allocateAuthProfileId,
  escapeAttribute,
  isAuthManagerProviderId,
  isValidAuthProfileId,
  parseAuthManagerMessage,
  renderAuthManagerHtml,
  secretFieldsForProvider,
  validateAuthManagerState,
  AUTH_PROVIDER_IDS,
} from './auth-manager-html';
export type {
  AuthManagerInboundMessage,
  AuthManagerOutboundMessage,
  AuthManagerProfile,
  AuthManagerProviderId,
  AuthManagerSecretField,
  AuthManagerState,
} from './auth-manager-html';
export { AuthManagerPanel } from './auth-manager-panel';
export type { AuthManagerPanelOptions } from './auth-manager-panel';
export {
  confirmAndClearAuthSecret,
  promptAndStoreAuthSecret,
} from './auth-secret-prompt';
export { writeAuthManagerState } from './auth-settings-writer';
export { registerAuth } from './register-auth';
export type {
  AuthRegistration,
  RegisterAuthOptions,
} from './register-auth';
