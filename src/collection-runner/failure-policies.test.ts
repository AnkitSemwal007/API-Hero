import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FailurePolicyKinds,
  RequestRunOutcomeKinds,
  listFailurePolicies,
  resolveFailurePolicy,
  type RequestRunResult,
} from './index';

function result(
  outcome: (typeof RequestRunOutcomeKinds)[keyof typeof RequestRunOutcomeKinds],
): RequestRunResult {
  return {
    requestId: 'req_1',
    ordinal: 0,
    label: 'GET /',
    outcome,
    durationMs: 1,
  };
}

const OUTCOMES = [
  RequestRunOutcomeKinds.Failed,
  RequestRunOutcomeKinds.Cancelled,
  RequestRunOutcomeKinds.Passed,
  RequestRunOutcomeKinds.Skipped,
] as const;

test('StopOnFirstError classifies invalid as Failed and stops on Failed/Cancelled', () => {
  const policy = resolveFailurePolicy(FailurePolicyKinds.StopOnFirstError);
  assert.equal(policy.classifyInvalid(), RequestRunOutcomeKinds.Failed);
  assert.equal(policy.shouldStopAfter(result(RequestRunOutcomeKinds.Failed)), true);
  assert.equal(policy.shouldStopAfter(result(RequestRunOutcomeKinds.Cancelled)), true);
  assert.equal(policy.shouldStopAfter(result(RequestRunOutcomeKinds.Passed)), false);
  assert.equal(policy.shouldStopAfter(result(RequestRunOutcomeKinds.Skipped)), false);
});

test('ContinueOnError classifies invalid as Failed and stops only on Cancelled', () => {
  const policy = resolveFailurePolicy(FailurePolicyKinds.ContinueOnError);
  assert.equal(policy.classifyInvalid(), RequestRunOutcomeKinds.Failed);
  assert.equal(policy.shouldStopAfter(result(RequestRunOutcomeKinds.Failed)), false);
  assert.equal(policy.shouldStopAfter(result(RequestRunOutcomeKinds.Cancelled)), true);
  assert.equal(policy.shouldStopAfter(result(RequestRunOutcomeKinds.Passed)), false);
  assert.equal(policy.shouldStopAfter(result(RequestRunOutcomeKinds.Skipped)), false);
});

test('SkipInvalidRequests classifies invalid as Skipped and stops only on Cancelled', () => {
  const policy = resolveFailurePolicy(FailurePolicyKinds.SkipInvalidRequests);
  assert.equal(policy.classifyInvalid(), RequestRunOutcomeKinds.Skipped);
  assert.equal(policy.shouldStopAfter(result(RequestRunOutcomeKinds.Failed)), false);
  assert.equal(policy.shouldStopAfter(result(RequestRunOutcomeKinds.Cancelled)), true);
  assert.equal(policy.shouldStopAfter(result(RequestRunOutcomeKinds.Passed)), false);
  assert.equal(policy.shouldStopAfter(result(RequestRunOutcomeKinds.Skipped)), false);
});

test('policy matrix covers every built-in policy and outcome', () => {
  const expectedStop: Record<string, Record<string, boolean>> = {
    [FailurePolicyKinds.StopOnFirstError]: {
      [RequestRunOutcomeKinds.Failed]: true,
      [RequestRunOutcomeKinds.Cancelled]: true,
      [RequestRunOutcomeKinds.Passed]: false,
      [RequestRunOutcomeKinds.Skipped]: false,
    },
    [FailurePolicyKinds.ContinueOnError]: {
      [RequestRunOutcomeKinds.Failed]: false,
      [RequestRunOutcomeKinds.Cancelled]: true,
      [RequestRunOutcomeKinds.Passed]: false,
      [RequestRunOutcomeKinds.Skipped]: false,
    },
    [FailurePolicyKinds.SkipInvalidRequests]: {
      [RequestRunOutcomeKinds.Failed]: false,
      [RequestRunOutcomeKinds.Cancelled]: true,
      [RequestRunOutcomeKinds.Passed]: false,
      [RequestRunOutcomeKinds.Skipped]: false,
    },
  };

  for (const policy of listFailurePolicies()) {
    for (const outcome of OUTCOMES) {
      assert.equal(
        policy.shouldStopAfter(result(outcome)),
        expectedStop[policy.kind]![outcome],
        `${policy.kind} / ${outcome}`,
      );
    }
  }
});

test('listFailurePolicies and resolveFailurePolicy stay aligned', () => {
  const listed = listFailurePolicies();
  assert.equal(listed.length, 3);
  assert.deepEqual(
    listed.map((policy) => policy.kind),
    [
      FailurePolicyKinds.StopOnFirstError,
      FailurePolicyKinds.ContinueOnError,
      FailurePolicyKinds.SkipInvalidRequests,
    ],
  );
  for (const policy of listed) {
    assert.equal(resolveFailurePolicy(policy.kind), policy);
    assert.ok(policy.label.length > 0);
  }
});
