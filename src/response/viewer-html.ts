import {
  buildNonceOnlyCsp,
  escapeAttribute,
  escapeHtml,
  iconHtml,
  isWebviewMessageRecord,
  methodBadgeClass,
  WEBVIEW_SHARED_CSS,
} from '../ui/webview';
import { isExtractableJsonPath } from '../extraction';
import type {
  PresentedAssertions,
  PresentedExtraction,
  ResponseBodyPresentation,
  ResponsePresentation,
} from './presentation';
import { RESPONSE_TEXT_PREVIEW_LIMIT } from './presentation';
import type { FailureExplanation } from './failure-explanations';
import type { ResponseDiffResult } from './response-diff';

export { escapeHtml };

export type ResponseViewerMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'copyBody'; readonly mode: 'pretty' | 'raw' }
  | { readonly type: 'copyHeaders' }
  | { readonly type: 'saveBody'; readonly mode: 'pretty' | 'raw' }
  | { readonly type: 'copyText'; readonly text: string }
  | { readonly type: 'copyJsonPathValue'; readonly path: string }
  | {
      readonly type: 'createVariable';
      readonly name: string;
      readonly path: string;
      readonly scope: string;
      readonly sensitive: boolean;
    }
  | { readonly type: 'useAsAuthentication' }
  | { readonly type: 'comparePrevious' }
  | { readonly type: 'generateTypeScript' };

const BODY_MODES = new Set(['pretty', 'raw']);
const CREATE_VARIABLE_SCOPES = new Set([
  'environment',
  'document',
  'collection',
  'workspace',
  'run',
]);
/** Cap DOM search highlights to avoid blowups on huge bodies. */
const RESPONSE_SEARCH_MATCH_LIMIT = 500;

