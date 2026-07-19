import type {
  PresentedAssertions,
  ResponseBodyPresentation,
  ResponsePresentation,
} from './presentation';

export type ResponseViewerMessage = { readonly type: 'ready' };

/** Accepts only the fixed, payload-free messages understood by the viewer. */
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
  return Object.keys(record).length === 1 && record.type === 'ready'
    ? { type: 'ready' }
    : undefined;
}

/** Builds a self-contained response document with no remote resource access. */
export function renderResponseViewerHtml(
  model: ResponsePresentation,
  nonce: string,
): string {
  const safeNonce = escapeAttribute(nonce);
  const status = model.status === undefined
    ? `<span class="status error">${escapeHtml(model.failure?.title ?? 'Failed')}</span>`
    : `<span class="status status-${statusClass(model.status.code)}">${model.status.code} ${escapeHtml(model.status.text)}</span>`;
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
  <header class="hero">
    <div class="headline">${status}<span class="summary">${escapeHtml(model.summary)}</span></div>
    <div class="request"><strong>${escapeHtml(model.method)}</strong> <span>${escapeHtml(model.requestUrl)}</span></div>
  </header>
  ${model.failure === undefined ? renderSuccess(model) : renderFailure(model)}
  ${renderAssertions(model.assertions)}
</main>
<script nonce="${safeNonce}">${VIEWER_SCRIPT}</script>
</body>
</html>`;
}

function renderSuccess(model: ResponsePresentation): string {
  return `<section class="stats" aria-label="Response statistics">
    ${stat('Duration', `${model.statistics.durationMs} ms`)}
    ${stat('Body size', formatBytes(model.statistics.bodySizeBytes ?? 0))}
    ${stat('Response size', `~${formatBytes(model.statistics.responseSizeBytes ?? 0)}`)}
    ${stat('Content type', model.statistics.contentType ?? 'Unknown')}
    ${stat('Encoding', model.statistics.encoding ?? 'Binary / unknown')}
    ${stat('Headers', String(model.statistics.headerCount))}
    ${stat('Final URL', model.statistics.finalUrl ?? 'Unknown')}
    ${stat('Started', model.statistics.startedAt)}
    ${stat('Completed', model.statistics.completedAt)}
  </section>
  ${model.statistics.redirected
    ? `<aside class="notice">Redirected ${model.statistics.redirectCount} time(s) to <span>${escapeHtml(model.statistics.finalUrl ?? '')}</span></aside>`
    : ''}
  ${renderBody(model.body)}
  <details class="card">
    <summary>Headers <span class="count">${model.headers.length}</span></summary>
    <div class="table-wrap"><table><thead><tr><th scope="col">Name</th><th scope="col">Value</th></tr></thead><tbody>
      ${model.headers.length === 0
        ? '<tr><td colspan="2" class="muted">No response headers</td></tr>'
        : model.headers.map((header) => `<tr><td>${escapeHtml(header.name)}</td><td><code>${escapeHtml(header.value)}</code>${header.masked ? '<span class="masked"> masked</span>' : ''}</td></tr>`).join('')}
    </tbody></table></div>
  </details>
  <details class="card">
    <summary>Cookies <span class="count">${model.cookies.setCookieHeaderCount}</span></summary>
    <p class="muted">Cookie parsing and storage are not enabled. Set-Cookie values are masked.</p>
  </details>`;
}

function renderFailure(model: ResponsePresentation): string {
  const failure = model.failure!;
  return `<section class="card failure" aria-labelledby="failure-title">
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
  </section>`;
}

function renderAssertions(
  assertions: PresentedAssertions | undefined,
): string {
  if (assertions === undefined) {
    return '';
  }
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
  return `<details class="card assertions-card" open>
    <summary>Assertions <span class="count ${badgeClass}">${summary.passed}/${summary.total} passed (${summary.passPercent}%)</span></summary>
    <div class="assert-summary">
      ${stat('Passed', String(summary.passed))}
      ${stat('Failed', String(summary.failed))}
      ${stat('Malformed', String(summary.malformed))}
      ${stat('Skipped', String(summary.skipped))}
      ${stat('Duration', `${summary.durationMs} ms`)}
    </div>
    <ul class="assert-list">${rows}</ul>
  </details>`;
}

function renderBody(body: ResponseBodyPresentation | undefined): string {
  if (body === undefined) {
    return '';
  }
  const truncation = body.truncated
    ? `<div class="notice">Preview truncated to ${body.displayedUnits.toLocaleString()} of ${body.totalUnits.toLocaleString()} ${body.unit}. The canonical response is unchanged.</div>`
    : '';
  const pretty = body.language === 'json' && body.prettyAvailable
    ? renderJsonTree(body.pretty)
    : `<pre tabindex="0"><code>${highlight(body.pretty, body.language)}</code></pre>`;
  return `<section class="card body-card">
    <div class="body-toolbar">
      <h2>Body</h2>
      <div class="toolbar" role="group" aria-label="Body view">
        <button type="button" class="active" data-mode="pretty" aria-pressed="true">Pretty</button>
        <button type="button" data-mode="raw" aria-pressed="false">Raw</button>
        ${body.language === 'json' && body.prettyAvailable
          ? '<button type="button" data-json-action="expand">Expand all</button><button type="button" data-json-action="collapse">Collapse all</button>'
          : ''}
      </div>
    </div>
    ${truncation}
    <div data-view="pretty">${pretty}</div>
    <div data-view="raw" hidden><pre tabindex="0"><code>${highlight(body.raw, body.language)}</code></pre></div>
  </section>`;
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
      // Beyond the cap, render a bounded serialized preview leaf rather than
      // recursing further. Escaping and highlighting are preserved.
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
body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
main { max-width: 1200px; margin: 0 auto; padding: 20px; }
.hero { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 16px; margin-bottom: 16px; }
.headline, .request, .body-toolbar, .toolbar { display: flex; align-items: center; gap: 10px; }
.headline { flex-wrap: wrap; }
.request { margin-top: 10px; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
.request strong { color: var(--vscode-textLink-foreground); }
.summary { color: var(--vscode-descriptionForeground); }
.status { border-radius: 999px; padding: 4px 10px; font-weight: 700; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.status-success { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
.status-redirect { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
.status-error, .error { background: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 8px; margin-bottom: 16px; }
.stat, .card, .notice { border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); border-radius: 6px; }
.stat { padding: 10px; min-width: 0; }
.stat span { display: block; color: var(--vscode-descriptionForeground); font-size: .85em; }
.stat strong { display: block; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card { margin: 12px 0; overflow: hidden; }
.card > summary, .body-toolbar, .failure { padding: 12px; }
.card > summary { cursor: pointer; font-weight: 600; }
.body-toolbar { justify-content: space-between; flex-wrap: wrap; }
h2 { margin: 0; font-size: 1.05rem; }
button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 1px solid var(--vscode-contrastBorder, transparent); border-radius: 3px; padding: 5px 9px; cursor: pointer; }
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
button.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button:focus-visible, summary:focus-visible, pre:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
pre { margin: 0; padding: 14px; overflow: auto; max-height: 65vh; background: var(--vscode-textCodeBlock-background); tab-size: 2; }
code { font-family: var(--vscode-editor-font-family); }
.notice { padding: 9px 12px; margin: 10px 12px; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 12px; border-top: 1px solid var(--vscode-panel-border); overflow-wrap: anywhere; }
.count, .masked, .muted { color: var(--vscode-descriptionForeground); font-weight: 400; }
.assert-pass { color: var(--vscode-testing-iconPassed, var(--vscode-charts-green)); }
.assert-fail { color: var(--vscode-testing-iconFailed, var(--vscode-editorError-foreground)); }
.assert-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; padding: 0 12px 12px; }
.assert-list { list-style: none; margin: 0; padding: 0 12px 12px; }
.assert-item { display: grid; gap: 6px; padding: 8px 0; border-top: 1px solid var(--vscode-panel-border); }
.assert-outcome { text-transform: uppercase; font-size: .75em; font-weight: 700; letter-spacing: .04em; }
.assert-item.assert-pass .assert-outcome { color: var(--vscode-testing-iconPassed, var(--vscode-charts-green)); }
.assert-item.assert-fail .assert-outcome { color: var(--vscode-testing-iconFailed, var(--vscode-editorError-foreground)); }
.assert-item.assert-skip .assert-outcome { color: var(--vscode-descriptionForeground); }
.assert-detail { margin-top: 4px; }
.failure p { font-size: 1.05em; }
dl div { display: grid; grid-template-columns: minmax(90px, 140px) 1fr; padding: 5px 0; }
dt { color: var(--vscode-descriptionForeground); }
dd { margin: 0; overflow-wrap: anywhere; }
.json-tree { padding: 12px; font-family: var(--vscode-editor-font-family); overflow: auto; max-height: 65vh; background: var(--vscode-textCodeBlock-background); }
.json-children { padding-left: 20px; border-left: 1px solid var(--vscode-tree-indentGuidesStroke); }
.json-leaf, .json-tree summary { min-height: 1.5em; }
.token-key { color: var(--vscode-symbolIcon-propertyForeground, var(--vscode-textLink-foreground)); }
.token-string { color: var(--vscode-debugTokenExpression-string, var(--vscode-charts-green)); }
.token-number { color: var(--vscode-debugTokenExpression-number, var(--vscode-charts-blue)); }
.token-boolean, .token-null { color: var(--vscode-debugTokenExpression-boolean, var(--vscode-charts-purple)); }
.token-tag { color: var(--vscode-symbolIcon-classForeground, var(--vscode-textLink-foreground)); }
.token-comment { color: var(--vscode-descriptionForeground); }
.token-punctuation { color: var(--vscode-descriptionForeground); }
@media (max-width: 560px) { main { padding: 10px; } .body-toolbar { align-items: flex-start; } .toolbar { width: 100%; overflow-x: auto; } dl div { grid-template-columns: 1fr; } }
@media (forced-colors: active) { .status, button, .card, .stat, .notice { border: 1px solid CanvasText; } button:focus-visible, summary:focus-visible { outline-color: Highlight; } }
`;

const VIEWER_SCRIPT = `
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  vscode.postMessage({ type: 'ready' });
  const buttons = Array.from(document.querySelectorAll('[data-mode]'));
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode;
      if (mode !== 'pretty' && mode !== 'raw') return;
      for (const view of document.querySelectorAll('[data-view]')) {
        view.hidden = view.dataset.view !== mode;
      }
      for (const candidate of buttons) {
        const selected = candidate.dataset.mode === mode;
        candidate.classList.toggle('active', selected);
        candidate.setAttribute('aria-pressed', String(selected));
      }
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
})();
`;
