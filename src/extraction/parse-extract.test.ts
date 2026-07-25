import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseExtractDirective } from './parse-extract';

describe('parseExtractDirective', () => {
  test('applies ADR defaults for a body path extract', () => {
    const result = parseExtractDirective({
      knownName: 'extract',
      value: 'accessToken from body.access_token',
      id: 'rule_1',
      sourceText: '@extract accessToken from body.access_token',
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.rule.id, 'rule_1');
    assert.equal(result.rule.variableName, 'accessToken');
    assert.deepEqual(result.rule.source, {
      kind: 'json-path',
      path: 'body.access_token',
    });
    assert.equal(result.rule.targetScope, 'run');
    assert.equal(result.rule.sensitive, false);
    assert.equal(result.rule.required, true);
    assert.equal(result.rule.enabled, true);
    assert.deepEqual(result.rule.when, { kind: 'always' });
    assert.equal(
      result.rule.sourceText,
      '@extract accessToken from body.access_token',
    );
  });

  test('marks sensitive-extract as sensitive by default', () => {
    const result = parseExtractDirective({
      knownName: 'sensitive-extract',
      value: 'refreshToken from body.refresh_token scope=environment',
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.rule.sensitive, true);
    assert.equal(result.rule.targetScope, 'environment');
  });

  test('parses optional, scope, when, header, and status sources', () => {
    const optional = parseExtractDirective({
      knownName: 'extract',
      value: 'productId from body.data[0].id scope=document optional',
    });
    assert.equal(optional.ok, true);
    if (optional.ok) {
      assert.equal(optional.rule.required, false);
      assert.equal(optional.rule.targetScope, 'document');
      assert.deepEqual(optional.rule.source, {
        kind: 'json-path',
        path: 'body.data[0].id',
      });
    }

    const header = parseExtractDirective({
      knownName: 'extract',
      value: 'requestId from header X-Request-Id when=status:2xx',
    });
    assert.equal(header.ok, true);
    if (header.ok) {
      assert.deepEqual(header.rule.source, {
        kind: 'header',
        name: 'X-Request-Id',
      });
      assert.deepEqual(header.rule.when, { kind: 'status', spec: '2xx' });
    }

    const status = parseExtractDirective({
      knownName: 'extract',
      value: 'code from status',
    });
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.deepEqual(status.rule.source, { kind: 'status' });
    }

    const assertionsWhen = parseExtractDirective({
      knownName: 'extract',
      value: 'ok from body.ok when=assertions:pass',
    });
    assert.equal(assertionsWhen.ok, true);
    if (assertionsWhen.ok) {
      assert.deepEqual(assertionsWhen.rule.when, { kind: 'assertions-pass' });
    }

    const contentType = parseExtractDirective({
      knownName: 'extract',
      value: 'payload from body.data when=content-type:application/json',
    });
    assert.equal(contentType.ok, true);
    if (contentType.ok) {
      assert.deepEqual(contentType.rule.when, {
        kind: 'content-type',
        mime: 'application/json',
      });
    }

    const sensitiveOption = parseExtractDirective({
      knownName: 'extract',
      value: 'secret from body.secret sensitive',
    });
    assert.equal(sensitiveOption.ok, true);
    if (sensitiveOption.ok) {
      assert.equal(sensitiveOption.rule.sensitive, true);
    }
  });

  test('rejects invalid names, sources, and scopes', () => {
    assert.equal(
      parseExtractDirective({ knownName: 'extract', value: '' }).ok,
      false,
    );
    assert.equal(
      parseExtractDirective({
        knownName: 'extract',
        value: '1bad from body.x',
      }).ok,
      false,
    );
    assert.equal(
      parseExtractDirective({
        knownName: 'extract',
        value: 'token body.access_token',
      }).ok,
      false,
    );

    const emptyPath = parseExtractDirective({
      knownName: 'extract',
      value: 'x from body.',
    });
    assert.equal(emptyPath.ok, false);
    if (!emptyPath.ok) {
      assert.match(emptyPath.reason, /invalid-source/u);
    }

    const emptyHeader = parseExtractDirective({
      knownName: 'extract',
      value: 'x from header',
    });
    assert.equal(emptyHeader.ok, false);
    if (!emptyHeader.ok) {
      assert.match(emptyHeader.reason, /invalid-source/u);
    }

    const forbidden = parseExtractDirective({
      knownName: 'extract',
      value: 'x from body.y scope=global',
    });
    assert.equal(forbidden.ok, false);
    if (!forbidden.ok) {
      assert.match(forbidden.reason, /forbidden-scope/u);
    }

    const invalidScope = parseExtractDirective({
      knownName: 'extract',
      value: 'x from body.y scope=planet',
    });
    assert.equal(invalidScope.ok, false);
    if (!invalidScope.ok) {
      assert.match(invalidScope.reason, /invalid-scope/u);
    }
  });
});
