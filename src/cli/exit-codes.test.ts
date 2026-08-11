/**
 * Exit-code mapper tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  EXIT_AUTH,
  EXIT_CONFIG,
  EXIT_EXECUTION_FAILURE,
  mapMcpErrorToExitCode,
} from './exit-codes';

describe('mapMcpErrorToExitCode', () => {
  test('maps not-found / unbound to config (3)', () => {
    assert.equal(
      mapMcpErrorToExitCode({
        code: 'COLLECTION_NOT_FOUND',
        message: 'missing',
      }),
      EXIT_CONFIG,
    );
    assert.equal(
      mapMcpErrorToExitCode({
        code: 'SCENARIO_UNBOUND',
        message: 'unbound',
      }),
      EXIT_CONFIG,
    );
  });

  test('maps auth-shaped RUN_FAILED messages to 4', () => {
    assert.equal(
      mapMcpErrorToExitCode({
        code: 'RUN_FAILED',
        message: 'Authentication secret is unavailable',
      }),
      EXIT_AUTH,
    );
  });

  test('does not treat generic authentication mentions as auth exit', () => {
    assert.equal(
      mapMcpErrorToExitCode({
        code: 'COLLECTION_NOT_FOUND',
        message: 'No collection with authentication defaults',
      }),
      EXIT_CONFIG,
    );
  });

  test('maps run already active to execution failure', () => {
    assert.equal(
      mapMcpErrorToExitCode({
        code: 'RUN_ALREADY_ACTIVE',
        message: 'busy',
      }),
      EXIT_EXECUTION_FAILURE,
    );
  });
});
