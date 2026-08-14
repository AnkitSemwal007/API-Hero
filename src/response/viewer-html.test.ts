import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ExecutionResult, GraphqlEnvelopeSummary } from '../execution';
import type { RuntimeJsonValue } from '../models/request';
import { freezeDetachedBytes } from '../shared';
import { presentExecutionResult } from './presentation';
import {
  resolveCreateVariableValue,
  type ResponseViewerDisposable,
  type ResponseViewerPanel,
  type ResponseViewerPanelFactory,
  ResponseViewerService,
} from './response-viewer-service';
import {
  parseResponseViewerMessage,
  renderResponseViewerHtml,
} from './viewer-html';

function result(body = '{"value":"<img src=x onerror=alert(1)>"}'): ExecutionResult {
  const bytes = freezeDetachedBytes(new TextEncoder().encode(body));
  const timing = Object.freeze({
    startedAt: '2026-07-19T10:00:00.000Z',
    completedAt: '2026-07-19T10:00:00.010Z',
    durationMs: 10,
  });
  let json: RuntimeJsonValue | undefined;
  try {
    json = JSON.parse(body) as RuntimeJsonValue;
  } catch {
    json = undefined;
  }
  return Object.freeze({
    success: true,
    requestId: 'request-1',
    request: Object.freeze({
      method: 'GET',
      url: 'https://example.test/<script>alert(1)</script>',
    }),
    timing,
    response: Object.freeze({
      requestId: 'request-1',
      statusCode: 200,
      statusText: '<b>OK</b>',
      headers: Object.freeze([
        Object.freeze({ name: 'X-Unsafe', value: '"><script>alert(2)</script>' }),
      ]),
      body: Object.freeze({
        bytes,
        text: body,
        ...(json === undefined ? {} : { json: Object.freeze(json) as RuntimeJsonValue }),
      }),
      bodySizeBytes: bytes.byteLength,
      contentType: 'application/json',
      url: 'https://example.test/final',
      redirected: false,
      redirectCount: 0,
      timing,
    }),
  });
}

