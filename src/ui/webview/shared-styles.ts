/**
 * Shared webview chrome for API Hero surfaces.
 * Token-first (`--vscode-*`), 4px spacing scale, 2px radius.
 * Webviews cannot load Codicon fonts — icons are inline Lucide SVG via
 * `iconHtml` (see `./icons`), rendered with the `.ah-icon` classes below.
 */

/**
 * Returns CSS classes for an HTTP method badge (`method-badge method-get`, etc.).
 */
export function methodBadgeClass(method: string): string {
  const normalized = method.trim().toUpperCase();
  switch (normalized) {
    case 'GET':
      return 'method-badge method-get';
    case 'POST':
      return 'method-badge method-post';
    case 'PUT':
      return 'method-badge method-put';
    case 'PATCH':
      return 'method-badge method-patch';
    case 'DELETE':
      return 'method-badge method-delete';
    case 'HEAD':
      return 'method-badge method-head';
    case 'OPTIONS':
      return 'method-badge method-options';
    default:
      return 'method-badge method-other';
  }
}

/** Compact shared primitives reused by report / detail / dialog / viewer HTML. */
export const WEBVIEW_SHARED_CSS = `
:root {
  --ah-space-1: 4px;
  --ah-space-2: 8px;
  --ah-space-3: 12px;
  --ah-space-4: 16px;
  --ah-space-5: 24px;
  --ah-radius: 2px;
  --ah-control-height: 24px;
}
button {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  border: 1px solid var(--vscode-contrastBorder, transparent);
  border-radius: var(--ah-radius);
  padding: 3px 10px;
  min-height: var(--ah-control-height);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
}
button:hover:not(:disabled) {
  background: var(--vscode-button-secondaryHoverBackground);
}
button.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  font-weight: 600;
}
button.primary:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}
button.secondary {
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  background: var(--vscode-button-secondaryBackground, var(--vscode-input-background));
}
button.secondary:hover:not(:disabled) {
  background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
}
button.danger {
  color: var(--vscode-errorForeground, var(--vscode-editorError-foreground));
  background: transparent;
  border-color: var(--vscode-panel-border);
}
button.danger:hover:not(:disabled) {
  background: var(--vscode-inputValidation-errorBackground, transparent);
  border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
}
button.ghost {
  color: var(--vscode-descriptionForeground);
  background: transparent;
  border-color: transparent;
  padding: 3px 6px;
}
button.ghost:hover:not(:disabled) {
  color: var(--vscode-foreground);
  background: var(--vscode-list-hoverBackground);
}
button.chip {
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  padding: 2px 8px;
  min-height: 22px;
  font-size: 11px;
  font-weight: 500;
}
button.chip:hover:not(:disabled) {
  color: var(--vscode-foreground);
  background: var(--vscode-list-hoverBackground);
  border-color: var(--vscode-focusBorder);
}
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[role="tab"]:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 1px;
}
.ah-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  line-height: 0;
  vertical-align: -2px;
}
.ah-icon svg { display: block; }
.ah-icon--button { vertical-align: -2px; }
.ah-icon--status { vertical-align: -1px; }
.ah-icon--muted { color: var(--vscode-descriptionForeground); }
.ah-icon--success { color: var(--vscode-testing-iconPassed); }
.ah-icon--warning { color: var(--vscode-editorWarning-foreground); }
.ah-icon--error { color: var(--vscode-editorError-foreground); }
.ah-icon--info { color: var(--vscode-charts-blue, var(--vscode-descriptionForeground)); }
button .ah-icon { margin-right: 4px; }
.muted { color: var(--vscode-descriptionForeground); }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.status-badge {
  display: inline-flex;
  align-items: center;
  border-radius: var(--ah-radius);
  padding: 2px 6px;
  font-weight: 600;
  font-size: 11px;
  line-height: 1.3;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}
.status-success { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
.status-redirect { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
.status-error, .status-badge.status-error {
  background: var(--vscode-editorError-foreground);
  color: var(--vscode-editor-background);
}
.status-cancelled {
  background: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
  color: var(--vscode-editor-background);
}
.status-neutral { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.method-badge, .method-select {
  display: inline-flex;
  align-items: center;
  border-radius: var(--ah-radius);
  padding: 2px 6px;
  font-weight: 600;
  font-size: 11px;
  line-height: 1.3;
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
  letter-spacing: .02em;
  background: transparent;
  color: var(--vscode-foreground);
}
.method-get { color: var(--vscode-charts-blue, var(--vscode-terminal-ansiBlue, #3794ff)); }
.method-post { color: var(--vscode-charts-green, var(--vscode-terminal-ansiGreen, #89d185)); }
.method-put { color: var(--vscode-charts-orange, var(--vscode-terminal-ansiYellow, #e2c08d)); }
.method-patch { color: var(--vscode-charts-purple, var(--vscode-terminal-ansiMagenta, #c586c0)); }
.method-delete { color: var(--vscode-charts-red, var(--vscode-errorForeground, #f14c4c)); }
.method-head, .method-options { color: var(--vscode-descriptionForeground); }
.method-other { color: var(--vscode-foreground); }
select.method-select {
  display: block;
  width: 100%;
  min-height: var(--ah-control-height);
  padding: 2px 6px;
  font-weight: 600;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  color: inherit;
}
.stat-chip {
  display: inline-flex;
  align-items: baseline;
  gap: var(--ah-space-1);
  padding: 2px 8px;
  border-radius: var(--ah-radius);
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
  max-width: 100%;
}
.stat-chip span {
  color: var(--vscode-descriptionForeground);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .03em;
}
.stat-chip strong {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 16rem;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.stat-chip.emphasis {
  border-color: var(--vscode-focusBorder);
}
.stat-chip.secondary-meta {
  border-color: transparent;
  background: transparent;
  padding: 0 4px;
}
.stat-chip.secondary-meta span { text-transform: none; letter-spacing: 0; }
.empty-state {
  margin: var(--ah-space-2) 0;
  padding: var(--ah-space-3);
  border: 1px dashed var(--vscode-panel-border);
  border-radius: var(--ah-radius);
  color: var(--vscode-descriptionForeground);
  max-width: 28rem;
  line-height: 1.45;
  font-size: 12px;
}
.empty-state strong {
  display: block;
  color: var(--vscode-foreground);
  font-weight: 600;
  margin-bottom: var(--ah-space-1);
}
.empty-state.compact {
  margin: var(--ah-space-2) 0;
  padding: var(--ah-space-2) var(--ah-space-3);
  max-width: none;
  font-size: 11px;
}
.empty-state.compact strong {
  display: inline;
  margin: 0;
  font-weight: 500;
  color: var(--vscode-descriptionForeground);
}
.tabs, .ah-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  padding: 0 var(--ah-space-2);
  border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  background: var(--vscode-editor-background);
}
.tab, .tabs [role="tab"], .ah-tabs [role="tab"] {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--vscode-foreground);
  padding: 5px 10px;
  min-height: 28px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  border-radius: 0;
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
  opacity: .8;
}
.tab:hover, .tabs [role="tab"]:hover, .ah-tabs [role="tab"]:hover {
  opacity: 1;
  background: var(--vscode-list-hoverBackground);
}
.tab.active, .tabs [role="tab"].active, .tabs [role="tab"][aria-selected="true"],
.ah-tabs [role="tab"].active, .ah-tabs [role="tab"][aria-selected="true"] {
  border-bottom-color: var(--vscode-focusBorder);
  color: var(--vscode-foreground);
  font-weight: 600;
  opacity: 1;
}
.sticky-toolbar, .ah-sticky {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--vscode-editor-background);
}
.panel-toolbar, .ah-panel-toolbar {
  display: flex;
  align-items: center;
  gap: var(--ah-space-2);
  flex-wrap: wrap;
  justify-content: space-between;
  margin-bottom: var(--ah-space-2);
}
.panel-title, .ah-section-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-foreground);
}
.field-label, .ah-label {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.3;
}
input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),
select, textarea {
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: var(--ah-radius);
  font: inherit;
  line-height: 1.4;
}
input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),
select {
  min-height: var(--ah-control-height);
  padding: 3px 8px;
}
textarea {
  padding: 6px 8px;
  resize: vertical;
}
table.ah-table, .ah-table {
  width: 100%;
  border-collapse: collapse;
}
.ah-table th, .ah-table td,
table.kv th, table.kv td {
  text-align: left;
  padding: 4px 6px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
  vertical-align: middle;
}
.ah-table th, table.kv th {
  color: var(--vscode-descriptionForeground);
  font-weight: 500;
  font-size: 11px;
}
.ah-table tbody tr:hover, table.kv tbody tr:hover {
  background: var(--vscode-list-hoverBackground);
}
.row-fail, tr.row-fail {
  background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground, transparent) 45%, transparent);
  box-shadow: inset 3px 0 0 var(--vscode-errorForeground, var(--vscode-editorError-foreground));
}
.row-fail:hover, tr.row-fail:hover {
  background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground, transparent) 65%, var(--vscode-list-hoverBackground));
}
.assert-fail, .assertions-fail {
  color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground));
  font-weight: 600;
}
@media (forced-colors: active) {
  button, .status-badge, .stat-chip, .empty-state, .method-badge, .method-select {
    border: 1px solid CanvasText;
  }
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
    outline-color: Highlight;
  }
  .tab.active, .tabs [role="tab"].active, .tabs [role="tab"][aria-selected="true"] {
    border-bottom: 2px solid CanvasText;
  }
  .row-fail, tr.row-fail {
    outline: 1px solid CanvasText;
    box-shadow: none;
  }
}
@media (prefers-contrast: more) {
  .tab.active, .tabs [role="tab"].active, .tabs [role="tab"][aria-selected="true"],
  .ah-tabs [role="tab"].active, .ah-tabs [role="tab"][aria-selected="true"] {
    border-bottom-width: 3px;
  }
  button, input:not([type="checkbox"]):not([type="radio"]), select, textarea {
    border-width: 2px;
  }
}
`;