/** Accepts only allowlisted, closed-schema messages from the webview. */
export function parseResponseViewerMessage(
  value: unknown,
): ResponseViewerMessage | undefined {
  if (!isWebviewMessageRecord(value)) {
    return undefined;
  }
  const record = value;
  const keys = Object.keys(record);
  if (keys.length === 1 && record.type === 'ready') {
    return { type: 'ready' };
  }
  if (keys.length === 1 && record.type === 'copyHeaders') {
    return { type: 'copyHeaders' };
  }
  if (keys.length === 1 && record.type === 'useAsAuthentication') {
    return { type: 'useAsAuthentication' };
  }
  if (keys.length === 1 && record.type === 'comparePrevious') {
    return { type: 'comparePrevious' };
  }
  if (keys.length === 1 && record.type === 'generateTypeScript') {
    return { type: 'generateTypeScript' };
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
  if (
    keys.length === 2
    && record.type === 'copyText'
    && typeof record.text === 'string'
  ) {
    return { type: 'copyText', text: record.text };
  }
  if (
    keys.length === 2
    && record.type === 'copyJsonPathValue'
    && typeof record.path === 'string'
  ) {
    return { type: 'copyJsonPathValue', path: record.path };
  }
  if (
    keys.length === 5
    && record.type === 'createVariable'
    && typeof record.name === 'string'
    && typeof record.path === 'string'
    && typeof record.scope === 'string'
    && CREATE_VARIABLE_SCOPES.has(record.scope)
    && typeof record.sensitive === 'boolean'
  ) {
    return {
      type: 'createVariable',
      name: record.name,
      path: record.path,
      scope: record.scope,
      sensitive: record.sensitive,
    };
  }
  return undefined;
}

/** Optional Create Variable From Response chrome for the Response Viewer. */
export interface ResponseViewerRenderOptions {
  /** When true, show Save as Variable / Extract Variable entry points. */
  readonly enableCreateVariable?: boolean;
  /** Names already known (any scope) for overwrite warnings in the sheet. */
  readonly knownVariableNames?: readonly string[];
  /** When > 0, show Detected Authentication affordance (paths counted on host). */
  readonly detectedAuthTokenCount?: number;
  /** When true, show Compare with Previous Run. */
  readonly canComparePrevious?: boolean;
  /** When true, show Generate TypeScript for successful JSON bodies. */
  readonly canGenerateTypeScript?: boolean;
  /** Active Previous/Current (or A/B) diff to render. */
  readonly diff?: ResponseDiffResult;
}

/** Builds a self-contained response document with no remote resource access. */
export function renderResponseViewerHtml(
  model: ResponsePresentation,
  nonce: string,
  options: ResponseViewerRenderOptions = {},
): string {
  const safeNonce = escapeAttribute(nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${buildNonceOnlyCsp(nonce, { allowDataImages: true })}">
<title>API Response</title>
<style nonce="${safeNonce}">${VIEWER_CSS}</style>
</head>
<body data-enable-create-variable="${options.enableCreateVariable === true ? 'true' : 'false'}" data-known-variables="${escapeAttribute(JSON.stringify(options.knownVariableNames ?? []))}">
<main>
  ${renderStatusCard(model, options)}
  ${model.failure === undefined ? renderSuccess(model, options) : renderFailure(model)}
  ${renderExplanation(model.explanation)}
  ${renderDiffSection(options.diff)}
</main>
<script nonce="${safeNonce}">${VIEWER_SCRIPT}</script>
</body>
</html>`;
}

function renderStatusCard(
  model: ResponsePresentation,
  options: ResponseViewerRenderOptions = {},
): string {
  const status =
    model.websocket !== undefined
      ? '<span class="status-badge status-success">WebSocket received</span>'
      : model.status === undefined
        ? `<span class="status-badge status-error">${escapeHtml(model.failure?.title ?? 'Failed')}</span>`
        : `<span class="status-badge status-${statusClass(model.status.code)}">${model.status.code} ${escapeHtml(model.status.text)}</span>`;
  const methodClass = methodBadgeClass(model.method);
  const assertionChip = model.assertions === undefined
    ? ''
    : statChip(
      'Assertions',
      `${model.assertions.summary.passed}/${model.assertions.summary.total}`,
    );
  const extractionChip = model.extraction === undefined
    ? ''
    : statChip('Extract', model.extraction.chipLabel);
  const compareButton = options.canComparePrevious === true
    ? `<button type="button" class="compare-prev-btn" data-action="comparePrevious" title="Compare with Previous Run">Compare with Previous Run</button>`
    : '';
  const primaryStats = model.failure === undefined
    ? `<div class="stats-summary primary-stats" aria-label="Response statistics">
        ${statChip('Duration', `${model.statistics.durationMs} ms`)}
        ${statChip('Size', formatBytes(model.statistics.bodySizeBytes ?? 0))}
        ${assertionChip}
        ${extractionChip}
      </div>`
    : `<div class="stats-summary primary-stats" aria-label="Failure statistics">
        ${statChip('Duration', `${model.statistics.durationMs} ms`)}
        ${statChip('Code', model.failure.code)}
        ${assertionChip}
        ${extractionChip}
      </div>`;
  const secondaryStats = model.failure === undefined
    ? `<div class="stats-summary secondary-stats muted" aria-label="Additional metadata">
        ${statChip('Total', `~${formatBytes(model.statistics.responseSizeBytes ?? 0)}`)}
        ${statChip('Type', model.statistics.contentType ?? 'Unknown')}
        ${statChip('Encoding', model.statistics.encoding ?? 'Binary / unknown')}
        ${statChip('Headers', String(model.statistics.headerCount))}
      </div>`
    : `<div class="stats-summary secondary-stats muted" aria-label="Failure details">
        ${statChip('Retryable', model.failure.retryable ? 'Yes' : 'No')}
      </div>`;
  return `<header class="status-card sticky-summary">
    <div class="status-row">
      ${status}
      <span class="summary">${escapeHtml(model.summary)}</span>
      ${primaryStats}
      ${compareButton}
    </div>
    <div class="request-line"><span class="${methodClass}">${escapeHtml(model.method)}</span> <span>${escapeHtml(model.requestUrl)}</span></div>
    ${secondaryStats}
    ${model.statistics.redirected
      ? `<aside class="notice">Redirected ${model.statistics.redirectCount} time(s) to <span>${escapeHtml(model.statistics.finalUrl ?? '')}</span></aside>`
      : ''}
  </header>`;
}

function renderSuccess(
  model: ResponsePresentation,
  options: ResponseViewerRenderOptions,
): string {
  const showCookies = model.cookies.available;
  const showAssertions = model.assertions !== undefined;
  const showExtraction = model.extraction !== undefined;
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
    ...(showExtraction
      ? [{
          id: 'extraction',
          label: 'Extracted',
          selected: false,
        }]
      : []),
  ];
  return `<nav class="tabs" role="tablist" aria-label="Response sections">
    ${tabs.map((tab) => `<button type="button" role="tab" id="tab-${tab.id}" data-tab="${tab.id}" aria-controls="panel-${tab.id}" aria-selected="${tab.selected}" tabindex="${tab.selected ? '0' : '-1'}"${tab.selected ? ' class="active"' : ''}>${escapeHtml(tab.label)}</button>`).join('')}
  </nav>
  <section id="panel-body" class="tab-panel" role="tabpanel" aria-labelledby="tab-body"${tabs[0]?.id === 'body' ? '' : ' hidden'}>
    ${renderBody(model.body, options)}
  </section>
  <section id="panel-headers" class="tab-panel" role="tabpanel" aria-labelledby="tab-headers" hidden>
    ${renderHeaders(model)}
  </section>
  ${showCookies ? `<section id="panel-cookies" class="tab-panel" role="tabpanel" aria-labelledby="tab-cookies" hidden>${renderCookies(model)}</section>` : ''}
  ${showAssertions ? `<section id="panel-assertions" class="tab-panel" role="tabpanel" aria-labelledby="tab-assertions" hidden>${renderAssertions(model.assertions!)}</section>` : ''}
  ${showExtraction ? `<section id="panel-extraction" class="tab-panel" role="tabpanel" aria-labelledby="tab-extraction" hidden>${renderExtraction(model.extraction!)}</section>` : ''}
  <aside class="meta-grid" aria-label="Response metadata">
    ${stat('Final URL', model.statistics.finalUrl ?? 'Unknown')}
    ${stat('Started', model.statistics.startedAt)}
    ${stat('Completed', model.statistics.completedAt)}
  </aside>
  ${options.enableCreateVariable === true ? renderCreateVariableChrome() : ''}`;
}

function renderFailure(model: ResponsePresentation): string {
  const failure = model.failure!;
  const assertionTab = model.assertions === undefined
    ? ''
    : `<button type="button" role="tab" id="tab-assertions" data-tab="assertions" aria-controls="panel-assertions" aria-selected="${model.extraction === undefined ? 'true' : 'false'}" tabindex="${model.extraction === undefined ? '0' : '-1'}"${model.extraction === undefined ? ' class="active"' : ''}>Assertions (${model.assertions.summary.passed}/${model.assertions.summary.total})</button>`;
  const extractionTab = model.extraction === undefined
    ? ''
    : `<button type="button" role="tab" id="tab-extraction" data-tab="extraction" aria-controls="panel-extraction" aria-selected="${model.assertions === undefined ? 'true' : 'false'}" tabindex="${model.assertions === undefined ? '0' : '-1'}"${model.assertions === undefined ? ' class="active"' : ''}>Extracted</button>`;
  const hasTabs = assertionTab.length > 0 || extractionTab.length > 0;
  const tabs = hasTabs
    ? `<nav class="tabs" role="tablist" aria-label="Response sections">
        ${assertionTab}
        ${extractionTab}
      </nav>`
    : '';
  const assertionPanel = model.assertions === undefined
    ? ''
    : `<section id="panel-assertions" class="tab-panel" role="tabpanel" aria-labelledby="tab-assertions"${model.extraction === undefined ? '' : ' hidden'}>
        ${renderAssertions(model.assertions)}
      </section>`;
  const extractionPanel = model.extraction === undefined
    ? ''
    : `<section id="panel-extraction" class="tab-panel" role="tabpanel" aria-labelledby="tab-extraction"${model.assertions === undefined ? '' : ' hidden'}>
        ${renderExtraction(model.extraction)}
      </section>`;
  return `<section class="failure-card" aria-labelledby="failure-title">
    <h2 id="failure-title">${escapeHtml(failure.title)}</h2>
    <p>${escapeHtml(failure.message)}</p>
    <dl>
      <div><dt>Code</dt><dd><code>${escapeHtml(failure.code)}</code></dd></div>
      <div><dt>Retryable</dt><dd>${failure.retryable ? 'Yes' : 'No'}</dd></div>
      ${failure.cause?.name === undefined ? '' : `<div><dt>Cause</dt><dd>${escapeHtml(failure.cause.name)}</dd></div>`}
      ${failure.cause?.code === undefined ? '' : `<div><dt>Cause code</dt><dd><code>${escapeHtml(failure.cause.code)}</code></dd></div>`}
      ${failure.cause?.message === undefined ? '' : `<div><dt>Detail</dt><dd>${escapeHtml(failure.cause.message)}</dd></div>`}
    </dl>
  </section>
  ${tabs}
  ${assertionPanel}
  ${extractionPanel}`;
}

/** Status / transport guidance — speculative lines labeled Possible causes. */
function renderExplanation(
  explanation: FailureExplanation | undefined,
): string {
  if (explanation === undefined) {
    return '';
  }
  const facts =
    explanation.facts.length === 0
      ? ''
      : `<ul class="explanation-facts">${explanation.facts
          .map((fact) => `<li>${escapeHtml(fact)}</li>`)
          .join('')}</ul>`;
  const causes =
    explanation.possibleCauses.length === 0
      ? ''
      : `<h3>Possible causes</h3><ul class="explanation-causes">${explanation.possibleCauses
          .map((cause) => `<li>${escapeHtml(cause)}</li>`)
          .join('')}</ul>`;
  return `<section class="explanation-card" aria-labelledby="explanation-title">
    <h2 id="explanation-title">${escapeHtml(explanation.title)}</h2>
    ${facts}
    ${causes}
  </section>`;
}

/** Previous/A vs Current/B diff panel — presentation models only. */
export function renderDiffSection(
  diff: ResponseDiffResult | undefined,
): string {
  if (diff === undefined) {
    return '';
  }
  const rows = diff.changes
    .filter((entry) => entry.change !== 'identical')
    .map((entry) => {
      const changeClass =
        entry.change === 'added'
          ? 'diff-added'
          : entry.change === 'removed'
            ? 'diff-removed'
            : 'diff-changed';
      return `<li class="${changeClass}"><code>${escapeHtml(entry.summary)}</code></li>`;
    })
    .join('');
  const body =
    diff.identical
      ? '<p class="muted">No differences between sides.</p>'
      : `<ul class="diff-list" aria-label="Diff changes">${rows}</ul>`;
  const truncated = diff.truncated === true
    ? '<p class="notice">Diff truncated for performance — additional changes omitted.</p>'
    : '';
  return `<section class="diff-card" aria-labelledby="diff-title" id="diff-panel">
    <h2 id="diff-title">Response Diff</h2>
    <p class="diff-sides"><span class="diff-side-a">${escapeHtml(diff.leftLabel)}</span>
      <span class="sep">vs</span>
      <span class="diff-side-b">${escapeHtml(diff.rightLabel)}</span></p>
    <ul class="diff-summary">${diff.summaryLines
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join('')}</ul>
    ${truncated}
    ${body}
  </section>`;
}

function renderHeaders(model: ResponsePresentation): string {
  return `<div class="panel-toolbar">
    <span class="panel-title">Response headers</span>
    <button type="button" data-action="copyHeaders" title="Copy headers">${iconHtml('copy', { decorative: true })} Copy</button>
  </div>
  <div class="table-wrap"><table><thead><tr><th scope="col">Name</th><th scope="col">Value</th></tr></thead><tbody>
    ${model.headers.length === 0
      ? '<tr><td colspan="2"><div class="empty-inline">No response headers</div></td></tr>'
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
      return `<li class="assert-item assert-${icon}"><span class="assert-outcome-row">${outcomeIconHtml(icon)}<span class="assert-outcome">${escapeHtml(item.outcome)}</span></span><code>${escapeHtml(item.text)}</code>${failure}</li>`;
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

function renderExtraction(extraction: PresentedExtraction): string {
  const { summary } = extraction;
  const failed = summary.failed + summary.malformed;
  const badgeClass = failed > 0 ? 'assert-fail' : 'assert-pass';
  const rows = extraction.outcomes
    .map((item) => {
      const icon =
        item.outcome === 'extracted'
          ? 'pass'
          : item.outcome === 'skipped'
            ? 'skip'
            : 'fail';
      const value =
        item.maskedValue === undefined
          ? ''
          : `<code>${escapeHtml(item.maskedValue)}</code>`;
      const reason =
        item.reason === undefined
          ? ''
          : `<span class="muted">${escapeHtml(item.reason)}</span>`;
      return `<li class="assert-item assert-${icon}"><span class="assert-outcome-row">${outcomeIconHtml(icon)}<span class="assert-outcome">${escapeHtml(item.outcome)}</span></span><strong>${escapeHtml(item.variableName)}</strong><span class="muted">${escapeHtml(item.sourceLabel)}</span>${value}${reason}</li>`;
    })
    .join('');
  return `<div class="panel-toolbar">
    <span class="panel-title">Extracted</span>
    <span class="count ${badgeClass}">${escapeHtml(extraction.chipLabel)}</span>
  </div>
  <div class="assert-summary">
    ${stat('Extracted', String(summary.extracted))}
    ${stat('Failed', String(summary.failed))}
    ${stat('Malformed', String(summary.malformed))}
    ${stat('Skipped', String(summary.skipped))}
  </div>
  <ul class="assert-list">${rows}</ul>`;
}

function renderBody(
  body: ResponseBodyPresentation | undefined,
  options: ResponseViewerRenderOptions = {},
): string {
  if (body === undefined) {
    return '<div class="empty-state"><strong>No response body</strong><span>This response did not include a body to display.</span></div>';
  }
  const truncation = body.truncated
    ? `<div class="notice">Preview truncated to ${body.displayedUnits.toLocaleString()} of ${body.totalUnits.toLocaleString()} ${body.unit}. The canonical response is unchanged.</div>`
    : '';
  const pretty = body.language === 'json' && body.prettyAvailable
    ? renderJsonTree(body.pretty)
    : `<pre tabindex="0"><code>${highlight(body.pretty, body.language)}</code></pre>`;
  const saveAsVariable =
    options.enableCreateVariable === true
    && body.language === 'json'
    && body.prettyAvailable
      ? '<button type="button" data-action="saveAsVariable" id="saveAsVariableBtn" title="Save selected JSON leaf as a variable" disabled>Save as Variable</button><button type="button" data-action="useAsAuth" id="useAsAuthBtn" title="Store detected token in Authentication Session">Use as Authentication</button>'
      : '';
  const generateTypeScript =
    options.canGenerateTypeScript === true
    && body.language === 'json'
    && body.prettyAvailable
    && !body.truncated
      ? '<button type="button" data-action="generateTypeScript" title="Generate TypeScript types from this JSON response">Generate TypeScript</button>'
      : '';
  const detectedAuth =
    options.enableCreateVariable === true
    && body.language === 'json'
    && body.prettyAvailable
    && (options.detectedAuthTokenCount ?? 0) > 0
      ? `<div class="detected-auth cta" role="status">
  <div>
    <strong>Detected Authentication</strong>
    <span class="hint">${options.detectedAuthTokenCount} likely token field${options.detectedAuthTokenCount === 1 ? '' : 's'} found. Confirm before creating a Session.</span>
  </div>
  <div class="toolbar">
    <button type="button" data-action="useAsAuth" class="primary">Create Session / Use as Authentication</button>
  </div>
</div>`
      : '';
  return `<div class="panel-toolbar body-toolbar">
    <div class="toolbar" role="group" aria-label="Body view">
      <button type="button" class="active" data-mode="pretty" aria-pressed="true">Pretty</button>
      <button type="button" data-mode="raw" aria-pressed="false">Raw</button>
      ${body.language === 'json' && body.prettyAvailable
        ? '<button type="button" data-json-action="expand">Expand</button><button type="button" data-json-action="collapse">Collapse</button>'
        : ''}
    </div>
    <div class="toolbar body-actions" role="group" aria-label="Body actions">
      <label class="search-field">
        <span class="sr-only">Search body</span>
        ${iconHtml('search', { decorative: true, className: 'search-field-icon' })}
        <input type="search" id="bodySearch" placeholder="Search" autocomplete="off" spellcheck="false" />
      </label>
      <span id="searchStatus" class="search-status muted" aria-live="polite"></span>
      ${saveAsVariable}
      ${generateTypeScript}
      <button type="button" data-action="copyBody" title="Copy body">${iconHtml('copy', { decorative: true })} Copy</button>
      <button type="button" data-action="saveBody" title="${body.truncated ? 'Save unavailable for truncated preview' : 'Save body'}"${body.truncated ? ' disabled' : ''}>Save</button>
    </div>
  </div>
  ${detectedAuth}
  ${truncation}
  <div data-view="pretty" class="body-view">${pretty}</div>
  <div data-view="raw" class="body-view" hidden><pre tabindex="0"><code>${highlight(body.raw, body.language)}</code></pre></div>`;
}

/** Bounds tree recursion regardless of response nesting depth. */
const JSON_TREE_MAX_DEPTH = 64;

function renderJsonTree(pretty: string): string {
  if (pretty.length > RESPONSE_TEXT_PREVIEW_LIMIT) {
    return `<pre tabindex="0"><code>${highlight(pretty.slice(0, RESPONSE_TEXT_PREVIEW_LIMIT), 'json')}</code></pre>`;
  }
  try {
    return `<div class="json-tree" role="tree">${renderJsonValue(JSON.parse(pretty) as unknown, 'root', 0, 'body')}</div>`;
  } catch {
    return `<pre tabindex="0"><code>${highlight(pretty, 'json')}</code></pre>`;
  }
}

function renderJsonValue(
  value: unknown,
  label: string,
  depth: number,
  path: string,
): string {
  const jsonType = describeJsonType(value);
  const isScalar =
    jsonType === 'string'
    || jsonType === 'number'
    || jsonType === 'boolean'
    || jsonType === 'null';
  const extractable = isScalar && isExtractableJsonPath(path);
  const metaAttrs = [
    `data-json-path="${escapeAttribute(path)}"`,
    `data-json-type="${jsonType}"`,
    ...(isScalar
      ? [
          `data-json-value="${escapeAttribute(stringifyPrimitive(value))}"`,
          `data-json-extractable="${extractable ? 'true' : 'false'}"`,
        ]
      : []),
  ].join(' ');
  const key = label === 'root'
    ? ''
    : `<span class="token-key">${escapeHtml(JSON.stringify(label))}</span><span>: </span>`;
  if (value !== null && typeof value === 'object') {
    if (depth >= JSON_TREE_MAX_DEPTH) {
      const preview = safeJsonPreview(value);
      return `<div class="json-leaf" role="treeitem" ${metaAttrs}>${key}<span class="token-punctuation">${highlight(preview, 'json')}</span></div>`;
    }
    const isArray = Array.isArray(value);
    const entries = isArray
      ? value.map((item, index) => [String(index), item] as const)
      : Object.entries(value);
    const open = depth < 2 ? ' open' : '';
    const kind = isArray ? 'Array' : 'Object';
    return `<details${open} role="treeitem" class="json-node" ${metaAttrs}><summary>${key}<span class="token-punctuation">${kind}(${entries.length})</span></summary><div class="json-children" role="group">${entries.map(([childLabel, child]) => {
      const childPath = isArray
        ? `${path}[${childLabel}]`
        : `${path}.${childLabel}`;
      return renderJsonValue(child, childLabel, depth + 1, childPath);
    }).join('')}</div></details>`;
  }
  return `<div class="json-leaf json-selectable" role="treeitem" tabindex="0" ${metaAttrs}>${key}${jsonPrimitive(value)}</div>`;
}

function describeJsonType(
  value: unknown,
): 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'object') {
    return 'object';
  }
  if (typeof value === 'string') {
    return 'string';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  return 'null';
}

function stringifyPrimitive(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value;
  }
  return String(value);
}

function renderCreateVariableChrome(): string {
  return `
<nav id="jsonContextMenu" class="json-context-menu" hidden role="menu" aria-label="JSON node actions">
  <button type="button" role="menuitem" data-menu="copyValue">Copy Value</button>
  <button type="button" role="menuitem" data-menu="copyPath">Copy JSON Path</button>
  <button type="button" role="menuitem" data-menu="extract">Extract Variable…</button>
  <button type="button" role="menuitem" data-menu="useAsAuth">Use as Authentication…</button>
  <button type="button" role="menuitem" data-menu="expand" hidden>Expand</button>
  <button type="button" role="menuitem" data-menu="collapse" hidden>Collapse</button>
</nav>
<div id="createVariableSheet" class="create-var-sheet" hidden role="dialog" aria-modal="true" aria-labelledby="createVarTitle">
  <div class="create-var-card">
    <h2 id="createVarTitle">Extract Variable</h2>
    <label class="field"><span>Variable name</span><input id="createVarName" type="text" autocomplete="off" spellcheck="false" /></label>
    <label class="field"><span>Path</span>
      <div class="path-row">
        <input id="createVarPath" type="text" readonly />
        <button type="button" id="createVarCopyPath" class="secondary" title="Copy path">Copy</button>
      </div>
    </label>
    <label class="field"><span>Scope</span>
      <select id="createVarScope">
        <option value="environment" selected>Environment</option>
        <option value="document">Request</option>
        <option value="collection">Collection</option>
        <option value="workspace">Workspace</option>
        <option value="run">Run</option>
      </select>
    </label>
    <label class="field check"><input id="createVarSensitive" type="checkbox" /> <span>Sensitive</span></label>
    <label class="field"><span>Value preview</span><input id="createVarPreview" type="text" readonly /></label>
    <p id="createVarOverwrite" class="notice" hidden>A variable with this name already exists and will be overwritten.</p>
    <p id="createVarError" class="error" hidden></p>
    <div class="create-var-actions">
      <button type="button" id="createVarCancel" class="secondary">Cancel</button>
      <button type="button" id="createVarConfirm">Save Extract Rule</button>
    </div>
  </div>
</div>`;
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

/** Icon for an assertion/extraction outcome row (`pass` / `skip` / `fail`). */
function outcomeIconHtml(outcome: 'pass' | 'skip' | 'fail'): string {
  if (outcome === 'pass') {
    return iconHtml('check-circle', { decorative: true, className: 'ah-icon--success' });
  }
  if (outcome === 'skip') {
    return iconHtml('minus-circle', { decorative: true, className: 'ah-icon--muted' });
  }
  return iconHtml('x-circle', { decorative: true, className: 'ah-icon--error' });
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

const VIEWER_CSS = `
${WEBVIEW_SHARED_CSS}
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.4;
}
main { display: flex; flex-direction: column; gap: 0; min-height: 100vh; }
.status-card.sticky-summary {
  position: sticky; top: 0; z-index: 3;
  padding: var(--ah-space-3) var(--ah-space-4) var(--ah-space-2);
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
}
.status-row, .request-line, .panel-toolbar, .toolbar, .body-toolbar, .stats-summary {
  display: flex; align-items: center; gap: var(--ah-space-2); flex-wrap: wrap;
}
.status-row { margin-bottom: var(--ah-space-2); justify-content: flex-start; }
.request-line {
  color: var(--vscode-descriptionForeground);
  overflow-wrap: anywhere;
  margin-bottom: var(--ah-space-2);
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
  font-size: .92em;
}
.summary { color: var(--vscode-descriptionForeground); font-size: .92em; }
.secondary-stats { gap: 4px; opacity: .9; }
.secondary-stats .stat-chip { border-color: transparent; background: transparent; padding: 0 4px; }
.body-toolbar {
  padding: var(--ah-space-2) 0;
  margin-bottom: var(--ah-space-2);
  border-bottom: 1px solid var(--vscode-panel-border);
  align-items: flex-start;
}
.detected-auth {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ah-space-3);
  align-items: center;
  justify-content: space-between;
  margin: 0 0 var(--ah-space-3);
  padding: var(--ah-space-3);
  border-radius: var(--ah-radius);
  background: var(--vscode-inputValidation-infoBackground, var(--vscode-editorWidget-background));
  border: 1px solid var(--vscode-focusBorder, var(--vscode-panel-border));
}
.detected-auth strong { display: block; margin-bottom: 2px; }
.detected-auth .hint { color: var(--vscode-descriptionForeground); font-size: 12px; }
.meta-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--ah-space-2); padding: var(--ah-space-3) var(--ah-space-4) var(--ah-space-4);
}
.tabs {
  display: flex; gap: 0; padding: 0 var(--ah-space-2);
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
}
.tabs [role="tab"] {
  appearance: none; border: none; border-bottom: 2px solid transparent;
  margin-bottom: -1px; border-radius: 0; background: transparent;
  color: var(--vscode-foreground); padding: 7px 10px; cursor: pointer;
  opacity: .72; font: inherit;
}
.tabs [role="tab"]:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, transparent); }
.tabs [role="tab"].active, .tabs [role="tab"][aria-selected="true"] {
  opacity: 1; border-bottom-color: var(--vscode-focusBorder);
  color: var(--vscode-foreground); font-weight: 600;
}
.tabs [role="tab"]:focus-visible, summary:focus-visible, pre:focus-visible {
  outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px;
}
.tab-panel { padding: var(--ah-space-3) var(--ah-space-4) var(--ah-space-4); flex: 1; min-height: 0; }
.panel-toolbar { justify-content: space-between; margin-bottom: var(--ah-space-2); gap: var(--ah-space-2); }
.panel-title { font-weight: 600; font-size: .95em; }
.body-actions { margin-left: auto; }
.toolbar [data-mode].active,
.toolbar button.active {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  font-weight: 600;
}
.search-field {
  display: inline-flex; align-items: center; gap: 4px;
}
.search-field-icon { color: var(--vscode-descriptionForeground); }
.search-field input {
  width: min(200px, 36vw); padding: 3px 8px;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: var(--ah-radius); font: inherit;
}
.search-field input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.search-status { font-size: .85em; min-width: 4.5rem; }
pre, .json-tree {
  margin: 0; padding: var(--ah-space-3); overflow: auto; max-height: calc(100vh - 220px);
  background: var(--vscode-textCodeBlock-background);
  border: 1px solid var(--vscode-panel-border); border-radius: var(--ah-radius); tab-size: 2;
  line-height: 1.5;
}
code { font-family: var(--vscode-editor-font-family); }
.notice {
  padding: var(--ah-space-2) 10px; margin: 0 0 var(--ah-space-2);
  color: var(--vscode-descriptionForeground);
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
  border-radius: var(--ah-radius); overflow-wrap: anywhere; font-size: .9em;
}
.table-wrap { overflow-x: auto; border: 1px solid var(--vscode-panel-border); border-radius: var(--ah-radius); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 6px 10px; border-top: 1px solid var(--vscode-panel-border); overflow-wrap: anywhere; }
th { color: var(--vscode-descriptionForeground); font-weight: 600; font-size: .85em; background: var(--vscode-sideBar-background); }
tbody tr:hover { background: var(--vscode-list-hoverBackground); }
.count, .masked, .muted, .empty-inline { color: var(--vscode-descriptionForeground); font-weight: 400; }
.empty-inline { padding: var(--ah-space-2) 0; }
.assert-pass { color: var(--vscode-testing-iconPassed, var(--vscode-charts-green)); }
.assert-fail { color: var(--vscode-testing-iconFailed, var(--vscode-editorError-foreground)); }
.assert-summary {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: var(--ah-space-2); margin-bottom: var(--ah-space-3);
}
.stat {
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
  border-radius: var(--ah-radius); padding: var(--ah-space-2) 10px; min-width: 0;
}
.stat span { display: block; color: var(--vscode-descriptionForeground); font-size: .85em; }
.stat strong { display: block; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--ah-space-2); padding: 0 var(--ah-space-4) var(--ah-space-4);
}
.assert-list { list-style: none; margin: 0; padding: 0; }
.assert-item { display: grid; gap: 6px; padding: var(--ah-space-2) 0; border-top: 1px solid var(--vscode-panel-border); }
.assert-outcome-row { display: inline-flex; align-items: center; gap: 4px; }
.assert-outcome { text-transform: uppercase; font-size: .75em; font-weight: 700; letter-spacing: .04em; }
.assert-item.assert-pass .assert-outcome { color: var(--vscode-testing-iconPassed, var(--vscode-charts-green)); }
.assert-item.assert-fail .assert-outcome { color: var(--vscode-testing-iconFailed, var(--vscode-editorError-foreground)); }
.assert-item.assert-skip .assert-outcome { color: var(--vscode-descriptionForeground); }
.assert-detail { margin-top: 4px; }
.failure-card {
  margin: var(--ah-space-3) var(--ah-space-4); padding: var(--ah-space-3) var(--ah-space-4);
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background); border-radius: var(--ah-radius);
}
.failure-card h2 { margin: 0 0 var(--ah-space-2); font-size: 1.05rem; }
.failure-card p { margin: 0 0 var(--ah-space-2); }
.explanation-card {
  margin: var(--ah-space-3) var(--ah-space-4); padding: var(--ah-space-3) var(--ah-space-4);
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
  border-radius: var(--ah-radius);
}
.explanation-card h2 { margin: 0 0 var(--ah-space-2); font-size: 1.05rem; }
.explanation-card h3 {
  margin: var(--ah-space-2) 0 var(--ah-space-1); font-size: .9rem;
  color: var(--vscode-descriptionForeground); font-weight: 600;
}
.explanation-facts, .explanation-causes {
  margin: 0; padding-left: 1.2rem;
}
.explanation-facts li, .explanation-causes li { margin: 2px 0; }
.diff-card {
  margin: var(--ah-space-3) var(--ah-space-4); padding: var(--ah-space-3) var(--ah-space-4);
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
  border-radius: var(--ah-radius);
}
.diff-card h2 { margin: 0 0 var(--ah-space-2); font-size: 1.05rem; }
.diff-sides { margin: 0 0 var(--ah-space-2); display: flex; gap: var(--ah-space-2); align-items: center; flex-wrap: wrap; }
.diff-side-a, .diff-side-b { font-weight: 600; }
.diff-side-a { color: var(--vscode-charts-orange, var(--vscode-editorWarning-foreground)); }
.diff-side-b { color: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); }
.diff-summary, .diff-list { margin: 0 0 var(--ah-space-2); padding-left: 1.2rem; }
.diff-list li { margin: 3px 0; overflow-wrap: anywhere; }
.diff-added code { color: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-testing-iconPassed)); }
.diff-removed code { color: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-testing-iconFailed)); }
.diff-changed code { color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-editorWarning-foreground)); }
.compare-prev-btn { margin-left: auto; white-space: nowrap; }
dl div { display: grid; grid-template-columns: minmax(90px, 140px) 1fr; padding: 4px 0; }
dt { color: var(--vscode-descriptionForeground); }
dd { margin: 0; overflow-wrap: anywhere; }
.json-tree { font-family: var(--vscode-editor-font-family); }
.json-children { padding-left: 18px; border-left: 1px solid var(--vscode-tree-indentGuidesStroke); }
.json-leaf, .json-tree summary { min-height: 1.45em; }
.json-tree summary { cursor: pointer; }
.json-leaf.json-selectable { cursor: pointer; border-radius: 2px; }
.json-leaf.json-selectable:hover, .json-leaf.json-selectable:focus-visible,
.json-leaf.json-selected { background: var(--vscode-list-hoverBackground); outline: none; }
.json-leaf.json-selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.json-context-menu {
  position: fixed; z-index: 40; min-width: 180px; padding: 4px 0;
  background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
  color: var(--vscode-menu-foreground, var(--vscode-foreground));
  border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
  border-radius: var(--ah-radius); box-shadow: 0 4px 16px rgba(0,0,0,.25);
}
.json-context-menu button {
  display: block; width: 100%; text-align: left; border: 0; background: transparent;
  color: inherit; padding: 6px 12px; border-radius: 0;
}
.json-context-menu button:hover, .json-context-menu button:focus-visible {
  background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
  color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
}
.json-context-menu button:disabled { opacity: .45; }
.create-var-sheet {
  position: fixed; inset: 0; z-index: 50; display: grid; place-items: center;
  background: rgba(0,0,0,.45); padding: var(--ah-space-4);
}
.create-var-sheet[hidden] { display: none !important; }
.create-var-card {
  width: min(420px, 100%); max-height: 90vh; overflow: auto;
  background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
  border: 1px solid var(--vscode-panel-border); border-radius: var(--ah-radius);
  padding: var(--ah-space-4); display: grid; gap: var(--ah-space-3);
}
.create-var-card h2 { margin: 0; font-size: 1.05rem; }
.create-var-card .field { display: grid; gap: 4px; }
.create-var-card .field.check { grid-template-columns: auto 1fr; align-items: center; gap: 8px; }
.create-var-card .path-row { display: flex; gap: 6px; }
.create-var-card .path-row input { flex: 1; min-width: 0; }
.create-var-actions { display: flex; justify-content: flex-end; gap: 8px; }
.create-var-card .error { color: var(--vscode-errorForeground); margin: 0; }
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
  .status-badge, button, .stat, .stat-chip, .notice, .table-wrap, pre, .json-tree, .failure-card, .explanation-card, .diff-card, .empty-state {
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
  document.querySelector('[data-action="comparePrevious"]')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'comparePrevious' });
  });
  document.querySelector('[data-action="generateTypeScript"]')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'generateTypeScript' });
  });
  for (const button of document.querySelectorAll('[data-action="useAsAuth"]')) {
    button.addEventListener('click', () => {
      vscode.postMessage({ type: 'useAsAuthentication' });
    });
  }
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
  let searchCapped = false;
  const SEARCH_MATCH_LIMIT = ${RESPONSE_SEARCH_MATCH_LIMIT};

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
    searchCapped = false;
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
      if (matches.length >= SEARCH_MATCH_LIMIT) {
        searchCapped = true;
        break;
      }
      const text = textNode.nodeValue || '';
      const lower = text.toLowerCase();
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      let found = lower.indexOf(lowerQuery, cursor);
      while (found !== -1) {
        if (matches.length >= SEARCH_MATCH_LIMIT) {
          searchCapped = true;
          if (cursor < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(cursor)));
          }
          break;
        }
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
      if (!searchCapped && cursor < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
      }
      if (fragment.childNodes.length > 0) {
        textNode.parentNode?.replaceChild(fragment, textNode);
      }
      if (searchCapped) break;
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
    if (searchCapped) {
      searchStatus.textContent = 'Showing first ' + matches.length + ' matches';
      return;
    }
    searchStatus.textContent = (matchIndex + 1) + ' of ' + matches.length;
  }

  // --- Create Variable From Response (ADR §12) ---
  const createEnabled = document.body.dataset.enableCreateVariable === 'true';
  let knownNames = [];
  try {
    knownNames = JSON.parse(document.body.dataset.knownVariables || '[]');
  } catch (_) {
    knownNames = [];
  }
  let selectedNode = null;
  const menu = document.getElementById('jsonContextMenu');
  const sheet = document.getElementById('createVariableSheet');
  const saveAsBtn = document.getElementById('saveAsVariableBtn');
  const nameInput = document.getElementById('createVarName');
  const pathInput = document.getElementById('createVarPath');
  const scopeSelect = document.getElementById('createVarScope');
  const sensitiveInput = document.getElementById('createVarSensitive');
  const previewInput = document.getElementById('createVarPreview');
  const overwriteEl = document.getElementById('createVarOverwrite');
  const errorEl = document.getElementById('createVarError');

  function isScalarType(type) {
    return type === 'string' || type === 'number' || type === 'boolean' || type === 'null';
  }

  function sanitizeName(raw) {
    let name = String(raw || '').trim().replace(/[^A-Za-z0-9_.-]/g, '_');
    if (/^[0-9]/.test(name)) name = 'v_' + name;
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) || name.length === 0) return 'extracted';
    return name;
  }

  function leafKey(path) {
    const trimmed = String(path || '').trim();
    const without = trimmed.toLowerCase().startsWith('body.')
      ? trimmed.slice(5)
      : (trimmed.toLowerCase() === 'body' ? '' : trimmed);
    if (!without) return 'body';
    const bracket = without.lastIndexOf('[');
    const dot = without.lastIndexOf('.');
    if (bracket > dot) {
      const m = /^\\[(\\d+)\\]$/.exec(without.slice(bracket));
      return m ? m[1] : 'item';
    }
    if (dot >= 0) return without.slice(dot + 1) || 'extracted';
    return without;
  }

  function looksSensitive(name, path) {
    return /(token|secret|password|api[_-]?key|authorization)/i.test(name + ' ' + path);
  }

  function selectNode(node) {
    if (selectedNode) selectedNode.classList.remove('json-selected');
    selectedNode = node;
    if (node) node.classList.add('json-selected');
    if (saveAsBtn) {
      const type = node?.dataset.jsonType;
      const extractable = node?.dataset.jsonExtractable === 'true';
      saveAsBtn.disabled = !(node && isScalarType(type) && extractable);
    }
  }

  function hideMenu() {
    if (menu) menu.hidden = true;
  }

  function openSheet(node) {
    if (!createEnabled || !sheet || !node) return;
    const path = node.dataset.jsonPath || '';
    const type = node.dataset.jsonType || '';
    if (!isScalarType(type) || node.dataset.jsonExtractable !== 'true') return;
    const value = node.dataset.jsonValue ?? '';
    const defaultName = sanitizeName(leafKey(path));
    if (nameInput) nameInput.value = defaultName;
    if (pathInput) pathInput.value = path;
    if (scopeSelect) scopeSelect.value = 'environment';
    if (sensitiveInput) sensitiveInput.checked = looksSensitive(defaultName, path);
    updatePreview();
    updateOverwrite();
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
    sheet.hidden = false;
    nameInput?.focus();
  }

  function closeSheet() {
    if (sheet) sheet.hidden = true;
  }

  function updatePreview() {
    if (!previewInput || !selectedNode) return;
    const sensitive = sensitiveInput?.checked === true;
    const value = selectedNode.dataset.jsonValue ?? '';
    previewInput.value = sensitive ? '••••••••' : value;
  }

  function updateOverwrite() {
    if (!overwriteEl || !nameInput) return;
    const name = nameInput.value.trim();
    const known = Array.isArray(knownNames) && knownNames.includes(name);
    overwriteEl.hidden = !known;
  }

  function nodeFromEventTarget(target) {
    if (!(target instanceof Element)) return null;
    return target.closest('[data-json-path]');
  }

  if (createEnabled) {
    document.querySelector('.json-tree')?.addEventListener('click', (event) => {
      const node = nodeFromEventTarget(event.target);
      if (!node || !(node instanceof HTMLElement)) return;
      if (node.tagName === 'DETAILS') return;
      selectNode(node);
    });

    document.querySelector('.json-tree')?.addEventListener('contextmenu', (event) => {
      const node = nodeFromEventTarget(event.target);
      if (!node || !(node instanceof HTMLElement) || !menu) return;
      event.preventDefault();
      selectNode(node);
      const type = node.dataset.jsonType || '';
      const scalar = isScalarType(type);
      const extractable = node.dataset.jsonExtractable === 'true';
      const isDetails = node.tagName === 'DETAILS';
      const extractBtn = menu.querySelector('[data-menu="extract"]');
      const expandBtn = menu.querySelector('[data-menu="expand"]');
      const collapseBtn = menu.querySelector('[data-menu="collapse"]');
      if (extractBtn) extractBtn.disabled = !scalar || !extractable;
      if (expandBtn) {
        expandBtn.hidden = !isDetails;
        expandBtn.disabled = !isDetails || node.open;
      }
      if (collapseBtn) {
        collapseBtn.hidden = !isDetails;
        collapseBtn.disabled = !isDetails || !node.open;
      }
      menu.hidden = false;
      menu.style.left = Math.min(event.clientX, window.innerWidth - 200) + 'px';
      menu.style.top = Math.min(event.clientY, window.innerHeight - 160) + 'px';
    });

    document.addEventListener('click', (event) => {
      if (menu && !menu.hidden && event.target instanceof Node && !menu.contains(event.target)) {
        hideMenu();
      }
    });

    menu?.addEventListener('click', (event) => {
      const btn = event.target instanceof Element ? event.target.closest('[data-menu]') : null;
      if (!btn || !(btn instanceof HTMLElement) || !selectedNode) return;
      const action = btn.dataset.menu;
      hideMenu();
      if (action === 'copyValue') {
        const path = selectedNode.dataset.jsonPath ?? '';
        if (selectedNode.dataset.jsonExtractable === 'true') {
          vscode.postMessage({ type: 'copyJsonPathValue', path });
        } else {
          // Non-identifier keys cannot be re-resolved via json-path grammar.
          vscode.postMessage({ type: 'copyText', text: selectedNode.dataset.jsonValue ?? '' });
        }
      } else if (action === 'copyPath') {
        vscode.postMessage({ type: 'copyText', text: selectedNode.dataset.jsonPath ?? '' });
      } else if (action === 'extract') {
        openSheet(selectedNode);
      } else if (action === 'useAsAuth') {
        vscode.postMessage({ type: 'useAsAuthentication' });
      } else if (action === 'expand' && selectedNode.tagName === 'DETAILS') {
        selectedNode.open = true;
      } else if (action === 'collapse' && selectedNode.tagName === 'DETAILS') {
        selectedNode.open = false;
      }
    });

    saveAsBtn?.addEventListener('click', () => {
      if (selectedNode) openSheet(selectedNode);
    });

    nameInput?.addEventListener('input', () => {
      updateOverwrite();
      if (sensitiveInput && !sensitiveInput.dataset.touched) {
        sensitiveInput.checked = looksSensitive(nameInput.value, pathInput?.value || '');
        updatePreview();
      }
    });
    sensitiveInput?.addEventListener('change', () => {
      sensitiveInput.dataset.touched = '1';
      updatePreview();
    });
    document.getElementById('createVarCopyPath')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'copyText', text: pathInput?.value || '' });
    });
    document.getElementById('createVarCancel')?.addEventListener('click', closeSheet);
    sheet?.addEventListener('click', (event) => {
      if (event.target === sheet) closeSheet();
    });
    document.getElementById('createVarConfirm')?.addEventListener('click', () => {
      const name = (nameInput?.value || '').trim();
      const path = (pathInput?.value || '').trim();
      const scope = scopeSelect?.value || 'environment';
      const sensitive = sensitiveInput?.checked === true;
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) {
        if (errorEl) {
          errorEl.hidden = false;
          errorEl.textContent = 'Enter a valid variable name (letters, digits, _, ., -).';
        }
        return;
      }
      if (!path) {
        if (errorEl) {
          errorEl.hidden = false;
          errorEl.textContent = 'Path is required.';
        }
        return;
      }
      vscode.postMessage({ type: 'createVariable', name, path, scope, sensitive });
      closeSheet();
    });
  }
})();
`;
