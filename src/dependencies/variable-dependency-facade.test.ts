/**
 * ADR 0003 RULE 10 — editor projection == runner graph; Auto never serializes.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { serializeRequestDocument } from '../request-source';
import { buildDependencyGraph } from './graph-builder';
import type { RequestDependencyAnalysis } from './models';
import { analyzeProducesConsumesForDocument } from './produces-consumes';
import { parseApiDocument } from '../parser';
import {
  analyzeCollectionDependencies,
  contentFingerprint,
  isProjectionFailure,
  projectVariableDependencies,
} from './variable-dependency-facade';

function analysis(
  requestId: string,
  produces: readonly string[] = [],
  consumes: readonly string[] = [],
  dependsOnNames: readonly string[] = [],
): RequestDependencyAnalysis {
  return { requestId, produces, consumes, dependsOnNames };
}

function labels(
  entries: readonly (readonly [string, string])[],
): Map<string, string> {
  return new Map(entries);
}

describe('projectVariableDependencies', () => {
  test('editor projection edges == buildDependencyGraph edges for same analyses', () => {
    const analyses = [
      analysis('login', ['accessToken']),
      analysis('products', [], ['accessToken'], ['Login']),
    ];
    const labelByRequestId = labels([
      ['login', 'Login'],
      ['products', 'Products'],
    ]);
    const graph = buildDependencyGraph({ analyses, labelByRequestId });
    assert.equal(graph.ok, true);
    if (!graph.ok) return;

    const projection = projectVariableDependencies({
      analyses,
      labelByRequestId,
      focusRequestId: 'products',
    });
    assert.equal(isProjectionFailure(projection), false);
    if (isProjectionFailure(projection)) return;
    assert.deepEqual(projection.graphEdges, graph.graph.edges);
  });

  test('Auto never appears in serializeRequestDocument (model.dependsOn only manual)', () => {
    const analyses = [
      analysis('login', ['accessToken']),
      analysis('products', [], ['accessToken']),
    ];
    const projection = projectVariableDependencies({
      analyses,
      labelByRequestId: labels([
        ['login', 'Login'],
        ['products', 'Products'],
      ]),
      focusRequestId: 'products',
    });
    assert.equal(isProjectionFailure(projection), false);
    if (isProjectionFailure(projection)) return;
    assert.equal(projection.auto.length, 1);
    assert.equal(projection.auto[0]?.dependRef, 'Login');

    // Serialize only the form model — Auto is projection-only, not on the model.
    const source = serializeRequestDocument({
      name: 'Products',
      method: 'GET',
      url: 'https://example.test/products',
      dependsOn: [],
    });
    assert.doesNotMatch(source, /@depends-on/u);
    assert.doesNotMatch(source, /Login/u);
  });

  test('Manual dependsOn serializes as @depends-on', () => {
    const source = serializeRequestDocument({
      name: 'Products',
      method: 'GET',
      url: 'https://example.test/products',
      dependsOn: ['Login'],
    });
    assert.match(source, /@depends-on Login\n/u);
  });

  test('multi-producer keeps all implicit edges (Q1 Option A) and lists Ambiguous', () => {
    const analyses = [
      analysis('a', ['token']),
      analysis('b', ['token']),
      analysis('c', [], ['token']),
    ];
    const labelByRequestId = labels([
      ['a', 'A'],
      ['b', 'B'],
      ['c', 'C'],
    ]);
    const graph = buildDependencyGraph({ analyses, labelByRequestId });
    assert.equal(graph.ok, true);
    if (!graph.ok) return;
    assert.equal(
      graph.graph.edges.filter((edge) => edge.kind === 'implicit').length,
      2,
    );

    const projection = projectVariableDependencies({
      analyses,
      labelByRequestId,
      focusRequestId: 'c',
    });
    assert.equal(isProjectionFailure(projection), false);
    if (isProjectionFailure(projection)) return;
    assert.deepEqual(projection.graphEdges, graph.graph.edges);
    assert.equal(projection.auto.length, 2);
    assert.equal(projection.ambiguousProducers.length, 1);
    assert.equal(projection.ambiguousProducers[0]?.variable, 'token');
    assert.deepEqual(
      projection.ambiguousProducers[0]?.producers.map((p) => p.dependRef).sort(),
      ['A', 'B'],
    );
  });

  test('unknown vars listed; static names filtered from unknown (Q2)', () => {
    const analyses = [analysis('products', [], ['accessToken', 'host', 'region'])];
    const projection = projectVariableDependencies({
      analyses,
      labelByRequestId: labels([['products', 'Products']]),
      focusRequestId: 'products',
      staticVariableNames: new Set(['host', 'region']),
    });
    assert.equal(isProjectionFailure(projection), false);
    if (isProjectionFailure(projection)) return;
    assert.deepEqual(projection.unknownVariables, ['accessToken']);
    assert.equal(projection.graphEdges.length, 0);
  });

  test('document @variable defaults already excluded by analyzer — no edge', () => {
    const text = [
      '@name Create',
      '@variable region=us-east-1',
      'POST {{host}}/items/{{region}}',
      '',
    ].join('\n');
    const document = parseApiDocument(text, { sourceId: 'create.api' }).ast;
    const analyzed = analyzeProducesConsumesForDocument(
      document,
      text,
      0,
      'create',
    );
    assert.ok(!analyzed.consumes.includes('region'));

    const projection = projectVariableDependencies({
      analyses: [analyzed],
      labelByRequestId: labels([['create', 'Create']]),
      focusRequestId: 'create',
      staticVariableNames: new Set(['host']),
    });
    assert.equal(isProjectionFailure(projection), false);
    if (isProjectionFailure(projection)) return;
    assert.equal(projection.graphEdges.length, 0);
    assert.ok(!projection.unknownVariables.includes('region'));
  });

  test('chain A→B→C→D: one-pass yields all direct edges (no fixed-point loop)', () => {
    const analyses = [
      analysis('a', ['v1']),
      analysis('b', ['v2'], ['v1']),
      analysis('c', ['v3'], ['v2']),
      analysis('d', [], ['v3']),
    ];
    const labelByRequestId = labels([
      ['a', 'A'],
      ['b', 'B'],
      ['c', 'C'],
      ['d', 'D'],
    ]);
    const graph = buildDependencyGraph({ analyses, labelByRequestId });
    assert.equal(graph.ok, true);
    if (!graph.ok) return;
    const implicit = graph.graph.edges.filter((edge) => edge.kind === 'implicit');
    assert.equal(implicit.length, 3);
    assert.deepEqual(
      implicit.map((edge) => `${edge.fromRequestId}->${edge.toRequestId}`).sort(),
      ['a->b', 'b->c', 'c->d'],
    );

    const projection = projectVariableDependencies({
      analyses,
      labelByRequestId,
      focusRequestId: 'd',
    });
    assert.equal(isProjectionFailure(projection), false);
    if (isProjectionFailure(projection)) return;
    assert.deepEqual(projection.graphEdges, graph.graph.edges);
    assert.equal(projection.auto.length, 1);
    assert.equal(projection.auto[0]?.dependRef, 'C');
  });

  test('Pin is just dependsOn array containing the ref (unit-level)', () => {
    const autoDependRef = 'Login';
    const dependsOnBefore: string[] = [];
    const dependsOnAfter = [...new Set([...dependsOnBefore, autoDependRef])];
    assert.deepEqual(dependsOnAfter, ['Login']);

    const source = serializeRequestDocument({
      name: 'Products',
      method: 'GET',
      url: 'https://example.test/products',
      dependsOn: dependsOnAfter,
    });
    assert.match(source, /@depends-on Login\n/u);
  });

  test('Manual section reflects explicit edges; Auto stays separate', () => {
    const analyses = [
      analysis('login', ['accessToken']),
      analysis('setup'),
      analysis('products', [], ['accessToken'], ['Setup']),
    ];
    const projection = projectVariableDependencies({
      analyses,
      labelByRequestId: labels([
        ['login', 'Login'],
        ['setup', 'Setup'],
        ['products', 'Products'],
      ]),
      focusRequestId: 'products',
    });
    assert.equal(isProjectionFailure(projection), false);
    if (isProjectionFailure(projection)) return;
    assert.equal(projection.auto.length, 1);
    assert.equal(projection.auto[0]?.dependRef, 'Login');
    assert.equal(projection.manual.length, 1);
    assert.equal(projection.manual[0]?.dependRef, 'Setup');
  });

  test('ignoredVariableNames filtered from unknown (Q3)', () => {
    const projection = projectVariableDependencies({
      analyses: [analysis('products', [], ['ghost', 'noise'])],
      labelByRequestId: labels([['products', 'Products']]),
      focusRequestId: 'products',
      ignoredVariableNames: new Set(['noise']),
    });
    assert.equal(isProjectionFailure(projection), false);
    if (isProjectionFailure(projection)) return;
    assert.deepEqual(projection.unknownVariables, ['ghost']);
  });

  test('surfaces graph-builder failure without inventing edges', () => {
    const result = projectVariableDependencies({
      analyses: [
        analysis('a'),
        analysis('b'),
        analysis('c', [], [], ['Login']),
      ],
      labelByRequestId: labels([
        ['a', 'Login'],
        ['b', 'Login'],
        ['c', 'C'],
      ]),
      focusRequestId: 'c',
    });
    assert.equal(isProjectionFailure(result), true);
    if (!isProjectionFailure(result)) return;
    assert.equal(result.code, 'AMBIGUOUS_DEPENDS_ON');
  });
});

describe('analyzeCollectionDependencies', () => {
  test('reads each unique file once and analyzes per request', async () => {
    const reads: string[] = [];
    const analyses = await analyzeCollectionDependencies({
      requests: [
        { requestId: 'login', filePath: 'file:///a.api', offset: 0 },
        { requestId: 'products', filePath: 'file:///b.api', offset: 0 },
        { requestId: 'login2', filePath: 'file:///a.api', offset: 0 },
      ],
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
    assert.ok(analyses[1]?.consumes.includes('accessToken'));
  });

  test('reuses analysisCache when content fingerprint matches', async () => {
    const cache = new Map();
    const text =
      '@name Login\n@extract accessToken from body.token\nPOST https://example.test/login\n';
    const fingerprint = contentFingerprint(text);
    let parses = 0;
    const readText = async () => {
      parses += 1;
      return text;
    };

    await analyzeCollectionDependencies({
      requests: [{ requestId: 'login', filePath: 'a.api', offset: 0 }],
      readText,
      analysisCache: cache,
    });
    assert.equal(cache.size, 1);
    assert.ok(cache.has(`a.api\0${fingerprint}\0${0}`));

    const again = await analyzeCollectionDependencies({
      requests: [{ requestId: 'login', filePath: 'a.api', offset: 0 }],
      readText,
      analysisCache: cache,
    });
    assert.equal(parses, 2); // read still happens; analysis is cached
    assert.deepEqual(again[0]?.produces, ['accessToken']);
  });

  test('evicts stale fingerprint cache entries for the same file+offset', async () => {
    const cache = new Map();
    const first =
      '@name Login\n@extract accessToken from body.token\nPOST https://example.test/login\n';
    const second =
      '@name Login\n@extract accessToken from body.access_token\nPOST https://example.test/login\n';
    let version = 0;
    const readText = async () => (version === 0 ? first : second);

    await analyzeCollectionDependencies({
      requests: [{ requestId: 'login', filePath: 'a.api', offset: 0 }],
      readText,
      analysisCache: cache,
    });
    assert.equal(cache.size, 1);
    const firstKey = [...cache.keys()][0]!;

    version = 1;
    await analyzeCollectionDependencies({
      requests: [{ requestId: 'login', filePath: 'a.api', offset: 0 }],
      readText,
      analysisCache: cache,
    });
    assert.equal(cache.size, 1);
    assert.equal(cache.has(firstKey), false);
    assert.deepEqual(cache.values().next().value?.produces, ['accessToken']);
  });

  test('returns empty analysis for unreadable files', async () => {
    const analyses = await analyzeCollectionDependencies({
      requests: [{ requestId: 'missing', filePath: 'missing.api', offset: 0 }],
      readText: async () => {
        throw new Error('ENOENT');
      },
    });
    assert.deepEqual(analyses, [
      { requestId: 'missing', produces: [], consumes: [], dependsOnNames: [] },
    ]);
  });
});

describe('inferred edges never enter the document model', () => {
  test('serialize only emits authored dependsOn — never inferred Auto refs', () => {
    const source = serializeRequestDocument({
      name: 'Products',
      method: 'GET',
      url: 'https://example.test/{{accessToken}}',
      // Form buffer has no Auto — pin would add Login explicitly.
      dependsOn: [],
    });
    assert.doesNotMatch(source, /@depends-on/u);
    assert.doesNotMatch(source, /Login/u);
  });
});