test('renders a nonce-only CSP and escapes all response values', () => {
  const html = renderResponseViewerHtml(
    presentExecutionResult(result()),
    'fixedNonce123',
  );

  assert.match(html, /default-src 'none'/u);
  assert.match(html, /style-src 'nonce-fixedNonce123'/u);
  assert.match(html, /script-src 'nonce-fixedNonce123'/u);
  assert.equal(html.includes('unsafe-inline'), false);
  assert.equal(html.includes('https://example.test/<script>'), false);
  assert.equal(html.includes('"><script>alert(2)</script>'), false);
  assert.equal(html.includes('<img src=x onerror=alert(1)>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
});

test('renders accessible pretty/raw and JSON expansion controls', () => {
  const html = renderResponseViewerHtml(
    presentExecutionResult(result()),
    'nonce',
  );

  assert.match(html, /data-mode="pretty"/u);
  assert.match(html, /data-mode="raw"/u);
  assert.match(html, /data-json-action="expand"/u);
  assert.match(html, /data-json-action="collapse"/u);
  assert.match(html, /role="tree"/u);
  assert.match(html, /aria-pressed="true"/u);
  assert.match(html, /@media \(max-width: 560px\)/u);
  assert.match(html, /@media \(forced-colors: active\)/u);
  assert.match(html, /var\(--vscode-editor-background\)/u);
});

test('WebSocket success renders a session badge instead of HTTP 0', () => {
  const base = result('{"ok":true}');
  assert.equal(base.success, true);
  if (!base.success) {
    return;
  }
  const websocket: ExecutionResult = {
    ...base,
    request: Object.freeze({
      method: 'GET',
      url: 'ws://example.test/socket',
    }),
    response: {
      ...base.response,
      statusCode: 0,
      statusText: 'received',
      url: 'ws://example.test/socket',
    },
    websocket: {
      connected: true,
      sent: true,
      received: true,
      closed: true,
      closeCode: 1000,
      sentMessage: '{"type":"ping"}',
    },
  };
  const html = renderResponseViewerHtml(
    presentExecutionResult(websocket),
    'nonce',
  );
  assert.match(html, /WebSocket received/u);
  assert.doesNotMatch(html, />0 received</u);
  assert.match(html, /aria-label="WebSocket messages"/u);
  assert.match(html, /ws-event-sent/u);
  assert.match(html, /ws-event-received/u);
  assert.match(html, /→/u);
  assert.match(html, /←/u);
  assert.match(html, /\(sent\)/u);
  assert.match(html, /\(received\)/u);
  assert.match(html, /Connected/u);
  assert.match(html, /Closed \(1000\)/u);
  assert.match(html, /\.ws-messages, \.ws-event/u);
});

test('WebSocket messages redact Bearer tokens and accessToken values', () => {
  const base = result('{"type":"pong"}');
  assert.equal(base.success, true);
  if (!base.success) {
    return;
  }
  const websocket: ExecutionResult = {
    ...base,
    request: Object.freeze({
      method: 'GET',
      url: 'ws://example.test/socket',
    }),
    response: {
      ...base.response,
      statusCode: 0,
      statusText: 'received',
      url: 'ws://example.test/socket',
    },
    websocket: {
      connected: true,
      sent: true,
      received: true,
      closed: true,
      sentMessage:
        '{"authorization":"Bearer leaked-ws-token","accessToken":"sent-secret-token"}',
    },
  };
  const html = renderResponseViewerHtml(
    presentExecutionResult(websocket),
    'nonce',
  );
  assert.match(html, /ws-event-sent/u);
  assert.match(html, /ws-event-received/u);
  assert.match(html, /Connected/u);
  assert.doesNotMatch(html, /leaked-ws-token/u);
  assert.doesNotMatch(html, /sent-secret-token/u);
  assert.doesNotMatch(html, /Bearer leaked/u);
});

test('renders Possible causes for successful 401 responses', () => {
  const base = result('{"error":"unauthorized"}');
  assert.equal(base.success, true);
  if (!base.success) {
    return;
  }
  const unauthorized: ExecutionResult = {
    ...base,
    response: {
      ...base.response,
      statusCode: 401,
      statusText: 'Unauthorized',
    },
  };
  const html = renderResponseViewerHtml(
    presentExecutionResult(unauthorized),
    'nonce',
  );
  assert.match(html, /explanation-card/u);
  assert.match(html, /401 Unauthorized/u);
  assert.match(html, /Possible causes/u);
  assert.match(html, /Authorization header missing/u);
  assert.doesNotMatch(html, /Bearer\s+\w+/u);
});

test('renders status card, tabs, copy/save/search without cookies placeholder', () => {
  const html = renderResponseViewerHtml(
    presentExecutionResult(result()),
    'nonce',
  );

  assert.match(html, /class="status-card sticky-summary"/u);
  assert.match(html, /class="stats-summary[^"]*"/u);
  assert.match(html, /method-badge method-get/u);
  assert.match(html, /role="tablist"/u);
  assert.match(html, /data-tab="body"/u);
  assert.match(html, /data-tab="headers"/u);
  assert.match(html, /data-action="copyBody"/u);
  assert.match(html, /data-action="saveBody"/u);
  assert.match(html, /data-action="copyHeaders"/u);
  assert.equal(
    /<button[^>]*data-action="generateTypeScript"/u.test(html),
    false,
  );
  assert.match(html, /id="bodySearch"/u);
  assert.match(html, /SEARCH_MATCH_LIMIT = 500/u);
  assert.match(html, /Showing first /u);
  assert.equal(html.includes('data-tab="cookies"'), false);
  assert.equal(html.includes('Cookie parsing and storage are not enabled'), false);
  assert.equal(/Cookies/u.test(html), false);
});

test('shows HTML and XML as highlighted source instead of markup', () => {
  for (const [contentType, body] of [
    ['text/html', '<main onclick="bad()">Hello</main>'],
    ['application/xml', '<?xml version="1.0"?><root>value</root>'],
  ] as const) {
    const base = result(body);
    assert.equal(base.success, true);
    if (!base.success) continue;
    const adjusted: ExecutionResult = {
      ...base,
      response: {
        ...base.response,
        contentType,
        body: { bytes: base.response.body.bytes, text: body },
      },
    };
    const html = renderResponseViewerHtml(
      presentExecutionResult(adjusted),
      'nonce',
    );
    assert.equal(html.includes(body), false);
    assert.match(html, /token-tag/u);
    assert.match(html, /&lt;/u);
  }
});

test('validates webview messages against a closed schema', () => {
  assert.deepEqual(parseResponseViewerMessage({ type: 'ready' }), { type: 'ready' });
  assert.deepEqual(parseResponseViewerMessage({ type: 'copyHeaders' }), {
    type: 'copyHeaders',
  });
  assert.deepEqual(parseResponseViewerMessage({ type: 'generateTypeScript' }), {
    type: 'generateTypeScript',
  });
  assert.deepEqual(
    parseResponseViewerMessage({ type: 'copyBody', mode: 'raw' }),
    { type: 'copyBody', mode: 'raw' },
  );
  assert.deepEqual(
    parseResponseViewerMessage({ type: 'saveBody', mode: 'pretty' }),
    { type: 'saveBody', mode: 'pretty' },
  );
  for (const value of [
    null,
    'ready',
    { type: 'ready', payload: true },
    { type: 'reveal-secret' },
    { command: 'ready' },
    ['ready'],
    { type: 'copyBody' },
    { type: 'copyBody', mode: 'hex' },
    { type: 'saveBody', mode: 'pretty', extra: true },
    { type: 'copyHeaders', mode: 'pretty' },
    { type: 'generateTypeScript', extra: true },
  ]) {
    assert.equal(parseResponseViewerMessage(value), undefined);
  }
});

class MockPanel implements ResponseViewerPanel {
  public html = '';
  public revealCount = 0;
  public disposeCount = 0;
  public readonly events: ('setHtml' | 'reveal')[] = [];
  private disposeListeners = new Set<() => void>();
  private messageListeners = new Set<
    (message: unknown) => void | Promise<void>
  >();

  public setHtml(html: string): void {
    this.html = html;
    this.events.push('setHtml');
  }

  public reveal(): void {
    this.revealCount += 1;
    this.events.push('reveal');
  }

  public onDidDispose(listener: () => void): ResponseViewerDisposable {
    this.disposeListeners.add(listener);
    return { dispose: () => this.disposeListeners.delete(listener) };
  }

  public onDidReceiveMessage(
    listener: (message: unknown) => void | Promise<void>,
  ): ResponseViewerDisposable {
    this.messageListeners.add(listener);
    return { dispose: () => this.messageListeners.delete(listener) };
  }

  public dispose(): void {
    this.disposeCount += 1;
    for (const listener of [...this.disposeListeners]) listener();
  }

  public closeFromUser(): void {
    for (const listener of [...this.disposeListeners]) listener();
  }

  public async emitMessage(message: unknown): Promise<void> {
    for (const listener of [...this.messageListeners]) {
      await listener(message);
    }
  }
}

class MockPanelFactory implements ResponseViewerPanelFactory {
  public readonly panels: MockPanel[] = [];

  public create(): ResponseViewerPanel {
    const panel = new MockPanel();
    this.panels.push(panel);
    return panel;
  }
}

test('reuses, updates, and disposes response panels safely', () => {
  const factory = new MockPanelFactory();
  let nonce = 0;
  const viewer = new ResponseViewerService(factory, () => `nonce-${++nonce}`);

  viewer.show(result());
  assert.equal(factory.panels.length, 1);
  assert.match(factory.panels[0]!.html, /nonce-1/u);

  viewer.show(result('{"updated":true}'));
  assert.equal(factory.panels.length, 1);
  assert.equal(factory.panels[0]!.revealCount, 1);
  assert.match(factory.panels[0]!.html, /updated/u);
  assert.match(factory.panels[0]!.html, /nonce-2/u);

  factory.panels[0]!.closeFromUser();
  viewer.update(result('{"newPanel":true}'));
  assert.equal(factory.panels.length, 2);
  assert.match(factory.panels[1]!.html, /newPanel/u);

  viewer.dispose();
  assert.equal(factory.panels[1]!.disposeCount, 1);
});

test('sets the new response HTML before revealing an existing panel', () => {
  const factory = new MockPanelFactory();
  const viewer = new ResponseViewerService(factory, () => 'nonce');

  viewer.show(result());
  const panel = factory.panels[0]!;
  panel.events.length = 0;

  viewer.show(result('{"second":true}'));

  assert.equal(factory.panels.length, 1);
  assert.deepEqual(panel.events, ['setHtml', 'reveal']);
  assert.match(panel.html, /second/u);
});

test('copies and saves body/headers through host actions from the presentation model', async () => {
  const factory = new MockPanelFactory();
  const copied: string[] = [];
  const saved: { fileName: string; content: string }[] = [];
  const viewer = new ResponseViewerService(
    factory,
    () => 'nonce',
    {
      copyText: (text) => {
        copied.push(text);
      },
      saveText: (fileName, content) => {
        saved.push({ fileName, content });
      },
    },
  );

  viewer.show(result('{"ok":true}'));
  const panel = factory.panels[0]!;

  await panel.emitMessage({ type: 'copyBody', mode: 'raw' });
  await panel.emitMessage({ type: 'copyHeaders' });
  await panel.emitMessage({ type: 'saveBody', mode: 'raw' });
  await panel.emitMessage({ type: 'reveal-secret' });

  assert.equal(copied.length, 2);
  assert.equal(copied[0], '{"ok":true}');
  assert.match(copied[1]!, /X-Unsafe:/u);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.fileName, 'response.json');
  assert.equal(saved[0]?.content, '{"ok":true}');
});

test('offers Generate TypeScript for successful JSON and presents via host', async () => {
  const factory = new MockPanelFactory();
  const presented: {
    code: string;
    rootName: string;
    suggestedFileName: string;
  }[] = [];
  const viewer = new ResponseViewerService(
    factory,
    () => 'nonce',
    {
      copyText: () => undefined,
      saveText: () => undefined,
      presentGeneratedTypeScript: (input) => {
        presented.push({
          code: input.code,
          rootName: input.rootName,
          suggestedFileName: input.suggestedFileName,
        });
      },
    },
  );

  viewer.show(result('{"id":1,"name":"Ada"}'));
  assert.equal(viewer.canGenerateTypeScript(), true);
  assert.match(
    factory.panels[0]!.html,
    /<button[^>]*data-action="generateTypeScript"/u,
  );

  await factory.panels[0]!.emitMessage({ type: 'generateTypeScript' });
  assert.equal(presented.length, 1);
  assert.equal(presented[0]?.rootName, 'Root');
  assert.match(presented[0]!.code, /export interface Root \{/u);
  assert.match(presented[0]!.code, /id: number;/u);
  assert.match(presented[0]!.suggestedFileName, /\.ts$/u);

  const code = await viewer.generateTypeScript('User');
  assert.match(code ?? '', /export interface User \{/u);
  assert.equal(presented.length, 2);
  assert.equal(presented[1]?.rootName, 'User');
});

test('generateTypeScript attribution and lastExecutionSourceId stay request-bound', async () => {
  const factory = new MockPanelFactory();
  const presented: string[] = [];
  const viewer = new ResponseViewerService(
    factory,
    () => 'nonce',
    {
      copyText: () => undefined,
      saveText: () => undefined,
      presentGeneratedTypeScript: (input) => {
        presented.push(input.code);
      },
    },
  );

  viewer.show(result('{"id":1}'), undefined, undefined, {
    sourceId: 'file:///ws/Collections/Demo/Get-User.api',
    requestKey: 'request:file:///ws/Collections/Demo/Get-User.api#0',
    offset: 0,
  });
  assert.equal(
    viewer.lastExecutionSourceId(),
    'file:///ws/Collections/Demo/Get-User.api',
  );
  assert.equal(viewer.lastExecutionOffset(), 0);

  const code = await viewer.generateTypeScript('User', {
    attribution: {
      requestName: 'Get User',
      requestPath: 'Collections/Demo/Get-User.api',
    },
  });
  assert.match(code ?? '', /@api-hero name: Get User/u);
  assert.match(code ?? '', /@api-hero request: Collections\/Demo\/Get-User\.api/u);
  assert.equal(presented.length, 1);
});

test('Generate TypeScript remains available after the response panel is closed', async () => {
  const factory = new MockPanelFactory();
  const presented: string[] = [];
  const viewer = new ResponseViewerService(
    factory,
    () => 'nonce',
    {
      copyText: () => undefined,
      saveText: () => undefined,
      presentGeneratedTypeScript: (input) => {
        presented.push(input.code);
      },
    },
  );

  viewer.show(result('{"id":1,"name":"Ada"}'), undefined, undefined, {
    sourceId: 'file:///ws/Collections/Demo/Get-User.api',
    requestKey: 'request:file:///ws/Collections/Demo/Get-User.api#0',
    offset: 12,
  });
  factory.panels[0]!.closeFromUser();
  assert.equal(viewer.canGenerateTypeScript(), true);
  assert.equal(
    viewer.lastExecutionSourceId(),
    'file:///ws/Collections/Demo/Get-User.api',
  );
  assert.equal(viewer.lastExecutionOffset(), 12);

  const code = await viewer.generateTypeScript('User');
  assert.match(code ?? '', /export interface User \{/u);
  assert.equal(presented.length, 1);

  viewer.update(result('{"id":2}'));
  assert.equal(factory.panels.length, 2);
  assert.equal(viewer.canGenerateTypeScript(), true);

  viewer.dispose();
  assert.equal(viewer.canGenerateTypeScript(), false);
  assert.equal(viewer.lastExecutionSourceId(), undefined);
  assert.equal(viewer.lastExecutionOffset(), undefined);
});

test('Generate TypeScript works when JSON is already pretty-printed', async () => {
  const factory = new MockPanelFactory();
  const presented: string[] = [];
  const viewer = new ResponseViewerService(
    factory,
    () => 'nonce',
    {
      copyText: () => undefined,
      saveText: () => undefined,
      presentGeneratedTypeScript: (input) => {
        presented.push(input.code);
      },
    },
  );

  const pretty = JSON.stringify({ id: 1, name: 'Ada' }, undefined, 2);
  viewer.show(result(pretty));
  assert.equal(presentExecutionResult(result(pretty)).body?.prettyAvailable, false);
  assert.equal(viewer.canGenerateTypeScript(), true);
  assert.match(
    factory.panels[0]!.html,
    /<button[^>]*data-action="generateTypeScript"/u,
  );
  const code = await viewer.generateTypeScript('User');
  assert.match(code ?? '', /export interface User \{/u);
  assert.match(code ?? '', /name: string;/u);
  assert.equal(presented.length, 1);
});

test('Generate TypeScript is unavailable for non-JSON bodies', () => {
  const factory = new MockPanelFactory();
  const viewer = new ResponseViewerService(factory, () => 'nonce');
  const plain = result('hello');
  assert.equal(plain.success, true);
  if (!plain.success) {
    return;
  }
  viewer.show({
    ...plain,
    response: {
      ...plain.response,
      contentType: 'text/plain',
      body: {
        bytes: plain.response.body.bytes,
        text: 'hello',
      },
    },
  });
  assert.equal(viewer.canGenerateTypeScript(), false);
  assert.equal(
    /<button[^>]*data-action="generateTypeScript"/u.test(factory.panels[0]!.html),
    false,
  );
});

function deeplyNestedResult(depth: number): ExecutionResult {
  let json: RuntimeJsonValue = { leaf: 'value' };
  for (let index = 0; index < depth; index += 1) {
    json = { nested: json };
  }
  const text = JSON.stringify(json);
  const bytes = freezeDetachedBytes(new TextEncoder().encode(text));
  const timing = Object.freeze({
    startedAt: '2026-07-19T10:00:00.000Z',
    completedAt: '2026-07-19T10:00:00.010Z',
    durationMs: 10,
  });
  return Object.freeze({
    success: true,
    requestId: 'request-1',
    request: Object.freeze({ method: 'GET', url: 'https://example.test' }),
    timing,
    response: Object.freeze({
      requestId: 'request-1',
      statusCode: 200,
      statusText: 'OK',
      headers: Object.freeze([]),
      body: Object.freeze({ bytes, text, json }),
      bodySizeBytes: bytes.byteLength,
      contentType: 'application/json',
      url: 'https://example.test',
      redirected: false,
      redirectCount: 0,
      timing,
    }),
  });
}

test('renders adversarially deep JSON without unbounded recursion or unsafe output', () => {
  // 1000 levels exceeds the tree depth cap while remaining serializable.
  // Pretty expansion of deep trees may hit the preview size cap (pre fallback);
  // either bounded tree or truncated preview proves recursion did not explode.
  const html = renderResponseViewerHtml(
    presentExecutionResult(deeplyNestedResult(1_000)),
    'nonce',
  );

  assert.ok(
    /class="json-tree"/u.test(html) ||
      /Preview truncated/u.test(html) ||
      /truncated|\(…\)/u.test(html),
  );
  assert.equal(html.includes('onerror='), false);
  assert.equal(html.includes('<script>'), false);
  // Bounded output despite deep nesting proves recursion did not explode.
  assert.ok(html.length < 2_000_000);
});

test('renders assertion summary and failures in the viewer HTML', () => {
  const model = presentExecutionResult(result('{"ok":true}'), {
    suite: { assertions: [], requestId: 'request-1' },
    results: [
      {
        outcome: 'passed',
        durationMs: 0,
        assertion: {
          id: 'a1',
          text: 'expect status == 200',
          subject: { kind: 'status' },
          operator: '==',
          expected: 200,
        },
      },
      {
        outcome: 'failed',
        durationMs: 0,
        assertion: {
          id: 'a2',
          text: 'expect body.ok == false',
          subject: { kind: 'body', path: 'ok' },
          operator: '==',
          expected: false,
        },
        failure: {
          assertionText: 'expect body.ok == false',
          reason: 'Assertion failed for operator "==".',
          expected: 'false',
          actual: 'true',
          context: 'body.ok',
        },
      },
    ],
    summary: {
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      malformed: 0,
      durationMs: 1,
      passPercent: 50,
    },
    context: {
      requestId: 'request-1',
      success: true,
      headers: [],
      responseTimeMs: 10,
    },
  });
  const html = renderResponseViewerHtml(model, 'nonce');
  assert.match(html, /data-tab="assertions"/u);
  assert.match(html, /Assertions/u);
  assert.match(html, /1\/2 passed/u);
  assert.match(html, /expect status == 200/u);
  assert.match(html, /expect body\.ok == false/u);
  assert.match(html, /Expected/u);
  assert.equal(html.includes('<script>'), false);
});

test('renders cookies tab only when cookie jar data is available', () => {
  const base = presentExecutionResult(result('{"ok":true}'));
  const withoutJar = renderResponseViewerHtml(base, 'nonce');
  assert.equal(withoutJar.includes('data-tab="cookies"'), false);

  const withJar = renderResponseViewerHtml(
    {
      ...base,
      cookies: {
        available: true,
        setCookieHeaderCount: 1,
        entries: [
          { name: 'session', value: '••••••••', domain: 'example.test', path: '/' },
        ],
      },
    },
    'nonce',
  );
  assert.match(withJar, /data-tab="cookies"/u);
  assert.match(withJar, /session/u);
  assert.match(withJar, /example\.test/u);
});

test('renders extraction chip and Extracted tab; masks sensitive values', () => {
  const model = presentExecutionResult(result('{"ok":true}'), undefined, {
    outcomes: [
      {
        rule: {
          id: 'r1',
          variableName: 'token',
          source: { kind: 'json-path', path: 'body.token' },
          targetScope: 'run',
          sensitive: true,
          required: true,
          enabled: true,
          when: { kind: 'always' },
        },
        kind: 'extracted',
        maskedValue: '••••••••',
        writeOk: true,
      },
    ],
    extractedCount: 1,
    failedCount: 0,
    skippedCount: 0,
    malformedCount: 0,
  });
  const html = renderResponseViewerHtml(model, 'nonce');
  assert.match(html, /data-tab="extraction"/u);
  assert.match(html, /Extracted/u);
  assert.match(html, /token/u);
  assert.match(html, /••••••••/u);
  assert.equal(html.includes('<script>'), false);
});

test('JSON tree exposes path metadata and Create Variable chrome when enabled', () => {
  const model = presentExecutionResult(
    result('{"access_token":"abc","items":[{"id":1}]}'),
  );
  const html = renderResponseViewerHtml(model, 'nonce', {
    enableCreateVariable: true,
    knownVariableNames: ['token'],
  });
  assert.match(html, /data-json-path="body\.access_token"/u);
  assert.match(html, /data-json-value="abc"/u);
  assert.match(html, /data-json-type="string"/u);
  assert.match(html, /data-json-extractable="true"/u);
  assert.match(html, /data-json-path="body\.items\[0\]\.id"/u);
  assert.match(html, /Save as Variable/u);
  assert.match(html, /Extract Variable/u);
  assert.match(html, /Save Extract Rule/u);
  assert.match(html, /jsonContextMenu/u);
  assert.match(html, /createVariableSheet/u);
  assert.match(html, /data-enable-create-variable="true"/u);
});

test('Detected Authentication renders multiple useAsAuth CTAs and binds all of them', () => {
  const model = presentExecutionResult(
    result('{"access_token":"abc"}'),
  );
  const html = renderResponseViewerHtml(model, 'nonce', {
    enableCreateVariable: true,
    detectedAuthTokenCount: 1,
  });
  const useAsAuthButtons =
    html.match(/<button\b[^>]*\bdata-action="useAsAuth"/gu) ?? [];
  assert.equal(useAsAuthButtons.length, 2);
  assert.match(html, /Detected Authentication/u);
  assert.match(html, /Create Session \/ Use as Authentication/u);
  assert.match(
    html,
    /querySelectorAll\('\[data-action="useAsAuth"\]'\)/u,
  );
});

test('JSON tree marks non-identifier keys as non-extractable', () => {
  const model = presentExecutionResult(result('{"invalid key":"x","ok":1}'));
  const html = renderResponseViewerHtml(model, 'nonce', {
    enableCreateVariable: true,
  });
  assert.match(html, /data-json-path="body\.invalid key"[^>]*data-json-extractable="false"/u);
  assert.match(html, /data-json-path="body\.ok"[^>]*data-json-extractable="true"/u);
});

test('parseResponseViewerMessage accepts createVariable, copyText, and copyJsonPathValue', () => {
  assert.deepEqual(
    parseResponseViewerMessage({
      type: 'createVariable',
      name: 'token',
      path: 'body.access_token',
      scope: 'environment',
      sensitive: true,
    }),
    {
      type: 'createVariable',
      name: 'token',
      path: 'body.access_token',
      scope: 'environment',
      sensitive: true,
    },
  );
  assert.deepEqual(
    parseResponseViewerMessage({ type: 'copyText', text: 'body.id' }),
    { type: 'copyText', text: 'body.id' },
  );
  assert.deepEqual(
    parseResponseViewerMessage({
      type: 'copyJsonPathValue',
      path: 'body.access_token',
    }),
    { type: 'copyJsonPathValue', path: 'body.access_token' },
  );
  assert.equal(
    parseResponseViewerMessage({
      type: 'createVariable',
      name: 'token',
      path: 'body.x',
      scope: 'global',
      sensitive: false,
    }),
    undefined,
  );
});

test('copyJsonPathValue resolves from lastResult; createVariable notifies on validation failure', async () => {
  const factory = new MockPanelFactory();
  const copied: string[] = [];
  const errors: string[] = [];
  const viewer = new ResponseViewerService(
    factory,
    () => 'nonce',
    {
      copyText: (text) => {
        copied.push(text);
      },
      saveText: () => undefined,
      notifyCreateVariableError: (message) => {
        errors.push(message);
      },
    },
  );

  viewer.show(
    result('{"access_token":"secret-value"}'),
    undefined,
    undefined,
    {
      sourceId: 'file:///ws/a.api',
      requestKey: 'request:file:///ws/a.api#0',
      offset: 0,
    },
  );
  const panel = factory.panels[0]!;

  await panel.emitMessage({
    type: 'copyJsonPathValue',
    path: 'body.access_token',
  });
  assert.deepEqual(copied, ['secret-value']);

  await panel.emitMessage({
    type: 'createVariable',
    name: '!!bad',
    path: 'body.access_token',
    scope: 'environment',
    sensitive: false,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /invalid variable name/iu);
});

test('resolveCreateVariableValue resolves array-root bodies (body[0], body[0].id)', () => {
  const arrayResult = result('[{"id":"x"}]');
  assert.equal(resolveCreateVariableValue(arrayResult, 'body[0].id'), 'x');
  assert.equal(
    resolveCreateVariableValue(arrayResult, 'body[0]'),
    undefined, // object values are not extractable scalars
  );
});

test('createVariable and copyJsonPathValue succeed for array-root body paths', async () => {
  const factory = new MockPanelFactory();
  const copied: string[] = [];
  const errors: string[] = [];
  const created: unknown[] = [];
  const viewer = new ResponseViewerService(
    factory,
    () => 'nonce',
    {
      copyText: (text) => {
        copied.push(text);
      },
      saveText: () => undefined,
      notifyCreateVariableError: (message) => {
        errors.push(message);
      },
      createVariableFromResponse: async (input) => {
        created.push(input);
      },
    },
  );

  viewer.show(result('[{"id":"x"}]'), undefined, undefined, {
    sourceId: 'file:///ws/a.api',
    requestKey: 'request:file:///ws/a.api#0',
    offset: 0,
  });
  const panel = factory.panels[0]!;

  await panel.emitMessage({ type: 'copyJsonPathValue', path: 'body[0].id' });
  assert.deepEqual(copied, ['x']);

  await panel.emitMessage({
    type: 'createVariable',
    name: 'itemId',
    path: 'body[0].id',
    scope: 'environment',
    sensitive: false,
  });
  assert.equal(errors.length, 0);
  assert.equal(created.length, 1);
});

test('showDiff clears execution bindings so actions cannot target a stale result', async () => {
  const factory = new MockPanelFactory();
  const copied: string[] = [];
  const errors: string[] = [];
  const authBodies: unknown[] = [];
  const viewer = new ResponseViewerService(
    factory,
    () => 'nonce',
    {
      copyText: (text) => {
        copied.push(text);
      },
      saveText: () => undefined,
      notifyCreateVariableError: (message) => {
        errors.push(message);
      },
      useResponseAsAuthentication: (body) => {
        authBodies.push(body);
      },
    },
  );

  viewer.show(
    result('{"access_token":"stale-secret","id":1}'),
    undefined,
    undefined,
    {
      sourceId: 'file:///ws/a.api',
      requestKey: 'request:file:///ws/a.api#0',
      offset: 0,
    },
  );
  const panel = factory.panels[0]!;
  assert.match(panel.html, /data-enable-create-variable="true"/u);
  assert.match(panel.html, /Detected Authentication/u);

  const left = presentExecutionResult(result('{"run":"a"}'));
  const right = presentExecutionResult(result('{"run":"b"}'));
  viewer.showDiff(left, right, { leftLabel: 'Run A', rightLabel: 'Run B' });

  assert.match(panel.html, /data-enable-create-variable="false"/u);
  assert.equal(panel.html.includes('Detected Authentication'), false);
  assert.match(panel.html, /Run A|Run B|diff/iu);

  await panel.emitMessage({
    type: 'copyJsonPathValue',
    path: 'body.access_token',
  });
  assert.deepEqual(copied, []);

  await panel.emitMessage({
    type: 'createVariable',
    name: 'token',
    path: 'body.access_token',
    scope: 'environment',
    sensitive: true,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /no active response context/iu);

  await panel.emitMessage({ type: 'useAsAuthentication' });
  assert.equal(authBodies.length, 0);
  assert.equal(errors.length, 2);
  assert.match(errors[1]!, /no successful response body/iu);
});

test('getKnownVariableNames throw does not block opening the response panel', () => {
  const factory = new MockPanelFactory();
  const viewer = new ResponseViewerService(
    factory,
    () => 'nonce',
    {
      copyText: () => undefined,
      saveText: () => undefined,
    },
    {
      getKnownVariableNames: () => {
        throw new Error('lookup failed');
      },
    },
  );

  viewer.show(
    result('{"id":1}'),
    undefined,
    undefined,
    {
      sourceId: 'file:///ws/a.api',
      requestKey: 'request:file:///ws/a.api#0',
      offset: 0,
    },
  );
  assert.equal(factory.panels.length, 1);
  assert.match(factory.panels[0]!.html, /data-json-path="body\.id"/u);
  assert.match(factory.panels[0]!.html, /data-enable-create-variable="true"/u);
});

function withGraphql(
  body: string,
  graphql: GraphqlEnvelopeSummary,
): ExecutionResult {
  const base = result(body);
  assert.equal(base.success, true);
  return { ...base, graphql };
}

test('GraphQL 200 with errors renders a dedicated errors card', () => {
  const html = renderResponseViewerHtml(
    presentExecutionResult(
      withGraphql('{"errors":[{"message":"Cannot query field \\"foo\\""}]}', {
        validEnvelope: true,
        hasData: false,
        hasErrors: true,
        errorCount: 1,
        errorMessages: ['Cannot query field "foo"'],
      }),
    ),
    'nonce',
  );
  assert.match(html, /data-testid="graphql-errors"/u);
  assert.match(html, /Cannot query field &quot;foo&quot;/u);
  assert.match(html, /GraphQL Errors \(1\)/u);
  assert.match(html, /class="graphql-errors-card"/u);
});

test('GraphQL errors card does not echo raw secrets from pre-scrubbed messages', () => {
  const html = renderResponseViewerHtml(
    presentExecutionResult(
      withGraphql('{"errors":[{"message":"Unauthorized"}]}', {
        validEnvelope: true,
        hasData: false,
        hasErrors: true,
        errorCount: 1,
        errorMessages: ['Unauthorized Bearer ••••••••'],
      }),
    ),
    'nonce',
  );
  assert.match(html, /data-testid="graphql-errors"/u);
  assert.match(html, /Unauthorized Bearer ••••••••/u);
  assert.doesNotMatch(html, /sekrit-token-value/u);
  assert.doesNotMatch(html, /live-secret/u);
});

test('GraphQL success without errors does not show the errors card', () => {
  const html = renderResponseViewerHtml(
    presentExecutionResult(
      withGraphql('{"data":{"user":{"name":"Ada"}}}', {
        validEnvelope: true,
        hasData: true,
        hasErrors: false,
        errorCount: 0,
        errorMessages: [],
      }),
    ),
    'nonce',
  );
  assert.doesNotMatch(html, /data-testid="graphql-errors"/u);
  assert.doesNotMatch(html, /GraphQL Errors/u);
  assert.doesNotMatch(html, /Invalid GraphQL response/u);
});

test('invalid GraphQL envelope shows Invalid GraphQL response', () => {
  const html = renderResponseViewerHtml(
    presentExecutionResult(
      withGraphql('{"errors":"nope"}', {
        validEnvelope: false,
        hasData: false,
        hasErrors: false,
        errorCount: 0,
        errorMessages: [],
      }),
    ),
    'nonce',
  );
  assert.match(html, /data-testid="graphql-errors"/u);
  assert.match(html, /Invalid GraphQL response/u);
});

test('REST responses do not render GraphQL error chrome', () => {
  const html = renderResponseViewerHtml(
    presentExecutionResult(result('{"value":1}')),
    'nonce',
  );
  assert.doesNotMatch(html, /data-testid="graphql-errors"/u);
  assert.doesNotMatch(html, /GraphQL Errors \(/u);
  assert.doesNotMatch(html, /Invalid GraphQL response/u);
});
