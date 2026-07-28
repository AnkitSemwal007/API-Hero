/**
 * Lucide icon kit for API Hero webviews — Phase 1 (zero-dependency, inline SVG).
 *
 * Scope: webview-only. Native VS Code UI (tree views, command palette,
 * status bar) keeps using Codicons via `$(...)` icon references; there is
 * no status bar migration here. Phase 1 curates ~18 icons for the Request
 * Editor and Response Viewer only (see `types.ts`); a future Phase 2 would
 * extend coverage to other webview surfaces (Overview, History Detail, Run
 * Report, Auth manager, dialogs, OpenAPI import) — do not expand the
 * curated set speculatively ahead of that need.
 */
export type { AhIconName } from './types';
export { AH_ICON_SVG } from './svg';
export { iconHtml } from './icon-html';
export type { AhIconOptions } from './icon-html';
