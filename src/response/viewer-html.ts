import type {
  PresentedAssertions,
  ResponseBodyPresentation,
  ResponsePresentation,
} from './presentation';

export type ResponseViewerMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'copyBody'; readonly mode: 'pretty' | 'raw' }
  | { readonly type: 'copyHeaders' }
  | { readonly type: 'saveBody'; readonly mode: 'pretty' | 'raw' };

const BODY_MODES = new Set(['pretty', 'raw']);

/** Accepts only allowlisted, closed-schema messages from the webview. */
export function parseResponseViewerMessage(
  value: unknown,
): ResponseViewerMessage | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && record.type === 'ready') {
    return { type: 'ready' };
  }
  if (keys.length === 1 && record.type === 'copyHeaders') {
    return { type: 'copyHeaders' };
  }
  if (
    keys.length === 2
    && (record.type === 'copyBody' || record.type === 'saveBody')
    && typeof record.mode === 'string'
    && BODY_MODES.has(record.mode)
  ) {
    return {
      type: record.type,
      mode: record.mode as 'pretty' | 'raw',
    };
  }
  return undefined;
}

/** Builds a self-contained response document with no remote resource access. */
export function renderResponseViewerHtml(
  model: ResponsePresentation,
  nonce: string,
): string {
  const safeNonce = escapeAttribute(nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${safeNonce}'; script-src 'nonce-${safeNonce}'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>API Response</title>
<style nonce="${safeNonce}">${VIEWER_CSS}</style>
</head>
<body>
<main>
  ${renderStatusCard(model)}
  ${model.failure === undefined ? renderSuccess(model) : renderFailure(model)}
</main>
<script nonce="${safeNonce}">${VIEWER_SCRIPT}</script>
</body>
</html>`;
}

function renderStatusCard(model: ResponsePresentation): string {
  const status = model.status === undefined
    ? `<span class="status-badge status-error">${escapeHtml(model.failure?.title ?? 'Failed')}</span>`
    : `<span class="status-badge status-${statusClass(model.status.code)}">${model.status.code} ${escapeHtml(model.status.text)}</span>`;
  const stats = model.failure === undefined
    ? `<div class="stats-summary" aria-label="Response statistics">
        ${statChip('Duration', `${model.statistics.durationMs} ms`)}
        ${statChip('Body', formatBytes(model.statistics.bodySizeBytes ?? 0))}
        ${statChip('Total', `~${formatBytes(model.statistics.responseSizeBytes ?? 0)}`)}
        ${statChip('Type', model.statistics.contentType ?? 'Unknown')}
        ${statChip('Encoding', model.statistics.encoding ?? 'Binary / unknown')}
        ${statChip('Headers', String(model.statistics.headerCount))}
      </div>`
    : `<div class="stats-summary" aria-label="Failure statistics">
        ${statChip('Duration', `${model.statistics.durationMs} ms`)}
        ${statChip('Code', model.failure.code)}
        ${statChip('Retryable', model.failure.retryable ? 'Yes' : 'No')}
      </div>`;
  return `<header class="status-card">
    <div class="status-row">
      ${status}
      <span class="summary">${escapeHtml(model.summary)}</span>
    </div>
    <div class="request-line"><strong>${escapeHtml(model.method)}</strong> <span>${escapeHtml(model.requestUrl)}</span></div>
    ${stats}
    ${model.statistics.redirected
      ? `<aside class="notice">Redirected ${model.statistics.redirectCount} time(s) to <span>${escapeHtml(model.statistics.finalUrl ?? '')}</span></aside>`
      : ''}
  </header>`;
}

function renderSuccess(model: ResponsePresentation): string {
  const showCookies = model.cookies.available;
  const showAssertions = model.assertions !== undefined;
  const tabs = [
    { id: 'body', label: 'Body', selected: true },
    {
      id: 'headers',
      label: `Headers (${model.headers.length})`,
      selected: false,
    },
    ...(showCookies
      ? [{ id: 'cookies', label: 'Cookies', selected: false }]
      : []),
    ...(showAssertions
      ? [{
          id: 'assertions',
          label: `Assertions (${model.assertions!.summary.passed}/${model.assertions!.summary.total})`,
          selected: false,
        }]
      : []),
  ];
  return `<nav class="tabs" role="tablist" aria-label="Response sections">
    ${tabs.map((tab) => `<button type="button" role="tab" id="tab-${tab.id}" data-tab="${tab.id}" aria-controls="panel-${tab.id}" aria-selected="${tab.selected}" tabindex="${tab.selected ? '0' : '-1'}"${tab.selected ? ' class="active"' : ''}>${escapeHtml(tab.label)}</button>`).join('')}
  </nav>
  <section id="panel-body" class="tab-panel" role="tabpanel" aria-labelledby="tab-body"${tabs[0]?.id === 'body' ? '' : ' hidden'}>
    ${renderBody(model.body)}
  </section>
  <section id="panel-headers" class="tab-panel" role="tabpanel" aria-labelledby="tab-headers" hidden>
    ${renderHeaders(model)}
  </section>
  ${showCookies ? `<section id="panel-cookies" class="tab-panel" role="tabpanel" aria-labelledby="tab-cookies" hidden>${renderCookies(model)}</section>` : ''}
  ${showAssertions ? `<section id="panel-assertions" class="tab-panel" role="tabpanel" aria-labelledby="tab-assertions" hidden>${renderAssertions(model.assertions!)}</section>` : ''}
  <aside class="meta-grid" aria-label="Response metadata">
    ${stat('Final URL', model.statistics.finalUrl ?? 'Unknown')}
    ${stat('Started', model.statistics.startedAt)}
    ${stat('Completed', model.statistics.completedAt)}
  </aside>`;
}

function renderFailure(model: ResponsePresentation): string {
  const failure = model.failure!;
  const assertions = model.assertions === undefined
    ? ''
    : `<nav class="tabs" role="tablist" aria-label="Response sections">
        <button type="button" role="tab" id="tab-assertions" data-tab="assertions" aria-controls="panel-assertions" aria-selected="true" tabindex="0" class="active">Assertions (${model.assertions.summary.passed}/${model.assertions.summary.total})</button>
      </nav>
      <section id="panel-assertions" class="tab-panel" role="tabpanel" aria-labelledby="tab-assertions">
        ${renderAssertions(model.assertions)}
      </section>`;
  return `<section class="failure-card" aria-labelledby="failure-title">
    <h2 id="failure-title">${escapeHtml(failure.title)}</h2>
    <p>${escapeHtml(failure.message)}</p>
    <dl>
      <div><dt>Code</dt><dd><code>${escapeHtml(failure.code)}</code></dd></div>
      <div><dt>Retryable</dt><dd>${failure.retryable ? 'Yes' : 'No'}</dd></div>
      <div><dt>Duration</dt><dd>${model.statistics.durationMs} ms</dd></div>
      ${failure.cause?.name === undefined ? '' : `<div><dt>Cause</dt><dd>${escapeHtml(failure.cause.name)}</dd></div>`}
      ${failure.cause?.code === undefined ? '' : `<div><dt>Cause code</dt><dd><code>${escapeHtml(failure.cause.code)}</code></dd></div>`}
      ${failure.cause?.message === undefined ? '' : `<div><dt>Detail</dt><dd>${escapeHtml(failure.cause.message)}</dd></div>`}
    </dl>
  </section>
  ${assertions}`;
}

function renderHeaders(model: ResponsePresentation): string {
  return `<div class="panel-toolbar">
    <span class="panel-title">Response headers</span>
    <button type="button" data-action="copyHeaders" title="Copy headers">Copy</button>
  </div>
  <div class="table-wrap"><table><thead><tr><th scope="col">Name</th><th scope="col">Value</th></tr></thead><tbody>
    ${model.headers.length === 0
      ? '<tr><td colspan="2" class="muted">No response headers</td></tr>'
      : model.headers.map((header) => `<tr><td>${escapeHtml(header.name)}</td><td><code>${escapeHtml(header.value)}</code>${header.masked ? '<span class="masked"> masked</span>' : ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function renderCookies(model: ResponsePresentation): string {
  if (!model.cookies.available) {
    return '';
  }
  const rows = model.cookies.entries.map((cookie) =>
    `<tr><td>${escapeHtml(cookie.name)}</td><td><code>${escapeHtml(cookie.value)}</code></td><td>${escapeHtml(cookie.domain ?? '')}</td><td>${escapeHtml(cookie.path ?? '')}</td></tr>`).join('');
  return `<div class="panel-toolbar"><span class="panel-title">Cookies</span></div>
  <div class="table-wrap"><table><thead><tr><th scope="col">Name</th><th scope="col">Value</th><th scope="col">Domain</th><th scope="col">Path</th></tr></thead><tbody>
    ${rows.length === 0
      ? '<tr><td colspan="4" class="muted">No cookies</td></tr>'
      : rows}
  </tbody></table></div>`;
}

function renderAssertions(assertions: PresentedAssertions): string {
  const { summary } = assertions;
  const failed = summary.failed + summary.malformed;
  const badgeClass = failed > 0 ? 'assert-fail' : 'assert-pass';
  const rows = assertions.assertions
    .map((item) => {
      const icon =
        item.outcome === 'passed'
          ? 'pass'
          : item.outcome === 'skipped'
            ? 'skip'
            : 'fail';
      const failure =
        item.failure === undefined
          ? ''
          : `<details class="assert-detail"><summary>Details</summary><dl>
              <div><dt>Reason</dt><dd>${escapeHtml(item.failure.reason)}</dd></div>
              ${item.failure.expected === undefined ? '' : `<div><dt>Expected</dt><dd><code>${escapeHtml(item.failure.expected)}</code></dd></div>`}
              ${item.failure.actual === undefined ? '' : `<div><dt>Actual</dt><dd><code>${escapeHtml(item.failure.actual)}</code></dd></div>`}
              ${item.failure.context === undefined ? '' : `<div><dt>Context</dt><dd>${escapeHtml(item.failure.context)}</dd></div>`}
            </dl></details>`;
      return `<li class="assert-item assert-${icon}"><span class="assert-outcome">${escapeHtml(item.outcome)}</span><code>${escapeHtml(item.text)}</code>${failure}</li>`;
    })
    .join('');
  return `<div class="panel-toolbar">
    <span class="panel-title">Assertions</span>
    <span class="count ${badgeClass}">${summary.passed}/${summary.total} passed (${summary.passPercent}%)</span>
  </div>
  <div class="assert-summary">
    ${stat('Passed', String(summary.passed))}
    ${stat('Failed', String(summary.failed))}
    ${stat('Malformed', String(summary.malformed))}
    ${stat('Skipped', String(summary.skipped))}
    ${stat('Duration', `${summary.durationMs} ms`)}
  </div>
  <ul class="assert-list">${rows}</ul>`;
}

function renderBody(body: ResponseBodyPresentation | undefined): string {
  if (body === undefined) {
    return '<p class="muted empty-body">No response body</p>';
  }
  const truncation = body.truncated
    ? `<div class="notice">Preview truncated to ${body.displayedUnits.toLocaleString()} of ${body.totalUnits.toLocaleString()} ${body.unit}. The canonical response is unchanged.</div>`
    : '';
  const pretty = body.language === 'json' && body.prettyAvailable
    ? renderJsonTree(body.pretty)
    : `<pre tabindex="0"><code>${highlight(body.pretty, body.language)}</code></pre>`;
  return `<div class="panel-toolbar body-toolbar">
    <div class="toolbar" role="group" aria-label="Body view">
      <button type="button" class="active" data-mode="pretty" aria-pressed="true">Pretty</button>
      <button type="button" data-mode="raw" aria-pressed="false">Raw</button>
      ${body.language === 'json' && body.prettyAvailable
        ? '<button type="button" data-json-action="expand">Expand all</button><button type="button" data-json-action="collapse">Collapse all</button>'
        : ''}
    </div>
    <div class="toolbar body-actions" role="group" aria-label="Body actions">
      <label class="search-field">
        <span class="sr-only">Search body</span>
        <input type="search" id="bodySearch" placeholder="Search" autocomplete="off" spellcheck="false" />
      </label>
      <span id="searchStatus" class="search-status muted" aria-live="polite"></span>
      <button type="button" data-action="copyBody" title="Copy body">Copy</button>
      <button type="button" data-action="saveBody" title="${body.truncated ? 'Save unavailable for truncated preview' : 'Save body'}"${body.truncated ? ' disabled' : ''}>Save</button>
    </div>
  </div>
  ${truncation}
  <div data-view="pretty" class="body-view">${pretty}</div>
  <div data-view="raw" class="body-view" hidden><pre tabindex="0"><code>${highlight(body.raw, body.language)}</code></pre></div>`;
}

/** Bounds tree recursion regardless of response nesting depth. */
const JSON_TREE_MAX_DEPTH = 64;

function renderJsonTree(pretty: string): string {
  try {
    return `<div class="json-tree" role="tree">${renderJsonValue(JSON.parse(pretty) as unknown, 'root', 0)}</div>`;
  } catch {
    return `<pre tabindex="0"><code>${highlight(pretty, 'json')}</code></pre>`;
  }
}

function renderJsonValue(value: unknown, label: string, depth: number): string {
  const key = label === 'root'
    ? ''
    : `<span class="token-key">${escapeHtml(JSON.stringify(label))}</span><span>: </span>`;
  if (value !== null && typeof value === 'object') {
    if (depth >= JSON_TREE_MAX_DEPTH) {
      const preview = safeJsonPreview(value);
      return `<div class="json-leaf" role="treeitem">${key}<span class="token-punctuation">${highlight(preview, 'json')}</span></div>`;
    }
    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index), item] as const)
      : Object.entries(value);
    const open = depth < 2 ? ' open' : '';
    const kind = Array.isArray(value) ? 'Array' : 'Object';
    return `<details${open} role="treeitem"><summary>${key}<span class="token-punctuation">${kind}(${entries.length})</span></summary><div class="json-children" role="group">${entries.map(([childLabel, child]) => renderJsonValue(child, childLabel, depth + 1)).join('')}</div></details>`;
  }
  return `<div class="json-leaf" role="treeitem">${key}${jsonPrimitive(value)}</div>`;
}

/** Serializes a deep subtree to a bounded, safe preview string. */
function safeJsonPreview(value: unknown): string {
  const kind = Array.isArray(value) ? 'Array' : 'Object';
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return `${kind}(…)`;
    }
    return serialized.length > 256
      ? `${serialized.slice(0, 256)}… (${kind}, truncated)`
      : serialized;
  } catch {
    return `${kind}(…)`;
  }
}

function jsonPrimitive(value: unknown): string {
  if (typeof value === 'string') {
    return `<span class="token-string">${escapeHtml(JSON.stringify(value))}</span>`;
  }
  if (typeof value === 'number') {
    return `<span class="token-number">${escapeHtml(String(value))}</span>`;
  }
  if (typeof value === 'boolean') {
    return `<span class="token-boolean">${String(value)}</span>`;
  }
  return '<span class="token-null">null</span>';
}

function highlight(
  source: string,
  language: ResponseBodyPresentation['language'],
): string {
  if (language === 'json') {
    return tokenize(source, /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\b(?:true|false|null)\b/giu, (token) => {
      const suffix = source.slice(token.index + token.value.length);
      const kind = token.value.startsWith('"')
        ? (/^\s*:/u.test(suffix) ? 'key' : 'string')
        : token.value === 'true' || token.value === 'false'
          ? 'boolean'
          : token.value === 'null' ? 'null' : 'number';
      return `<span class="token-${kind}">${escapeHtml(token.value)}</span>`;
    });
  }
  if (language === 'html' || language === 'xml') {
    return tokenize(source, /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[A-Za-z][^>]*>/gu, (token) =>
      `<span class="${token.value.startsWith('<!--') ? 'token-comment' : 'token-tag'}">${escapeHtml(token.value)}</span>`);
  }
  return escapeHtml(source);
}

function tokenize(
  source: string,
  expression: RegExp,
  render: (token: { readonly value: string; readonly index: number }) => string,
): string {
  let output = '';
  let index = 0;
  for (const match of source.matchAll(expression)) {
    const matchIndex = match.index;
    output += escapeHtml(source.slice(index, matchIndex));
    output += render({ value: match[0], index: matchIndex });
    index = matchIndex + match[0].length;
  }
  return output + escapeHtml(source.slice(index));
}

function stat(label: string, value: string): string {
  return `<div class="stat"><span>${escapeHtml(label)}</span><strong title="${escapeAttribute(value)}">${escapeHtml(value)}</strong></div>`;
}

function statChip(label: string, value: string): string {
  return `<div class="stat-chip"><span>${escapeHtml(label)}</span><strong title="${escapeAttribute(value)}">${escapeHtml(value)}</strong></div>`;
}

function statusClass(code: number): string {
  if (code >= 200 && code < 300) return 'success';
  if (code >= 300 && code < 400) return 'redirect';
  if (code >= 400) return 'error';
  return 'neutral';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

const VIEWER_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}
main { display: flex; flex-direction: column; gap: 0; min-height: 100vh; }
.status-card {
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}
.status-row, .request-line, .panel-toolbar, .toolbar, .body-toolbar, .stats-summary {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.status-row { margin-bottom: 8px; }
.request-line { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; margin-bottom: 10px; }
.request-line strong { color: var(--vscode-textLink-foreground); font-weight: 600; }
.summary { color: var(--vscode-descriptionForeground); }
.status-badge {
  display: inline-flex; align-items: center;
  border-radius: 2px; padding: 2px 8px; font-weight: 600; font-size: .9em;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}
.status-success { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
.status-redirect { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
.status-error, .status-badge.status-error { background: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); }
.stats-summary { gap: 6px; }
.stat-chip {
  display: inline-flex; align-items: baseline; gap: 6px;
  padding: 3px 8px; border-radius: 2px;
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
  max-width: 100%;
}
.stat-chip span { color: var(--vscode-descriptionForeground); font-size: .8em; text-transform: uppercase; letter-spacing: .02em; }
.stat-chip strong { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 18rem; }
.tabs {
  display: flex; gap: 0; padding: 0 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
}
.tabs [role="tab"] {
  appearance: none; border: none; border-bottom: 1px solid transparent;
  margin-bottom: -1px; border-radius: 0; background: transparent;
  color: var(--vscode-foreground); padding: 8px 12px; cursor: pointer;
  opacity: .75;
}
.tabs [role="tab"]:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, transparent); }
.tabs [role="tab"].active, .tabs [role="tab"][aria-selected="true"] {
  opacity: 1; border-bottom-color: var(--vscode-focusBorder);
  color: var(--vscode-foreground); font-weight: 600;
}
.tab-panel { padding: 12px 16px 16px; flex: 1; min-height: 0; }
.panel-toolbar { justify-content: space-between; margin-bottom: 10px; gap: 10px; }
.panel-title { font-weight: 600; }
.body-toolbar { align-items: flex-start; }
.body-actions { margin-left: auto; }
.search-field input {
  width: min(220px, 40vw); padding: 4px 8px;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 2px; font: inherit;
}
.search-field input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.search-status { font-size: .85em; min-width: 4.5rem; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
button {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  border: 1px solid var(--vscode-contrastBorder, transparent);
  border-radius: 2px; padding: 4px 10px; cursor: pointer; font: inherit;
}
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
button.active {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}
button:focus-visible, summary:focus-visible, pre:focus-visible, .tabs [role="tab"]:focus-visible {
  outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px;
}
pre, .json-tree {
  margin: 0; padding: 12px; overflow: auto; max-height: calc(100vh - 260px);
  background: var(--vscode-textCodeBlock-background);
  border: 1px solid var(--vscode-panel-border); border-radius: 2px; tab-size: 2;
}
code { font-family: var(--vscode-editor-font-family); }
.notice {
  padding: 8px 10px; margin: 0 0 10px;
  color: var(--vscode-descriptionForeground);
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
  border-radius: 2px; overflow-wrap: anywhere;
}
.table-wrap { overflow-x: auto; border: 1px solid var(--vscode-panel-border); border-radius: 2px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 7px 10px; border-top: 1px solid var(--vscode-panel-border); overflow-wrap: anywhere; }
th { color: var(--vscode-descriptionForeground); font-weight: 600; background: var(--vscode-sideBar-background); }
.count, .masked, .muted, .empty-body { color: var(--vscode-descriptionForeground); font-weight: 400; }
.assert-pass { color: var(--vscode-testing-iconPassed, var(--vscode-charts-green)); }
.assert-fail { color: var(--vscode-testing-iconFailed, var(--vscode-editorError-foreground)); }
.assert-summary {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px; margin-bottom: 12px;
}
.stat {
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
  border-radius: 2px; padding: 8px 10px; min-width: 0;
}
.stat span { display: block; color: var(--vscode-descriptionForeground); font-size: .85em; }
.stat strong { display: block; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px; padding: 0 16px 16px;
}
.assert-list { list-style: none; margin: 0; padding: 0; }
.assert-item { display: grid; gap: 6px; padding: 8px 0; border-top: 1px solid var(--vscode-panel-border); }
.assert-outcome { text-transform: uppercase; font-size: .75em; font-weight: 700; letter-spacing: .04em; }
.assert-item.assert-pass .assert-outcome { color: var(--vscode-testing-iconPassed, var(--vscode-charts-green)); }
.assert-item.assert-fail .assert-outcome { color: var(--vscode-testing-iconFailed, var(--vscode-editorError-foreground)); }
.assert-item.assert-skip .assert-outcome { color: var(--vscode-descriptionForeground); }
.assert-detail { margin-top: 4px; }
.failure-card {
  margin: 12px 16px; padding: 14px;
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background); border-radius: 2px;
}
.failure-card h2 { margin: 0 0 8px; font-size: 1.05rem; }
.failure-card p { margin: 0 0 10px; font-size: 1.05em; }
dl div { display: grid; grid-template-columns: minmax(90px, 140px) 1fr; padding: 5px 0; }
dt { color: var(--vscode-descriptionForeground); }
dd { margin: 0; overflow-wrap: anywhere; }
.json-tree { font-family: var(--vscode-editor-font-family); }
.json-children { padding-left: 20px; border-left: 1px solid var(--vscode-tree-indentGuidesStroke); }
.json-leaf, .json-tree summary { min-height: 1.5em; }
mark.search-hit {
  background: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, .33));
  color: inherit; border-radius: 1px;
}
mark.search-hit.current {
  background: var(--vscode-editor-findMatchBackground, rgba(234, 92, 0, .66));
  outline: 1px solid var(--vscode-focusBorder);
}
.token-key { color: var(--vscode-symbolIcon-propertyForeground, var(--vscode-textLink-foreground)); }
.token-string { color: var(--vscode-debugTokenExpression-string, var(--vscode-charts-green)); }
.token-number { color: var(--vscode-debugTokenExpression-number, var(--vscode-charts-blue)); }
.token-boolean, .token-null { color: var(--vscode-debugTokenExpression-boolean, var(--vscode-charts-purple)); }
.token-tag { color: var(--vscode-symbolIcon-classForeground, var(--vscode-textLink-foreground)); }
.token-comment { color: var(--vscode-descriptionForeground); }
.token-punctuation { color: var(--vscode-descriptionForeground); }
@media (max-width: 560px) {
  .tab-panel, .status-card { padding-left: 10px; padding-right: 10px; }
  .body-toolbar { flex-direction: column; align-items: stretch; }
  .body-actions { margin-left: 0; }
  .search-field input { width: 100%; }
  dl div { grid-template-columns: 1fr; }
}
@media (forced-colors: active) {
  .status-badge, button, .stat, .stat-chip, .notice, .table-wrap, pre, .json-tree, .failure-card {
    border: 1px solid CanvasText;
  }
  button:focus-visible, summary:focus-visible, .tabs [role="tab"]:focus-visible { outline-color: Highlight; }
}
`;

const VIEWER_SCRIPT = `
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  vscode.postMessage({ type: 'ready' });

  let activeMode = 'pretty';
  const modeButtons = Array.from(document.querySelectorAll('[data-mode]'));
  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode;
      if (mode !== 'pretty' && mode !== 'raw') return;
      activeMode = mode;
      for (const view of document.querySelectorAll('[data-view]')) {
        view.hidden = view.dataset.view !== mode;
      }
      for (const candidate of modeButtons) {
        const selected = candidate.dataset.mode === mode;
        candidate.classList.toggle('active', selected);
        candidate.setAttribute('aria-pressed', String(selected));
      }
      clearSearchHighlights();
      runSearch(false);
    });
  }

  for (const button of document.querySelectorAll('[data-json-action]')) {
    button.addEventListener('click', () => {
      const open = button.dataset.jsonAction === 'expand';
      if (!open && button.dataset.jsonAction !== 'collapse') return;
      for (const detail of document.querySelectorAll('.json-tree details')) {
        detail.open = open;
      }
    });
  }

  const tabs = Array.from(document.querySelectorAll('[role="tab"][data-tab]'));
  for (const tab of tabs) {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next = event.key === 'ArrowRight'
        ? tabs[(index + 1) % tabs.length]
        : tabs[(index - 1 + tabs.length) % tabs.length];
      if (!next) return;
      activateTab(next.dataset.tab);
      next.focus();
    });
  }

  function activateTab(tabId) {
    if (!tabId) return;
    for (const tab of tabs) {
      const selected = tab.dataset.tab === tabId;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of document.querySelectorAll('.tab-panel')) {
      panel.hidden = panel.id !== 'panel-' + tabId;
    }
  }

  document.querySelector('[data-action="copyBody"]')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyBody', mode: activeMode });
  });
  document.querySelector('[data-action="copyHeaders"]')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyHeaders' });
  });
  document.querySelector('[data-action="saveBody"]')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'saveBody', mode: activeMode });
  });

  const searchInput = document.getElementById('bodySearch');
  const searchStatus = document.getElementById('searchStatus');
  let matches = [];
  let matchIndex = -1;
  let searchTimer = undefined;

  searchInput?.addEventListener('input', () => {
    if (searchTimer !== undefined) {
      clearTimeout(searchTimer);
    }
    searchTimer = setTimeout(() => {
      searchTimer = undefined;
      runSearch(true);
    }, 200);
  });
  searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (matches.length === 0) return;
      matchIndex = event.shiftKey
        ? (matchIndex - 1 + matches.length) % matches.length
        : (matchIndex + 1) % matches.length;
      focusMatch(matchIndex);
      updateSearchStatus();
    } else if (event.key === 'Escape') {
      searchInput.value = '';
      clearSearchHighlights();
      updateSearchStatus();
    }
  });

  function activeBodyRoot() {
    return document.querySelector('[data-view="' + activeMode + '"]:not([hidden])');
  }

  function clearSearchHighlights() {
    for (const mark of document.querySelectorAll('mark.search-hit')) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
      parent.normalize();
    }
    matches = [];
    matchIndex = -1;
  }

  function runSearch(resetIndex) {
    clearSearchHighlights();
    const query = (searchInput?.value || '').trim();
    if (!query) {
      updateSearchStatus();
      return;
    }
    const root = activeBodyRoot();
    if (!root) {
      updateSearchStatus();
      return;
    }
    const lowerQuery = query.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.toLowerCase().includes(lowerQuery)) {
        textNodes.push(node);
      }
    }
    for (const textNode of textNodes) {
      const text = textNode.nodeValue || '';
      const lower = text.toLowerCase();
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      let found = lower.indexOf(lowerQuery, cursor);
      while (found !== -1) {
        if (found > cursor) {
          fragment.appendChild(document.createTextNode(text.slice(cursor, found)));
        }
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = text.slice(found, found + query.length);
        fragment.appendChild(mark);
        matches.push(mark);
        cursor = found + query.length;
        found = lower.indexOf(lowerQuery, cursor);
      }
      if (cursor < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
      }
      textNode.parentNode?.replaceChild(fragment, textNode);
    }
    if (resetIndex) {
      matchIndex = matches.length > 0 ? 0 : -1;
    } else if (matchIndex >= matches.length) {
      matchIndex = matches.length > 0 ? 0 : -1;
    }
    if (matchIndex >= 0) focusMatch(matchIndex);
    updateSearchStatus();
  }

  function focusMatch(index) {
    for (const mark of matches) mark.classList.remove('current');
    const current = matches[index];
    if (!current) return;
    current.classList.add('current');
    current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function updateSearchStatus() {
    if (!searchStatus) return;
    const query = (searchInput?.value || '').trim();
    if (!query) {
      searchStatus.textContent = '';
      return;
    }
    if (matches.length === 0) {
      searchStatus.textContent = 'No results';
      return;
    }
    searchStatus.textContent = (matchIndex + 1) + ' of ' + matches.length;
  }
})();
`;
