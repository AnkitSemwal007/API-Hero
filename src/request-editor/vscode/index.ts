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
  RequestEditorAmbiguousProducer,
  RequestEditorAutoDependency,
  RequestEditorDependencyCatalogEntry,
  RequestEditorInboundMessage,
  RequestEditorManualDependency,
  RequestEditorMode,
  RequestEditorOutboundMessage,
  RequestEditorState,
  RequestEditorVariableCompletion,
} from './request-editor-messages';
export {
  buildRequestEditorDependencyCatalog,
  toWebviewDependencyCatalog,
} from './dependency-catalog';
export type { BuildDependencyCatalogOptions } from './dependency-catalog';
export {
  openRequestEditor,
  RequestEditorProvider,
} from './request-editor-provider';
export { prepareModelForSerialize } from '../prepare-model-for-serialize';
export type { RequestEditorProviderOptions } from './request-editor-provider';
export {
  registerRequestEditor,
} from './register-request-editor';
export type {
  RegisterRequestEditorOptions,
  RequestEditorRegistration,
} from './register-request-editor';
