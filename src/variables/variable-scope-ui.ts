import type { VariableScope } from '../models';

/** Shared scope icons and UI labels (document → "Request" in product copy). */
export const VARIABLE_SCOPE_UI = Object.freeze({
  run: Object.freeze({ icon: '▶️', sourceLabel: 'Run' }),
  document: Object.freeze({ icon: '📄', sourceLabel: 'Request' }),
  environment: Object.freeze({ icon: '🌍', sourceLabel: 'Environment' }),
  collection: Object.freeze({ icon: '📚', sourceLabel: 'Collection' }),
  workspace: Object.freeze({ icon: '🏢', sourceLabel: 'Workspace' }),
  global: Object.freeze({ icon: '🌐', sourceLabel: 'Global' }),
} satisfies Record<
  VariableScope,
  { readonly icon: string; readonly sourceLabel: string }
>);

/**
 * One-line precedence legend for UI helper text.
 * Order is highest → lowest; matches resolver
 * (run > document > environment > collection > workspace > global).
 */
export const VARIABLE_PRECEDENCE_LEGEND =
  'Run overrides Request overrides Environment overrides Collection overrides Workspace overrides Global';

/** Compact ordered labels for docs and short hints. */
export const VARIABLE_PRECEDENCE_ORDER_LABELS = Object.freeze([
  VARIABLE_SCOPE_UI.run.sourceLabel,
  VARIABLE_SCOPE_UI.document.sourceLabel,
  VARIABLE_SCOPE_UI.environment.sourceLabel,
  VARIABLE_SCOPE_UI.collection.sourceLabel,
  VARIABLE_SCOPE_UI.workspace.sourceLabel,
  VARIABLE_SCOPE_UI.global.sourceLabel,
] as const);

/** Returns icon + source label for a scope. */
export function getVariableScopeUi(scope: VariableScope): {
  readonly icon: string;
  readonly sourceLabel: string;
} {
  return VARIABLE_SCOPE_UI[scope];
}

/** Formats "📄 Request" for legends and list labels. */
export function formatVariableScopeLabel(scope: VariableScope): string {
  const ui = VARIABLE_SCOPE_UI[scope];
  return `${ui.icon} ${ui.sourceLabel}`;
}
