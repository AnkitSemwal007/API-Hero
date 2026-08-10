/**
 * Unit tests for MCP workspace CLI parsing and resolve priority.
 * Pure functions only — no live HTTP or filesystem discovery.
 */

import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, test } from 'node:test';

import { resolveMcpWorkspaceRoot } from './composition';
import { parseWorkspaceCliArg } from './workspace-cli';

describe('parseWorkspaceCliArg', () => {
  test('parses --workspace <path> (space form)', () => {
    const result = parseWorkspaceCliArg([
      '--workspace',
      '/abs/api-workspace',
    ]);
    assert.deepEqual(result, {
      status: 'set',
      workspace: '/abs/api-workspace',
    });
  });

  test('parses --workspace=<path> (equals form)', () => {
    const result = parseWorkspaceCliArg([
      '--workspace=/abs/api-workspace',
    ]);
    assert.deepEqual(result, {
      status: 'set',
      workspace: '/abs/api-workspace',
    });
  });

  test('ignores unrelated args and finds workspace flag', () => {
    const result = parseWorkspaceCliArg([
      '--verbose',
      '--workspace',
      'C:/ws',
      'extra',
    ]);
    assert.deepEqual(result, { status: 'set', workspace: 'C:/ws' });
  });

  test('returns unset when flag is absent', () => {
    assert.deepEqual(parseWorkspaceCliArg([]), { status: 'unset' });
    assert.deepEqual(parseWorkspaceCliArg(['--other', 'x']), {
      status: 'unset',
    });
  });

  test('errors when --workspace has no following value', () => {
    const result = parseWorkspaceCliArg(['--workspace']);
    assert.equal(result.status, 'error');
    if (result.status !== 'error') return;
    assert.match(result.message, /Missing value for --workspace/);
  });

  test('errors when next arg after --workspace starts with -', () => {
    const result = parseWorkspaceCliArg(['--workspace', '--verbose']);
    assert.equal(result.status, 'error');
    if (result.status !== 'error') return;
    assert.match(result.message, /Missing value for --workspace/);
  });

  test('errors when --workspace= has empty value', () => {
    const result = parseWorkspaceCliArg(['--workspace=']);
    assert.equal(result.status, 'error');
    if (result.status !== 'error') return;
    assert.match(result.message, /Missing value for --workspace/);
  });
});

describe('resolveMcpWorkspaceRoot', () => {
  const cwd = path.resolve('/tmp/mcp-cwd');
  const envWs = path.resolve('/tmp/env-workspace');
  const cliWs = path.resolve('/tmp/cli-workspace');

  test('prefers CLI workspace over env and cwd', () => {
    const resolved = resolveMcpWorkspaceRoot({
      cliWorkspace: cliWs,
      env: { APIHERO_WORKSPACE: envWs },
      cwd,
    });
    assert.equal(resolved, path.resolve(cwd, cliWs));
  });

  test('falls back to APIHERO_WORKSPACE when CLI unset', () => {
    const resolved = resolveMcpWorkspaceRoot({
      env: { APIHERO_WORKSPACE: envWs },
      cwd,
    });
    assert.equal(resolved, path.resolve(cwd, envWs));
  });

  test('falls back to cwd when neither CLI nor env set', () => {
    const resolved = resolveMcpWorkspaceRoot({ env: {}, cwd });
    assert.equal(resolved, path.resolve(cwd));
  });

  test('ignores empty/whitespace CLI and uses env', () => {
    const resolved = resolveMcpWorkspaceRoot({
      cliWorkspace: '   ',
      env: { APIHERO_WORKSPACE: envWs },
      cwd,
    });
    assert.equal(resolved, path.resolve(cwd, envWs));
  });

  test('ignores empty env and uses cwd', () => {
    const resolved = resolveMcpWorkspaceRoot({
      env: { APIHERO_WORKSPACE: '  ' },
      cwd,
    });
    assert.equal(resolved, path.resolve(cwd));
  });

  test('resolves relative CLI path against injectable cwd', () => {
    const resolved = resolveMcpWorkspaceRoot({
      cliWorkspace: 'rel-ws',
      env: {},
      cwd,
    });
    assert.equal(resolved, path.resolve(cwd, 'rel-ws'));
  });
});
