/**
 * Unit tests for apihero argv parsing.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCliArgs } from './parse-args';

describe('parseCliArgs', () => {
  test('root help', () => {
    assert.equal(parseCliArgs([]).kind, 'help');
    assert.equal(parseCliArgs(['--help']).kind, 'help');
    assert.equal(parseCliArgs(['-h']).kind, 'help');
  });

  test('version', () => {
    assert.equal(parseCliArgs(['--version']).kind, 'version');
    assert.equal(parseCliArgs(['-V']).kind, 'version');
  });

  test('run help', () => {
    assert.equal(parseCliArgs(['run', '--help']).kind, 'run-help');
    assert.equal(parseCliArgs(['run', '-h']).kind, 'run-help');
  });

  test('run request / collection / scenario', () => {
    const request = parseCliArgs(['run', 'request', 'hello.api']);
    assert.equal(request.kind, 'run');
    if (request.kind !== 'run') return;
    assert.equal(request.targetType, 'request');
    assert.equal(request.target, 'hello.api');
    assert.equal(request.json, false);

    const collection = parseCliArgs([
      'run',
      'collection',
      'Demo',
      '--workspace',
      '/tmp/ws',
      '--json',
      '--quiet',
      '--verbose',
      '--environment',
      'staging',
    ]);
    assert.equal(collection.kind, 'run');
    if (collection.kind !== 'run') return;
    assert.equal(collection.targetType, 'collection');
    assert.equal(collection.target, 'Demo');
    assert.equal(collection.workspace, '/tmp/ws');
    assert.equal(collection.environment, 'staging');
    assert.equal(collection.json, true);
    assert.equal(collection.quiet, true);
    assert.equal(collection.verbose, true);

    const scenario = parseCliArgs([
      'run',
      'scenario',
      'checkout',
      '--workspace=/ws',
      '--environment=prod',
    ]);
    assert.equal(scenario.kind, 'run');
    if (scenario.kind !== 'run') return;
    assert.equal(scenario.targetType, 'scenario');
    assert.equal(scenario.workspace, '/ws');
    assert.equal(scenario.environment, 'prod');
  });

  test('missing target and unknown option → error', () => {
    const missing = parseCliArgs(['run', 'request']);
    assert.equal(missing.kind, 'error');

    const unknownType = parseCliArgs(['run', 'folder', 'x']);
    assert.equal(unknownType.kind, 'error');

    const unknownOpt = parseCliArgs(['run', 'request', 'x', '--wat']);
    assert.equal(unknownOpt.kind, 'error');
    if (unknownOpt.kind === 'error') {
      assert.match(unknownOpt.message, /Unknown option/);
    }

    const badCommand = parseCliArgs(['list']);
    assert.equal(badCommand.kind, 'error');
  });
});
