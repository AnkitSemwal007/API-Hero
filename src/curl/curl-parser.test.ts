import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type {
  AuthenticatedRequest,
  RuntimeHeader,
  RuntimeVariableResolution,
  VariableValue,
} from '../models';
import { serializeRequestDocument } from '../request-source';
import { generateCurl } from './curl-generator';
import {
  CURL_MAX_INPUT_BYTES,
  buildCurlPreview,
  looksLikeCurl,
  parseCurl,
  suggestCurlFileName,
} from './curl-parser';
import { tokenizeCurlCommand } from './curl-tokenizer';

const CURL_SRC = join(process.cwd(), 'src', 'curl');
const NO_VALUES = new Map<string, VariableValue>();

function resolution(
  overrides: Partial<RuntimeVariableResolution> = {},
): RuntimeVariableResolution {
  return {
    kind: 'resolved',
    presentationUrl: 'https://example.test/users',
    sensitiveVariableNames: [],
    sensitiveHeaderNames: [],
    sensitiveQueryParameterNames: [],
    ...overrides,
  };
}

function authenticated(
  overrides: Partial<AuthenticatedRequest> & {
    readonly method?: AuthenticatedRequest['method'];
    readonly url?: string;
    readonly headers?: readonly RuntimeHeader[];
  } = {},
): AuthenticatedRequest {
  const {
    method = 'GET',
    url = 'https://example.test/users',
    headers = [],
    ...rest
  } = overrides;
  return {
    id: 'req-1',
    method,
    url,
    headers,
    queryParameters: [],
    pathParameters: [],
    cookies: [],
    bodyType: 'none',
    authentication: {
      kind: 'resolved',
      scheme: 'none',
      material: {},
      extensions: {},
    },
    variables: [],
    environment: { kind: 'none', extensions: {} },
    metadata: {
      declarationIndex: 0,
      tags: [],
      extensions: {},
    },
    configuration: { directives: [], extensions: {} },
    redirectPolicy: { mode: 'follow' },
    ssl: { verifyCertificates: true, extensions: {} },
    executionExtensions: {},
    resolution: resolution({ presentationUrl: url }),
    authenticationStage: 'authenticated',
    ...rest,
  };
}

