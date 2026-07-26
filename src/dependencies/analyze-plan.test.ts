import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { freezeRunPlan, type PlannedRequest, type RunPlan } from '../collection-runner';
import { analyzeRunPlanDependencies } from './analyze-plan';

function plannedRequest(
  requestId: string,
  filePath: string,
  ordinal: number,
): PlannedRequest {
  return {
    requestId,
    collectionId: 'c1',
    filePath,
    offset: 0,
    label: requestId,
    method: 'GET',
    url: 'https://example.test',
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

describe('analyzeRunPlanDependencies', () => {
  test('analyzes each request and caches file reads by path', async () => {
    const reads: string[] = [];
    const testPlan = plan([
      plannedRequest('login', 'file:///a.api', 0),
      plannedRequest('products', 'file:///b.api', 1),
    ]);
    const analyses = await analyzeRunPlanDependencies(testPlan, {
      readText: async (filePath) => {
        reads.push(filePath);
        if (filePath === 'file:///a.api') {
          return '@name Login\n@extract accessToken from body.token\nPOST https://example.test/login\n';
        }
        return 'GET {{host}}/products\nAuthorization: Bearer {{accessToken}}\n';
      },
    });

    assert.equal(reads.length, 2);
    assert.deepEqual(analyses[0]?.produces, ['accessToken']);
    assert.deepEqual([...(analyses[1]?.consumes ?? [])].sort(), ['accessToken', 'host']);
  });

  test('returns an empty analysis for unreadable files instead of throwing', async () => {
    const testPlan = plan([plannedRequest('missing', 'file:///missing.api', 0)]);
    const analyses = await analyzeRunPlanDependencies(testPlan, {
      readText: async () => {
        throw new Error('ENOENT');
      },
    });
    assert.deepEqual(analyses, [
      { requestId: 'missing', produces: [], consumes: [], dependsOnNames: [] },
    ]);
  });
});
