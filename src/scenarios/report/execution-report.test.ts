import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MASKED_VARIABLE_VALUE } from '../../variables';
import {
  ScenarioSchemaVersion,
  ScenarioVariableScope,
  type Scenario,
  type ScenarioRunResult,
} from '../models';
import { buildExecutionReport } from './execution-report';

describe('scenarios/report/execution-report', () => {
  test('masks sensitive variables and aggregates step statistics', () => {
    const scenario: Scenario = {
      id: 'sc-1',
      schemaVersion: ScenarioSchemaVersion,
      name: 'Scenario',
      variables: [
        {
          id: 'vToken',
          name: 'token',
          scope: ScenarioVariableScope.Scenario,
          sensitive: true,
        },
        {
          id: 'vEnv',
          name: 'env',
          scope: ScenarioVariableScope.Scenario,
          sensitive: false,
        },
      ],
      steps: [],
      connections: [],
      executionSettings: { failurePolicy: 'stop-on-first-error' },
      metadata: { createdAt: 't1', updatedAt: 't2' },
    };

    const run: ScenarioRunResult = {
      runId: 'run-1',
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      status: 'completed',
      startTime: 10,
      endTime: 40,
      durationMs: 30,
      stepResults: [
        {
          stepId: 'A',
          stepName: 'A',
          status: 'completed',
          startTime: 10,
          endTime: 20,
          durationMs: 10,
          attempt: 1,
        },
        {
          stepId: 'B',
          stepName: 'B',
          status: 'skipped',
          startTime: 20,
          endTime: 20,
          durationMs: 0,
          attempt: 0,
        },
        {
          stepId: 'C',
          stepName: 'C',
          status: 'failed',
          startTime: 20,
          endTime: 30,
          durationMs: 10,
          attempt: 1,
          error: { message: 'boom' },
        },
        {
          stepId: 'D',
          stepName: 'D',
          status: 'cancelled',
          startTime: 30,
          endTime: 30,
          durationMs: 0,
          attempt: 0,
        },
      ],
      variables: new Map([
        ['token', 'secret-value'],
        ['env', 'dev'],
      ]),
      timeline: [],
    };

    const report = buildExecutionReport(scenario, run);

    assert.equal(report.status, 'completed');
    assert.deepEqual(report.statistics, {
      total: 4,
      completed: 1,
      failed: 1,
      skipped: 1,
      cancelled: 1,
      durationMs: 30,
    });

    const token = report.variables.find((v) => v.name === 'token');
    const env = report.variables.find((v) => v.name === 'env');
    assert.equal(token?.sensitive, true);
    assert.equal(token?.value, MASKED_VARIABLE_VALUE);
    assert.equal(token?.displayValue, MASKED_VARIABLE_VALUE);
    assert.equal(env?.sensitive, false);
    assert.equal(env?.value, 'dev');
  });
});
