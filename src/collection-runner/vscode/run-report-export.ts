/**
 * Pure Collection Run Report export helpers (JSON + standalone HTML).
 * No `vscode` import — save/overwrite orchestration uses injected ports.
 */

import { MASKED_HEADER_VALUE } from '../../response/presentation';
import { isSensitiveHttpHeaderName, scrubJsonSecrets } from '../../shared';
import {
  REPORT_CSS,
  buildCollectionRunReportScript,
  escapeHtml,
  type CollectionRunReportModel,
} from './run-report-html';

export type RunReportExportFormat = 'json' | 'html';

const UNSAFE_FILENAME_CHARS = new Set([
  '<',
  '>',
  ':',
  '"',
  '/',
  '\\',
  '|',
  '?',
  '*',
]);

/** Clones the report model and applies shared secret scrubbing. */
export function redactCollectionRunReportModel(
  model: CollectionRunReportModel,
): CollectionRunReportModel {
  const cloned = JSON.parse(JSON.stringify(model)) as CollectionRunReportModel;
  maskSensitivePresentationHeaders(cloned);
  return scrubJsonSecrets(cloned) as CollectionRunReportModel;
}

/**
 * Applies the existing presentation header mask using header *names*.
 * `scrubJsonSecrets` only sees object keys like `value`, not `Authorization`.
 */
function maskSensitivePresentationHeaders(model: CollectionRunReportModel): void {
  for (const row of model.rows) {
    const headers = row.details?.presentation?.headers;
    if (headers === undefined) {
      continue;
    }
    for (const header of headers) {
      if (!isSensitiveHttpHeaderName(header.name)) {
        continue;
      }
      const mutable = header as { value: string; masked: boolean };
      mutable.value = MASKED_HEADER_VALUE;
      mutable.masked = true;
    }
  }
}

/** Pretty-printed JSON of the existing report model after secret scrubbing. */
export function serializeCollectionRunReportJson(
  model: CollectionRunReportModel,
): string {
  return JSON.stringify(redactCollectionRunReportModel(model), null, 2);
}

/**
 * Standalone HTML report viewable in a normal browser.
 * Seeds the existing report script from an embedded redacted JSON model.
 */
export function renderStandaloneCollectionRunReportHtml(
  model: CollectionRunReportModel,
): string {
  const redacted = redactCollectionRunReportModel(model);
  const title = `Run Report: ${model.collectionName}`;
  const embedded = JSON.stringify(redacted).replaceAll('</', '<\\/');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>${STANDALONE_ROOT_CSS}${REPORT_CSS}</style>
</head>
<body>
<main id="root">
  <p class="muted loading" id="loading">Loading run report…</p>
</main>
<script type="application/json" id="report-model">${embedded}</script>
<script>${buildCollectionRunReportScript({ standalone: true })}</script>
</body>
</html>`;
}

/** Sanitizes a collection name for use as a filename stem. Never empty. */
export function sanitizeRunReportFileStem(raw: string): string {
  const trimmed = raw.trim();
  let sanitized = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (ch.charCodeAt(0) <= 0x1f || UNSAFE_FILENAME_CHARS.has(ch)) {
      sanitized += '_';
    } else {
      sanitized += ch;
    }
  }
  const replaced = sanitized.replace(/\.+$/g, '').replace(/\s+$/g, '');
  if (replaced.length === 0) {
    return 'run-report';
  }
  return replaced;
}

/** Suggested download name, e.g. `Demo-run-report.json`. */
export function suggestedRunReportFileName(
  collectionName: string,
  format: RunReportExportFormat,
): string {
  const stem = sanitizeRunReportFileStem(collectionName);
  if (collectionName.trim().length === 0) {
    return `run-report.${format}`;
  }
  return `${stem}-run-report.${format}`;
}

/**
 * Returns whether a write should proceed.
 * `confirm` is invoked only when the destination already exists.
 */
export async function confirmOverwriteIfExists(
  exists: boolean,
  confirm: () => Promise<boolean>,
): Promise<boolean> {
  if (!exists) {
    return true;
  }
  return confirm();
}

/**
 * Browser fallbacks for VS Code theme tokens. Standalone HTML only —
 * does not change in-extension webviews.
 */
const STANDALONE_ROOT_CSS = `
:root {
  --vscode-foreground: CanvasText;
  --vscode-editor-background: Canvas;
  --vscode-sideBar-background: color-mix(in srgb, Canvas 92%, CanvasText 8%);
  --vscode-panel-border: color-mix(in srgb, CanvasText 18%, transparent);
  --vscode-descriptionForeground: color-mix(in srgb, CanvasText 65%, Canvas 35%);
  --vscode-button-background: ButtonFace;
  --vscode-button-foreground: ButtonText;
  --vscode-button-hoverBackground: color-mix(in srgb, ButtonFace 85%, ButtonText 15%);
  --vscode-button-secondaryBackground: color-mix(in srgb, Canvas 88%, CanvasText 12%);
  --vscode-button-secondaryForeground: CanvasText;
  --vscode-button-secondaryHoverBackground: color-mix(in srgb, Canvas 80%, CanvasText 20%);
  --vscode-input-foreground: FieldText;
  --vscode-input-background: Field;
  --vscode-input-border: color-mix(in srgb, CanvasText 22%, transparent);
  --vscode-dropdown-foreground: CanvasText;
  --vscode-dropdown-background: Canvas;
  --vscode-dropdown-border: color-mix(in srgb, CanvasText 22%, transparent);
  --vscode-list-hoverBackground: color-mix(in srgb, CanvasText 8%, transparent);
  --vscode-focusBorder: Highlight;
  --vscode-errorForeground: #c42b1c;
  --vscode-testing-iconPassed: #2e7d32;
  --vscode-testing-iconFailed: #c42b1c;
  --vscode-testing-iconSkipped: #6d6d6d;
  --vscode-textLink-foreground: LinkText;
  --vscode-textCodeBlock-background: color-mix(in srgb, CanvasText 8%, transparent);
  --vscode-editor-font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --vscode-font-family: system-ui, sans-serif;
  --vscode-font-size: 13px;
}
`;
