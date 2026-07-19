import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { LANGUAGE_DIAGNOSTIC_CODES } from '../constants';
import { analyzeApiLines } from './line-analysis';

/**
 * Deprecated lightweight line analysis — superseded by the runtime parser
 * adapter. Suite retained for reference; skipped so it does not maintain
 * false confidence against the active language pipeline.
 */
describe(
  'line-analysis (deprecated)',
  {
    skip: 'Replaced by runtime-parser-adapter; retained for historical reference only.',
  },
  () => {
    test('finds requests and uses a nearby name for the outline', () => {
      const analysis = analyzeApiLines([
        '@name List users',
        '@tag users',
        'GET https://api.example.com/users',
        'Accept: application/json',
        '',
        '###',
        'POST /users',
        '@name Create user',
        '',
        '{',
        '  "active": true',
        '}',
      ]);

      assert.deepEqual(
        analysis.requests.map(({ method, url, name }) => ({ method, url, name })),
        [
          {
            method: 'GET',
            url: 'https://api.example.com/users',
            name: 'List users',
          },
          { method: 'POST', url: '/users', name: 'Create user' },
        ],
      );
      assert.ok(analysis.folds.some((fold) => fold.kind === 'request'));
      assert.ok(analysis.folds.some((fold) => fold.kind === 'directives'));
      assert.ok(analysis.folds.some((fold) => fold.kind === 'json'));
    });

    test('reports lightweight request and directive diagnostics', () => {
      const analysis = analyzeApiLines([
        '@name First',
        '@name Second',
        '@timeout later',
        '@unknown value',
        'FETCH https://api.example.com/users',
        'GET',
      ]);

      assert.deepEqual(
        analysis.diagnostics.map((diagnostic) => diagnostic.code),
        [
          LANGUAGE_DIAGNOSTIC_CODES.duplicateDirective,
          LANGUAGE_DIAGNOSTIC_CODES.invalidDirective,
          LANGUAGE_DIAGNOSTIC_CODES.invalidDirective,
          LANGUAGE_DIAGNOSTIC_CODES.unknownMethod,
          LANGUAGE_DIAGNOSTIC_CODES.missingUrl,
        ],
      );
    });

    test('allows repeated tags and resets metadata at request boundaries', () => {
      const analysis = analyzeApiLines([
        '@tag smoke',
        '@tag regression',
        '@name First',
        'GET /first',
        '@name Second',
        'GET /second',
        '###',
        '@name Third',
        'GET /third',
      ]);

      assert.equal(analysis.diagnostics.length, 0);
    });

    test('ignores comments, headers, and JSON values', () => {
      const analysis = analyzeApiLines([
        '# GET',
        '// POST /ignored',
        'Content-Type: application/json',
        '{',
        '  "enabled": true',
        '}',
      ]);

      assert.equal(analysis.requests.length, 0);
      assert.equal(analysis.diagnostics.length, 0);
    });

    test('does not let comments or unmatched quotes corrupt later JSON folds', () => {
      const analysis = analyzeApiLines([
        '// A comment with { and "',
        'Authorization: Bearer "unterminated',
        '{',
        '  "enabled": true',
        '}',
      ]);

      assert.deepEqual(
        analysis.folds.filter((fold) => fold.kind === 'json'),
        [{ startLine: 2, endLine: 4, kind: 'json' }],
      );
    });

    test('keeps JSON folding within request boundaries', () => {
      const analysis = analyzeApiLines([
        'GET /first',
        'X-Template: {',
        '{',
        '  "incomplete": true',
        '###',
        'POST /second',
        '{',
        '  "complete": true',
        '}',
      ]);

      assert.deepEqual(
        analysis.folds.filter((fold) => fold.kind === 'json'),
        [{ startLine: 6, endLine: 8, kind: 'json' }],
      );
    });
  },
);
