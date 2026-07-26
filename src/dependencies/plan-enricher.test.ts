import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { freezeRunPlan, type PlannedRequest, type RunPlan } from '../collection-runner';
import { enrichRunPlanWithDependencies } from './plan-enricher';
import type { RequestDependencyAnalysis } from './models';

function plannedRequest(
  requestId: string,
  label: string,
  ordinal: number,
): PlannedRequest {
  return {
    requestId,
    collectionId: 'c1',
    filePath: `file:///${requestId}.api`,
    offset: 0,
    label,
    method: 'GET',
    url: `https://example.test/${requestId}`,
    ordinal,
  };
}

function plan(requests: readonly PlannedRequest[]): RunPlan {
  return freezeRunPlan({
    runId: 'run1',
    mode: 'collection',
    collectionId: 'c1',
    collectionName: 'C1',
    failurePolicy: 'continue-on-error',
    requests,
    createdAt: new Date(0).toISOString(),
  });
}

describe('enrichRunPlanWithDependencies', () => {
  test('reorders requests so a producer runs before its consumer', () => {
    const membershipPlan = plan([
      plannedRequest('products', 'Products', 0),
      plannedRequest('login', 'Login', 1),
    ]);
    const analyses: RequestDependencyAnalysis[] = [
      { requestId: 'products', produces: [], consumes: ['accessToken'], dependsOnNames: [] },
      { requestId: 'login', produces: ['accessToken'], consumes: [], dependsOnNames: [] },
    ];

    const result = enrichRunPlanWithDependencies({ membershipPlan, analyses });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.plan.requests.map((request) => request.requestId),
      ['login', 'products'],
    );
    assert.deepEqual(
      result.plan.requests.map((request) => request.ordinal),
      [0, 1],
    );
    assert.equal(result.plan.extensions?.dependencies?.reordered, true);
    assert.deepEqual(result.plan.extensions?.dependencies?.originalOrder, [
      'products',
      'login',
    ]);
    assert.deepEqual(result.plan.extensions?.dependencies?.executionOrder, [
      'login',
      'products',
    ]);
    assert.deepEqual(result.plan.extensions?.variablesPerRun, {
      storeKind: 'in-memory',
      producedByRequest: {
        products: [],
        login: ['accessToken'],
      },
    });
    const productsRequest = result.plan.requests.find(
      (request) => request.requestId === 'products',
    );
    assert.deepEqual(productsRequest?.consumes, ['accessToken']);
  });

  test('keeps DFS order and reordered=false when there are no dependencies', () => {
    const membershipPlan = plan([
      plannedRequest('a', 'A', 0),
      plannedRequest('b', 'B', 1),
    ]);
    const analyses: RequestDependencyAnalysis[] = [
      { requestId: 'a', produces: [], consumes: [], dependsOnNames: [] },
      { requestId: 'b', produces: [], consumes: [], dependsOnNames: [] },
    ];

    const result = enrichRunPlanWithDependencies({ membershipPlan, analyses });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.plan.requests.map((request) => request.requestId),
      ['a', 'b'],
    );
    assert.equal(result.plan.extensions?.dependencies?.reordered, false);
  });

  test('blocks the run with DEPENDENCY_CYCLE when requests depend on each other', () => {
    const membershipPlan = plan([
      plannedRequest('a', 'A', 0),
      plannedRequest('b', 'B', 1),
    ]);
    const analyses: RequestDependencyAnalysis[] = [
      { requestId: 'a', produces: [], consumes: [], dependsOnNames: ['B'] },
      { requestId: 'b', produces: [], consumes: [], dependsOnNames: ['A'] },
    ];

    const result = enrichRunPlanWithDependencies({ membershipPlan, analyses });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'DEPENDENCY_CYCLE');
    assert.ok(result.cycles !== undefined && result.cycles.length > 0);
    // Cycle notification path uses @name labels (same as report edges), not ids.
    assert.match(result.message, /A → B → A|B → A → B/);
    assert.doesNotMatch(result.message, /\ba → b → a\b|\bb → a → b\b/);
  });

  test('disambiguates duplicate labels in DEPENDENCY_CYCLE paths', () => {
    const membershipPlan = plan([
      plannedRequest('login1', 'Login', 0),
      plannedRequest('login2', 'Login', 1),
    ]);
    // Implicit cycle via mutual produces/consumes (not blocked by AMBIGUOUS_DEPENDS_ON).
    const analyses: RequestDependencyAnalysis[] = [
      {
        requestId: 'login1',
        produces: ['tokenA'],
        consumes: ['tokenB'],
        dependsOnNames: [],
      },
      {
        requestId: 'login2',
        produces: ['tokenB'],
        consumes: ['tokenA'],
        dependsOnNames: [],
      },
    ];

    const result = enrichRunPlanWithDependencies({ membershipPlan, analyses });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'DEPENDENCY_CYCLE');
    assert.match(result.message, /Login \(login1\)/);
    assert.match(result.message, /Login \(login2\)/);
  });

  test('blocks the run with AMBIGUOUS_DEPENDS_ON when a label is not unique', () => {
    const membershipPlan = plan([
      plannedRequest('login1', 'Login', 0),
      plannedRequest('login2', 'Login', 1),
      plannedRequest('invoice', 'Invoice', 2),
    ]);
    const analyses: RequestDependencyAnalysis[] = [
      { requestId: 'login1', produces: [], consumes: [], dependsOnNames: [] },
      { requestId: 'login2', produces: [], consumes: [], dependsOnNames: [] },
      { requestId: 'invoice', produces: [], consumes: [], dependsOnNames: ['Login'] },
    ];

    const result = enrichRunPlanWithDependencies({ membershipPlan, analyses });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'AMBIGUOUS_DEPENDS_ON');
  });

  test('records unresolvedConsumes without blocking the run', () => {
    const membershipPlan = plan([plannedRequest('products', 'Products', 0)]);
    const analyses: RequestDependencyAnalysis[] = [
      { requestId: 'products', produces: [], consumes: ['accessToken'], dependsOnNames: [] },
    ];

    const result = enrichRunPlanWithDependencies({ membershipPlan, analyses });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.extensions?.dependencies?.unresolvedConsumes, [
      { requestId: 'products', variable: 'accessToken' },
    ]);
  });

  test('autoReorder=false preserves membership order even when a reorder is possible', () => {
    const membershipPlan = plan([
      plannedRequest('products', 'Products', 0),
      plannedRequest('login', 'Login', 1),
    ]);
    const analyses: RequestDependencyAnalysis[] = [
      { requestId: 'products', produces: [], consumes: ['accessToken'], dependsOnNames: [] },
      { requestId: 'login', produces: ['accessToken'], consumes: [], dependsOnNames: [] },
    ];

    const result = enrichRunPlanWithDependencies({
      membershipPlan,
      analyses,
      autoReorder: false,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.plan.requests.map((request) => request.requestId),
      ['products', 'login'],
    );
    assert.equal(result.plan.extensions?.dependencies?.reordered, false);
  });
});
