import type { VariableScope } from '../models';
import type { AhIconName } from '../ui/webview';

/** Shared scope icons and UI labels (document → "Request" in product copy). */
export const VARIABLE_SCOPE_UI = Object.freeze({
  run: Object.freeze({ iconName: 'play' as const, sourceLabel: 'Run' }),
  document: Object.freeze({
    iconName: 'file-text' as const,
    sourceLabel: 'Request',
  }),
  environment: Object.freeze({
    iconName: 'globe' as const,
    sourceLabel: 'Environment',
  }),
  collection: Object.freeze({
    iconName: 'package' as const,
    sourceLabel: 'Collection',
  }),
  workspace: Object.freeze({
    iconName: 'folder' as const,
    sourceLabel: 'Workspace',
  }),
  global: Object.freeze({ iconName: 'network' as const, sourceLabel: 'Global' }),
} satisfies Record<
  VariableScope,
  { readonly iconName: AhIconName; readonly sourceLabel: string }
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

/** Returns icon name + source label for a scope. */
export function getVariableScopeUi(scope: VariableScope): {
  readonly iconName: AhIconName;
  readonly sourceLabel: string;
} {
  return VARIABLE_SCOPE_UI[scope];
}

/** Text-only source label for a scope (e.g. "Request") — no icon markup. */
export function formatVariableScopeLabel(scope: VariableScope): string {
  return VARIABLE_SCOPE_UI[scope].sourceLabel;
}
