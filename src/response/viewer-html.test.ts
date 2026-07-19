import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ExecutionResult } from '../execution';
import type { RuntimeJsonValue } from '../models/request';
import { freezeDetachedBytes } from '../shared';
import { presentExecutionResult } from './presentation';
import {
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
        json: Object.freeze({ value: '<img src=x onerror=alert(1)>' }),
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
  for (const value of [
    null,
    'ready',
    { type: 'ready', payload: true },
    { type: 'reveal-secret' },
    { command: 'ready' },
    ['ready'],
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
  private messageListeners = new Set<(message: unknown) => void>();

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
    listener: (message: unknown) => void,
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
  // 1000 levels exceeds the tree depth cap while remaining serializable, so
  // the bounded serialized preview leaf is exercised deterministically.
  const html = renderResponseViewerHtml(
    presentExecutionResult(deeplyNestedResult(1_000)),
    'nonce',
  );

  assert.match(html, /class="json-tree"/u);
  assert.match(html, /truncated|\(…\)/u);
  assert.equal(html.includes('onerror='), false);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /data-json-action="expand"/u);
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
  assert.match(html, /Assertions/u);
  assert.match(html, /1\/2 passed/u);
  assert.match(html, /expect status == 200/u);
  assert.match(html, /expect body\.ok == false/u);
  assert.match(html, /Expected/u);
  assert.equal(html.includes('<script>'), false);
});
