/**
 * CLI scenario success / exit policy unit tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { McpScenarioRunDto } from '../mcp/dto';
import {
  EXIT_AUTH,
  EXIT_EXECUTION_FAILURE,
  EXIT_SUCCESS,
} from './exit-codes';
import {
  isScenarioCliSuccess,
  resolveScenarioCliExitCode,
} from './scenario-result';

function scenario(partial: {
  readonly status?: string;
  readonly total?: number;
  readonly completed?: number;
  readonly failed?: number;
  readonly skipped?: number;
  readonly steps?: McpScenarioRunDto['steps'];
}): McpScenarioRunDto {
  const total = partial.total ?? 1;
  const completed = partial.completed ?? 1;
  const failed = partial.failed ?? 0;
  const skipped = partial.skipped ?? 0;
  return {
    scenarioId: 's1',
    scenarioName: 'demo',
    runId: 'r1',
    status: partial.status ?? 'completed',
    startTime: 0,
    endTime: 10,
    durationMs: 10,
    statistics: {
      total,
      completed,
      failed,
      skipped,
      cancelled: 0,
      durationMs: 10,
    },
    steps: partial.steps ?? [
      {
        stepId: 'a',
        stepName: 'Step A',
        status: 'completed',
        attempt: 1,
        durationMs: 10,
      },
    ],
    variables: [],
  };
}

describe('isScenarioCliSuccess / resolveScenarioCliExitCode', () => {
  test('success when completed with no failures', () => {
    const data = scenario({});
    assert.equal(isScenarioCliSuccess(data), true);
    assert.equal(resolveScenarioCliExitCode(data), EXIT_SUCCESS);
  });

  test('failure when status is failed', () => {
    const data = scenario({
      status: 'failed',
      completed: 0,
      failed: 1,
      steps: [
        {
          stepId: 'a',
          stepName: 'Step A',
          status: 'failed',
          attempt: 1,
          durationMs: 5,
          error: { message: 'assertion failed' },
        },
      ],
    });
    assert.equal(isScenarioCliSuccess(data), false);
    assert.equal(resolveScenarioCliExitCode(data), EXIT_EXECUTION_FAILURE);
  });

  test('failure when failed count is non-zero', () => {
    const data = scenario({
      status: 'completed',
      completed: 0,
      failed: 1,
    });
    assert.equal(isScenarioCliSuccess(data), false);
    assert.equal(resolveScenarioCliExitCode(data), EXIT_EXECUTION_FAILURE);
  });

  test('precondition skip (skipped step with error) fails CLI', () => {
    const data = scenario({
      status: 'completed',
      total: 2,
      completed: 1,
      failed: 0,
      skipped: 1,
      steps: [
        {
          stepId: 'a',
          stepName: 'Gate',
          status: 'skipped',
          attempt: 1,
          durationMs: 0,
          error: { message: 'Precondition not met' },
        },
        {
          stepId: 'b',
          stepName: 'Work',
          status: 'completed',
          attempt: 1,
          durationMs: 8,
        },
      ],
    });
    assert.equal(isScenarioCliSuccess(data), false);
    assert.equal(resolveScenarioCliExitCode(data), EXIT_EXECUTION_FAILURE);
  });

  test('clean skip without error message is not a precondition failure alone', () => {
    // Still fails because total>0 && completed===0 (all skipped).
    const allSkipped = scenario({
      status: 'completed',
      total: 2,
      completed: 0,
      failed: 0,
      skipped: 2,
      steps: [
        {
          stepId: 'a',
          stepName: 'A',
          status: 'skipped',
          attempt: 1,
          durationMs: 0,
        },
        {
          stepId: 'b',
          stepName: 'B',
          status: 'skipped',
          attempt: 1,
          durationMs: 0,
        },
      ],
    });
    assert.equal(isScenarioCliSuccess(allSkipped), false);
    assert.equal(resolveScenarioCliExitCode(allSkipped), EXIT_EXECUTION_FAILURE);
  });

  test('all skipped (total>0, completed===0) fails even if status is not failed', () => {
    const data = scenario({
      status: 'completed',
      total: 1,
      completed: 0,
      failed: 0,
      skipped: 1,
      steps: [
        {
          stepId: 'a',
          stepName: 'Only',
          status: 'skipped',
          attempt: 1,
          durationMs: 0,
        },
      ],
    });
    assert.equal(isScenarioCliSuccess(data), false);
    assert.equal(resolveScenarioCliExitCode(data), EXIT_EXECUTION_FAILURE);
  });

  test('auth-shaped step error maps to EXIT_AUTH', () => {
    const data = scenario({
      status: 'failed',
      completed: 0,
      failed: 1,
      steps: [
        {
          stepId: 'a',
          stepName: 'Login',
          status: 'failed',
          attempt: 1,
          durationMs: 3,
          error: { message: 'Authentication secret is unavailable' },
        },
      ],
    });
    assert.equal(isScenarioCliSuccess(data), false);
    assert.equal(resolveScenarioCliExitCode(data), EXIT_AUTH);
  });

  test('cancelled status fails CLI even when some steps completed', () => {
    const data = scenario({
      status: 'cancelled',
      total: 2,
      completed: 1,
      failed: 0,
      skipped: 0,
      steps: [
        {
          stepId: 'a',
          stepName: 'A',
          status: 'completed',
          attempt: 1,
          durationMs: 5,
        },
        {
          stepId: 'b',
          stepName: 'B',
          status: 'cancelled',
          attempt: 1,
          durationMs: 0,
        },
      ],
    });
    assert.equal(isScenarioCliSuccess(data), false);
    assert.equal(resolveScenarioCliExitCode(data), EXIT_EXECUTION_FAILURE);
  });

  test('clean skip after a completed step can still succeed', () => {
    const data = scenario({
      status: 'completed',
      total: 2,
      completed: 1,
      failed: 0,
      skipped: 1,
      steps: [
        {
          stepId: 'a',
          stepName: 'A',
          status: 'completed',
          attempt: 1,
          durationMs: 5,
        },
        {
          stepId: 'b',
          stepName: 'B',
          status: 'skipped',
          attempt: 1,
          durationMs: 0,
        },
      ],
    });
    assert.equal(isScenarioCliSuccess(data), true);
    assert.equal(resolveScenarioCliExitCode(data), EXIT_SUCCESS);
  });
});