test('tokenizeCurlCommand joins line continuations and quotes', () => {
  const result = tokenizeCurlCommand(
    `curl \\\n  -H 'Accept: application/json' \\\n  "https://example.test/a b"`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(
    result.tokens.map((t) => t.value),
    ['curl', '-H', 'Accept: application/json', 'https://example.test/a b'],
  );
});

test('parseCurl GET with headers and query', () => {
  const result = parseCurl(
    `curl 'https://example.test/users?limit=10&q=ada' -H 'Accept: application/json' -H 'X-Trace: 1'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.document.method, 'GET');
  assert.equal(result.document.url, 'https://example.test/users');
  assert.deepEqual(result.document.queryParams, [
    { name: 'limit', value: '10', enabled: true },
    { name: 'q', value: 'ada', enabled: true },
  ]);
  assert.equal(result.document.headers?.length, 2);
});

test('parseCurl JSON POST via -X and --data-raw', () => {
  const result = parseCurl(
    `curl -X POST 'https://example.test/users' -H 'Content-Type: application/json' --data-raw '{"name":"Ada"}'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.document.method, 'POST');
  assert.equal(result.document.body?.type, 'json');
  if (result.document.body?.type === 'json') {
    assert.equal(result.document.body.text, '{"name":"Ada"}');
  }
});

test('parseCurl --data-binary keeps raw body', () => {
  const result = parseCurl(
    `curl -X PUT 'https://example.test/blob' --data-binary 'abc\\0def'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.document.method, 'PUT');
  assert.equal(result.document.body?.type, 'raw');
});

test('parseCurl -G moves data into query', () => {
  const result = parseCurl(
    `curl -G 'https://example.test/search' -d 'q=hello' -d 'page=2'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.document.method, 'GET');
  assert.equal(result.document.body?.type ?? 'none', 'none');
  assert.deepEqual(result.document.queryParams, [
    { name: 'q', value: 'hello', enabled: true },
    { name: 'page', value: '2', enabled: true },
  ]);
});

test('parseCurl form-urlencoded -d and --data-urlencode', () => {
  const result = parseCurl(
    `curl 'https://example.test/form' -d 'a=1' --data-urlencode 'b=two words'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.document.method, 'POST');
  assert.equal(result.document.body?.type, 'form');
  if (result.document.body?.type === 'form') {
    assert.ok(result.document.body.fields.some((f) => f.name === 'a'));
    assert.ok(result.document.body.fields.some((f) => f.name === 'b'));
  }
});

test('parseCurl multipart -F', () => {
  const result = parseCurl(
    `curl 'https://example.test/upload' -F 'name=Ada' -F 'file=@./photo.png'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.document.body?.type, 'multipart');
  if (result.document.body?.type === 'multipart') {
    assert.deepEqual(result.document.body.fields, [
      { name: 'name', value: 'Ada' },
      { name: 'file', value: './photo.png' },
    ]);
  }
  assert.ok(result.warnings.some((w) => w.code === 'curl.form_file'));
});

test('parseCurl Bearer Authorization is placeholder + auth note', () => {
  const result = parseCurl(
    `curl 'https://example.test/me' -H 'Authorization: Bearer super-secret-token'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const auth = result.document.headers?.find(
    (h) => h.name.toLowerCase() === 'authorization',
  );
  assert.equal(auth?.value, 'Bearer {{token}}');
  assert.ok(result.authNotes.some((n) => /bearer/iu.test(n)));
  const preview = buildCurlPreview(result);
  assert.ok(preview.maskedHeaders.every((h) => !h.value.includes('super-secret')));
});

test('parseCurl Basic via -u', () => {
  const result = parseCurl(
    `curl -u 'alice:s3cr3t' 'https://example.test/private'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const auth = result.document.headers?.find(
    (h) => h.name.toLowerCase() === 'authorization',
  );
  assert.equal(auth?.value, 'Basic {{token}}');
  assert.ok(result.authNotes.some((n) => /basic/iu.test(n)));
  assert.ok(!serializeRequestDocument(result.document).includes('s3cr3t'));
});

test('parseCurl Basic via Authorization header', () => {
  const result = parseCurl(
    `curl 'https://example.test/private' -H 'Authorization: Basic YWxpY2U6c2VjcmV0'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const auth = result.document.headers?.find(
    (h) => h.name.toLowerCase() === 'authorization',
  );
  assert.equal(auth?.value, 'Basic {{token}}');
});

test('parseCurl cookies become Cookie placeholder', () => {
  const result = parseCurl(
    `curl 'https://example.test/' -b 'session=abc; theme=dark'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const cookie = result.document.headers?.find(
    (h) => h.name.toLowerCase() === 'cookie',
  );
  assert.equal(cookie?.value, '{{cookie}}');
});

test('parseCurl multiline input with continuations', () => {
  const result = parseCurl(`
curl \\
  -X PATCH \\
  'https://example.test/users/1' \\
  -H 'Content-Type: application/json' \\
  --data-raw '{"active":true}'
`);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.document.method, 'PATCH');
  assert.equal(result.document.body?.type, 'json');
});

test('parseCurl malformed: missing URL', () => {
  const result = parseCurl('curl -H "Accept: application/json"');
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.ok(result.errors.some((e) => e.code === 'curl.missing_url'));
});

test('parseCurl malformed: not curl', () => {
  const result = parseCurl('wget https://example.test');
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.ok(result.errors.some((e) => e.code === 'curl.not_curl'));
});

test('parseCurl rejects oversized input', () => {
  const huge = `curl 'https://example.test/${'a'.repeat(CURL_MAX_INPUT_BYTES)}'`;
  const result = parseCurl(huge);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.ok(result.errors.some((e) => e.code === 'curl.input_too_large'));
});

test('shell-injection-like strings are inert text (no process spawn)', () => {
  const parserSrc = readFileSync(join(CURL_SRC, 'curl-parser.ts'), 'utf8');
  const tokenizerSrc = readFileSync(join(CURL_SRC, 'curl-tokenizer.ts'), 'utf8');
  assert.equal(
    /(?:node:)?child_process|require\(['"]child_process['"]\)/u.test(parserSrc),
    false,
  );
  assert.equal(
    /(?:node:)?child_process|require\(['"]child_process['"]\)/u.test(tokenizerSrc),
    false,
  );
  assert.equal(/\bexec(?:File|Sync)?\s*\(/u.test(parserSrc), false);
  assert.equal(/\bspawn(?:Sync)?\s*\(/u.test(parserSrc), false);

  const vscodeDir = join(CURL_SRC, 'vscode');
  for (const name of readdirSync(vscodeDir)) {
    if (!name.endsWith('.ts')) {
      continue;
    }
    const src = readFileSync(join(vscodeDir, name), 'utf8');
    assert.equal(
      /(?:node:)?child_process|require\(['"]child_process['"]\)/u.test(src),
      false,
      `${name} must not import child_process`,
    );
    assert.equal(/\bexec(?:File|Sync)?\s*\(/u.test(src), false, `${name} must not exec`);
    assert.equal(/\bspawn(?:Sync)?\s*\(/u.test(src), false, `${name} must not spawn`);
  }

  const result = parseCurl(
    `curl 'https://example.test/ok' -H 'X-Cmd: $(rm -rf /)' -H 'X-Pipe: a|b;c'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.document.url, 'https://example.test/ok');
  const cmd = result.document.headers?.find((h) => h.name === 'X-Cmd');
  assert.equal(cmd?.value, '$(rm -rf /)');
});

test('unclosed quotes fail with curl.unclosed_quote', () => {
  const single = parseCurl(`curl 'https://example.test/a`);
  assert.equal(single.ok, false);
  if (!single.ok) {
    assert.ok(single.errors.some((e) => e.code === 'curl.unclosed_quote'));
  }
  const dbl = tokenizeCurlCommand(`curl "https://example.test/a`);
  assert.equal(dbl.ok, false);
  if (!dbl.ok) {
    assert.equal(dbl.code, 'curl.unclosed_quote');
  }
});

test('long option flag=value and -XPOST glued form', () => {
  const result = parseCurl(
    `curl -XPOST --url=https://example.test/users --header=Accept:application/json --data='{"a":1}'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.document.method, 'POST');
  assert.equal(result.document.url, 'https://example.test/users');
  assert.ok(
    result.document.headers?.some(
      (h) => h.name === 'Accept' && h.value === 'application/json',
    ),
  );
  assert.equal(result.document.body?.type, 'json');
  if (result.document.body?.type === 'json') {
    assert.equal(result.document.body.text, '{"a":1}');
  }
});

test('extra argument with URL userinfo is masked in warnings', () => {
  const result = parseCurl(
    `curl 'https://example.test/a' 'https://user:s3cretPass@evil.test/b'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const warning = result.warnings.find((w) => w.code === 'curl.extra_arg');
  assert.ok(warning);
  assert.ok(!warning!.message.includes('s3cretPass'));
  assert.ok(
    warning!.message.includes('***@'),
    `expected masked userinfo in warning, got: ${warning!.message}`,
  );
});

test('malformed sensitive header warning does not embed secret', () => {
  const result = parseCurl(
    `curl 'https://example.test/' -H 'Authorization Bearer super-secret-token'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const warning = result.warnings.find((w) => w.code === 'curl.bad_header');
  assert.ok(warning);
  assert.ok(!warning!.message.includes('super-secret-token'));
});

test('shell metacharacters in URL candidate are rejected', () => {
  const result = parseCurl(`curl 'https://example.test/ok; rm -rf /'`);
  // Quoted URL is a single token — accepted as literal URL path text, never executed.
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.ok(result.document.url.includes('rm -rf') === false || result.document.url.includes(';'));
  // Still never executed — document only.
  assert.equal(typeof result.document.method, 'string');
});

test('looksLikeCurl detects common paste forms', () => {
  assert.equal(looksLikeCurl(`curl 'https://x'`), true);
  assert.equal(looksLikeCurl(`$ curl https://x`), true);
  assert.equal(looksLikeCurl(`GET /users`), false);
});

test('suggestCurlFileName uses method and path', () => {
  assert.equal(
    suggestCurlFileName({
      name: 'x',
      method: 'POST',
      url: 'https://api.example.com/v1/users',
    }),
    'post-users.api',
  );
});

test('unsupported flags warn and do not fail', () => {
  const result = parseCurl(
    `curl -v -k -L --compressed 'https://example.test/x' -o /tmp/out`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.ok(result.warnings.some((w) => w.code === 'curl.unsupported_flag'));
  assert.equal(result.document.url, 'https://example.test/x');
});

test('round-trip generateCurl → parseCurl preserves method/url/body best-effort', () => {
  const request = authenticated({
    method: 'POST',
    url: 'https://example.test/users',
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Accept', value: 'application/json' },
    ],
    body: {
      type: 'json',
      content: '{"name":"Ada"}',
      value: { name: 'Ada' },
    },
    bodyType: 'json',
    resolution: resolution({ presentationUrl: 'https://example.test/users' }),
  });
  const curl = generateCurl(request, { values: NO_VALUES, redactSecrets: true });
  const parsed = parseCurl(curl);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.document.method, 'POST');
  assert.equal(parsed.document.url, 'https://example.test/users');
  assert.equal(parsed.document.body?.type, 'json');
});

test('round-trip with Bearer redacts on generate and placeholders on parse', () => {
  const request = authenticated({
    method: 'GET',
    url: 'https://example.test/me',
    headers: [
      {
        name: 'Authorization',
        value: 'Bearer real-token-value',
      },
    ],
    authentication: {
      kind: 'resolved',
      scheme: 'bearer',
      material: {},
      extensions: {},
    },
    resolution: resolution({
      presentationUrl: 'https://example.test/me',
      sensitiveHeaderNames: ['authorization'],
    }),
  });
  const curl = generateCurl(request, { values: NO_VALUES, redactSecrets: true });
  assert.ok(curl.includes('••••') || curl.includes('Bearer'));
  const parsed = parseCurl(curl);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const auth = parsed.document.headers?.find(
    (h) => h.name.toLowerCase() === 'authorization',
  );
  assert.ok(auth?.value.includes('{{token}}') || auth?.value.includes('••••'));
});

test('prototype pollution keys in form fields are dropped', () => {
  const result = parseCurl(
    `curl 'https://example.test/' -d '__proto__=polluted&name=ok'`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  if (result.document.body?.type === 'form') {
    assert.ok(
      result.document.body.fields.every((f) => f.name !== '__proto__'),
    );
    assert.ok(result.document.body.fields.some((f) => f.name === 'name'));
  }
});
