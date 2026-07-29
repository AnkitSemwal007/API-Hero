import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  evaluateConditionExpression,
  parseConditionExpression,
} from './condition-expression';

describe('scenarios/condition-expression', () => {
  test('parses comparisons, logical ops, and parentheses', () => {
    const parsed = parseConditionExpression(
      'statusCode == 200 && ({{ok}} == true || headers["x-a"] == "1")',
    );
    assert.equal(parsed.ok, true);
  });

  test('evaluates statusCode and headers', () => {
    const result = evaluateConditionExpression(
      'statusCode == 200 && headers["content-type"] == "application/json"',
      {
        statusCode: 200,
        headers: new Map([['content-type', 'application/json']]),
        variables: new Map(),
      },
    );
    assert.equal(result.result, true);
  });

  test('evaluates {{variable}} references', () => {
    const result = evaluateConditionExpression('{{token}} != "" && count >= 2', {
      variables: new Map([
        ['token', 'abc'],
        ['count', '3'],
      ]),
    });
    assert.equal(result.result, true);
    assert.deepEqual(result.usedVariables, ['count', 'token']);
  });

  test('rejects empty expression', () => {
    const parsed = parseConditionExpression('   ');
    assert.equal(parsed.ok, false);
  });

  test('short-circuits || without evaluating right when left is true', () => {
    const result = evaluateConditionExpression('true || statusCode == 200', {
      variables: new Map(),
    });
    assert.equal(result.result, true);
  });
});
