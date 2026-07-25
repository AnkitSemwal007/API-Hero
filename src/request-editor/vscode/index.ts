/** VS Code adapters for the Native API Request Editor. */
export {
  clearActiveRequestEditorDocument,
  getActiveRequestEditorDocument,
  setActiveRequestEditorDocument,
} from './active-request-editor';
export { REQUEST_EDITOR_VIEW_TYPE } from './constants';
export {
  emptyRequestEditorModel,
  escapeAttribute,
  escapeHtml,
  renderRequestEditorHtml,
} from './request-editor-html';
export {
  createRequestEditorAck,
  createRequestEditorResubmit,
  maskSensitiveVariablesForWebview,
  parseRequestEditorMessage,
  parseRequestSourceDocument,
  redactSensitiveVariablesInSource,
  restoreSensitiveVariablesFromBaseline,
  SENSITIVE_VARIABLE_MASK,
} from './request-editor-messages';
export type {
  RequestEditorAuthProfileOption,
  RequestEditorInboundMessage,
  RequestEditorMode,
  RequestEditorOutboundMessage,
  RequestEditorState,
  RequestEditorVariableCompletion,
} from './request-editor-messages';
export {
  openRequestEditor,
  RequestEditorProvider,
} from './request-editor-provider';
export type { RequestEditorProviderOptions } from './request-editor-provider';
export {
  registerRequestEditor,
} from './register-request-editor';
export type {
  RegisterRequestEditorOptions,
  RequestEditorRegistration,
} from './register-request-editor';
