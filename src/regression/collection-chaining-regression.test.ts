/**
 * Collection Runner / Dependencies / Autofill regression catalog (TC001–TC038
 * subset for parse, graph, facade, serialize, rename, UI strings, perf smoke).
 * Reuses ADR 0003 engines — no second graph/extract algorithm.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  analyzeCollectionDependencies,
  buildDependencyGraph,
  contentFingerprint,
  enrichRunPlanWithDependencies,
  isProjectionFailure,
  parseDependsOnDirective,
  planDependRefRewrites,
  projectVariableDependencies,
  type RequestDependencyAnalysis,
} from '../dependencies';
import {
  DefaultExtractionEngine,
  isExtractableJsonPath,
  parseExtractDirective,
  type ExtractionContext,
  type ExtractionRule,
  type VariableWriteRequest,
  type VariableWriteResult,
} from '../extraction';
import type { VariableWriter } from '../extraction/variable-writer';
import { freezeRunPlan, type PlannedRequest, type RunPlan } from '../collection-runner';
import type { ExecutionResult } from '../execution';
import { renderRequestEditorHtml } from '../request-editor/vscode/request-editor-html';
import { serializeRequestDocument } from '../request-source';
import { freezeDetachedBytes } from '../shared';

const TIMING = Object.freeze({
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:00.001Z',
  durationMs: 1,
});

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

function plannedRequest(
  requestId: string,
  label: string,
  ordinal: number,
  url = `https://example.test/${requestId}`,
): PlannedRequest {
  return {
    requestId,
    collectionId: 'c1',
    filePath: `file:///${requestId}.api`,
    offset: 0,
    label,
    method: 'GET',
    url,
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

function successResult(json: unknown): ExecutionResult {
  return {
    success: true,
    requestId: 'r1',
    response: {
      requestId: 'r1',
      statusCode: 200,
      statusText: 'OK',
      headers: [],
      body: {
        bytes: freezeDetachedBytes(new Uint8Array(0)),
        json: json as never,
      },
      bodySizeBytes: 0,
      contentType: 'application/json',
      url: 'https://example.test/',
      redirected: false,
      redirectCount: 0,
      timing: TIMING,
    },
    timing: TIMING,
  };
}

function rule(
  partial: Partial<ExtractionRule> & Pick<ExtractionRule, 'variableName' | 'source'>,
): ExtractionRule {
  return {
    id: partial.id ?? `extract_${partial.variableName}`,
    variableName: partial.variableName,
    source: partial.source,
    targetScope: partial.targetScope ?? 'run',
    sensitive: partial.sensitive ?? false,
    required: partial.required ?? true,
    enabled: partial.enabled ?? true,
    when: partial.when ?? { kind: 'always' },
  };
}

function context(result: ExecutionResult): ExtractionContext {
  return { result, requestKey: 'request:regression#0' };
}

class RecordingWriter implements VariableWriter {
  public readonly writes: VariableWriteRequest[] = [];

  public async write(request: VariableWriteRequest): Promise<VariableWriteResult> {
    this.writes.push(request);
    return { ok: true };
  }
}

const engine = new DefaultExtractionEngine();

describe('TC001–TC005 — extract parse + engine', () => {
  test('TC001 — @extract productId from body[0].id parses OK; engine extracts from array root', async () => {
    const parsed = parseExtractDirective({
      knownName: 'extract',
      value: 'productId from body[0].id',
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.rule.source, {
      kind: 'json-path',
      path: 'body[0].id',
    });

    const writer = new RecordingWriter();
    const report = await engine.apply(
      [
        rule({
          variableName: 'productId',
          source: { kind: 'json-path', path: 'body[0].id' },
        }),
      ],
      context(successResult([{ id: 1 }, { id: 2 }])),
      writer,
    );
    assert.equal(report.extractedCount, 1);
    assert.equal(report.failedCount, 0);
    assert.equal(writer.writes[0]?.name, 'productId');
    assert.equal(writer.writes[0]?.value, '1');
  });

  test('TC002 — body.user.id extract succeeds', async () => {
    const writer = new RecordingWriter();
    const report = await engine.apply(
      [
        rule({
          variableName: 'userId',
          source: { kind: 'json-path', path: 'body.user.id' },
        }),
      ],
      context(successResult({ user: { id: 42 } })),
      writer,
    );
    assert.equal(report.extractedCount, 1);
    assert.equal(writer.writes[0]?.value, '42');
  });

  test('TC003 — body.data.items[0].id extract succeeds', async () => {
    const writer = new RecordingWriter();
    const report = await engine.apply(
      [
        rule({
          variableName: 'itemId',
          source: { kind: 'json-path', path: 'body.data.items[0].id' },
        }),
      ],
      context(successResult({ data: { items: [{ id: 7 }] } })),
      writer,
    );
    assert.equal(report.extractedCount, 1);
    assert.equal(writer.writes[0]?.value, '7');
  });

  test('TC004 — malformed body[ path → parse fails, no throw', () => {
    assert.doesNotThrow(() => {
      const result = parseExtractDirective({
        knownName: 'extract',
        value: 'productId from body[',
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.reason, /malformed|invalid-source/u);
      }
    });
    assert.equal(isExtractableJsonPath('body['), false);
  });

  test('TC005 — body.fake.id required miss → failed, no write', async () => {
    const writer = new RecordingWriter();
    const report = await engine.apply(
      [
        rule({
          variableName: 'missing',
          source: { kind: 'json-path', path: 'body.fake.id' },
          required: true,
        }),
      ],
      context(successResult({ real: { id: 1 } })),
      writer,
    );
    assert.equal(report.failedCount, 1);
    assert.equal(report.extractedCount, 0);
    assert.equal(writer.writes.length, 0);
    assert.equal(report.outcomes[0]?.kind, 'failed');
  });
});

describe('TC021–TC025 — extractable JSON path accept / reject', () => {
  test('TC021 — accept body[0]', () => {
    assert.equal(isExtractableJsonPath('body[0]'), true);
    const parsed = parseExtractDirective({
      knownName: 'extract',
      value: 'first from body[0]',
    });
    assert.equal(parsed.ok, true);
  });

  test('TC022 — accept body[0].id', () => {
    assert.equal(isExtractableJsonPath('body[0].id'), true);
  });

  test('TC023 — accept body.data[2].price', () => {
    assert.equal(isExtractableJsonPath('body.data[2].price'), true);
    const parsed = parseExtractDirective({
      knownName: 'extract',
      value: 'price from body.data[2].price',
    });
    assert.equal(parsed.ok, true);
  });

  test('TC024 — reject body[].', () => {
    assert.equal(isExtractableJsonPath('body[].'), false);
    const parsed = parseExtractDirective({
      knownName: 'extract',
      value: 'x from body[].',
    });
    assert.equal(parsed.ok, false);
  });

  test('TC025 — reject body[[0]]', () => {
    assert.equal(isExtractableJsonPath('body[[0]]'), false);
    const parsed = parseExtractDirective({
      knownName: 'extract',
      value: 'x from body[[0]]',
    });
    assert.equal(parsed.ok, false);
  });
});

describe('TC006–TC010, TC015–TC017 — depends-on validation + enrich + rename', () => {
  test('TC006 — manual @depends-on A on B → enrich order A then B', () => {
    const membershipPlan = plan([
      plannedRequest('b', 'B', 0),
      plannedRequest('a', 'A', 1),
    ]);
    const result = enrichRunPlanWithDependencies({
      membershipPlan,
      analyses: [
        analysis('b', [], [], ['A']),
        analysis('a'),
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.plan.requests.map((request) => request.label),
      ['A', 'B'],
    );
  });

  test('TC007 — auto: A produces productId, B consumes {{productId}} → A then B', () => {
    const membershipPlan = plan([
      plannedRequest('b', 'B', 0),
      plannedRequest('a', 'A', 1),
    ]);
    const result = enrichRunPlanWithDependencies({
      membershipPlan,
      analyses: [
        analysis('b', [], ['productId']),
        analysis('a', ['productId']),
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.plan.requests.map((request) => request.requestId),
      ['a', 'b'],
    );
    assert.equal(result.plan.extensions?.dependencies?.reordered, true);
  });

  test('TC008 — manual + auto merged; both edge kinds coexist without breaking topo', () => {
    const analyses = [
      analysis('a', ['productId']),
      analysis('b', [], ['productId'], ['A']),
    ];
    const labelByRequestId = labels([
      ['a', 'A'],
      ['b', 'B'],
    ]);
    const graph = buildDependencyGraph({ analyses, labelByRequestId });
    assert.equal(graph.ok, true);
    if (!graph.ok) return;
    const kinds = graph.graph.edges
      .filter((edge) => edge.fromRequestId === 'a' && edge.toRequestId === 'b')
      .map((edge) => edge.kind)
      .sort();
    assert.deepEqual(kinds, ['explicit', 'implicit']);

    const enriched = enrichRunPlanWithDependencies({
      membershipPlan: plan([
        plannedRequest('b', 'B', 0),
        plannedRequest('a', 'A', 1),
      ]),
      analyses,
    });
    assert.equal(enriched.ok, true);
    if (!enriched.ok) return;
    assert.deepEqual(
      enriched.plan.requests.map((request) => request.requestId),
      ['a', 'b'],
    );
  });

  test('TC009 — @depends-on Missing Request → UNKNOWN / enrich fails closed', () => {
    const graph = buildDependencyGraph({
      analyses: [analysis('b', [], [], ['Missing Request'])],
      labelByRequestId: labels([['b', 'B']]),
    });
    assert.equal(graph.ok, false);
    if (graph.ok) return;
    assert.equal(graph.code, 'UNKNOWN_DEPENDS_ON_TARGET');

    const enriched = enrichRunPlanWithDependencies({
      membershipPlan: plan([plannedRequest('b', 'B', 0)]),
      analyses: [analysis('b', [], [], ['Missing Request'])],
    });
    assert.equal(enriched.ok, false);
    if (enriched.ok) return;
    assert.equal(enriched.code, 'UNKNOWN_DEPENDS_ON_TARGET');
  });

  test('TC010 — rename Login→Authenticate rewrites dependsOn via planDependRefRewrites', () => {
    const rewrites = planDependRefRewrites({
      identity: {
        requestId: 'login',
        oldName: 'Login',
        oldFolderPath: '',
        newName: 'Authenticate',
      },
      catalogBefore: [
        { requestId: 'login', name: 'Login', folderPath: '' },
        { requestId: 'products', name: 'Products', folderPath: '' },
      ],
      catalogAfter: [
        { requestId: 'login', name: 'Authenticate', folderPath: '' },
        { requestId: 'products', name: 'Products', folderPath: '' },
      ],
      documents: [
        {
          filePath: '/ws/products.api',
          requestId: 'products',
          dependsOn: ['Login'],
        },
      ],
    });
    assert.deepEqual(rewrites, [
      {
        filePath: '/ws/products.api',
        requestId: 'products',
        dependsOn: ['Authenticate'],
      },
    ]);
  });

  test('TC015 — depends-on token that looks like a variable → UNKNOWN (not silent success)', () => {
    for (const token of ['productId', '@productId'] as const) {
      const parsed = parseDependsOnDirective(token);
      assert.equal(parsed.ok, true);
      if (!parsed.ok) continue;
      const graph = buildDependencyGraph({
        analyses: [
          analysis('a', ['productId']),
          analysis('b', [], [], parsed.names),
        ],
        labelByRequestId: labels([
          ['a', 'List Products'],
          ['b', 'Product Detail'],
        ]),
      });
      assert.equal(graph.ok, false);
      if (graph.ok) continue;
      assert.equal(graph.code, 'UNKNOWN_DEPENDS_ON_TARGET');
      assert.match(graph.message, /productId/u);
    }
  });

  test('TC016 — directive-like garbage in depends-on → parse fail or unknown', () => {
    const invalidSlash = parseDependsOnDirective('/Login');
    assert.equal(invalidSlash.ok, false);

    const emptySeg = parseDependsOnDirective('Login, , Products');
    assert.equal(emptySeg.ok, false);

    const pasted = parseDependsOnDirective('@extract productId from body[0].id');
    assert.equal(pasted.ok, true);
    if (!pasted.ok) return;
    const graph = buildDependencyGraph({
      analyses: [analysis('b', [], [], pasted.names)],
      labelByRequestId: labels([['b', 'B']]),
    });
    assert.equal(graph.ok, false);
    if (!graph.ok) {
      assert.equal(graph.code, 'UNKNOWN_DEPENDS_ON_TARGET');
    }
  });

  test('TC017 — @depends-on Login, Products where Products missing → unknown target', () => {
    const parsed = parseDependsOnDirective('Login, Products');
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const graph = buildDependencyGraph({
      analyses: [
        analysis('login'),
        analysis('invoice', [], [], parsed.names),
      ],
      labelByRequestId: labels([
        ['login', 'Login'],
        ['invoice', 'Invoice'],
      ]),
    });
    assert.equal(graph.ok, false);
    if (!graph.ok) {
      assert.equal(graph.code, 'UNKNOWN_DEPENDS_ON_TARGET');
      assert.match(graph.message, /Products/u);
    }
  });
});

describe('TC011–TC013, TC029–TC031 — autofill projection + serialize / pin', () => {
  test('TC011 — B consumes productId, A extracts → projection.auto includes A for B', () => {
    const analyses = [
      analysis('a', ['productId']),
      analysis('b', [], ['productId']),
    ];
    const labelByRequestId = labels([
      ['a', 'A'],
      ['b', 'B'],
    ]);
    const graph = buildDependencyGraph({ analyses, labelByRequestId });
    assert.equal(graph.ok, true);
    if (!graph.ok) return;

    const projection = projectVariableDependencies({
      analyses,
      labelByRequestId,
      focusRequestId: 'b',
    });
    assert.equal(isProjectionFailure(projection), false);
    if (isProjectionFailure(projection)) return;
    assert.deepEqual(projection.graphEdges, graph.graph.edges);
    assert.equal(projection.auto.length, 1);
    assert.equal(projection.auto[0]?.dependRef, 'A');
    assert.deepEqual(projection.auto[0]?.variables, ['productId']);
  });

  test('TC012 — multiple producers → ambiguousProducers listed; all edges kept (Q1 A)', () => {
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
    assert.equal(projection.ambiguousProducers.length, 1);
    assert.equal(projection.ambiguousProducers[0]?.variable, 'token');
    assert.deepEqual(
      projection.ambiguousProducers[0]?.producers.map((p) => p.dependRef).sort(),
      ['A', 'B'],
    );
  });

  test('TC013 — unknown var → unknownVariables; static + ignored filtered', () => {
    const projection = projectVariableDependencies({
      analyses: [
        analysis('products', [], ['accessToken', 'host', 'region', 'noise']),
      ],
      labelByRequestId: labels([['products', 'Products']]),
      focusRequestId: 'products',
      staticVariableNames: new Set(['host', 'region']),
      ignoredVariableNames: new Set(['noise']),
    });
    assert.equal(isProjectionFailure(projection), false);
    if (isProjectionFailure(projection)) return;
    assert.deepEqual(projection.unknownVariables, ['accessToken']);
    // PARTIAL: Create Extract / Create Variable suggestions are UI-only.
  });

  test('TC029 — Auto never in serializeRequestDocument', () => {
    const projection = projectVariableDependencies({
      analyses: [
        analysis('login', ['accessToken']),
        analysis('products', [], ['accessToken']),
      ],
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

    // Projection Auto is not a document field — only authored dependsOn serializes.
    const source = serializeRequestDocument({
      name: 'Products',
      method: 'GET',
      url: 'https://example.test/{{accessToken}}',
      dependsOn: [],
    });
    assert.doesNotMatch(source, /@depends-on/u);
    assert.doesNotMatch(source, /Login/u);
    assert.match(source, /\{\{accessToken\}\}/u);
  });

  test('TC030 — Manual serializes @depends-on', () => {
    const source = serializeRequestDocument({
      name: 'Products',
      method: 'GET',
      url: 'https://example.test/products',
      dependsOn: ['Login'],
    });
    assert.match(source, /@depends-on Login\n/u);
  });

  test('TC031 — Pin = dependsOn array gets ref → serialize contains it', () => {
    const projection = projectVariableDependencies({
      analyses: [
        analysis('login', ['accessToken']),
        analysis('products', [], ['accessToken']),
      ],
      labelByRequestId: labels([
        ['login', 'Login'],
        ['products', 'Products'],
      ]),
      focusRequestId: 'products',
    });
    assert.equal(isProjectionFailure(projection), false);
    if (isProjectionFailure(projection)) return;
    const pinned = projection.auto[0]?.dependRef;
    assert.equal(pinned, 'Login');

    const source = serializeRequestDocument({
      name: 'Products',
      method: 'GET',
      url: 'https://example.test/products',
      dependsOn: [pinned!],
    });
    assert.match(source, /@depends-on Login\n/u);
  });
});

describe('TC026–TC028 — graph enrich / cycle / mixed topo', () => {
  test('TC026 — A→B→C→D enrich executionOrder labels', () => {
    const result = enrichRunPlanWithDependencies({
      membershipPlan: plan([
        plannedRequest('d', 'D', 0),
        plannedRequest('c', 'C', 1),
        plannedRequest('b', 'B', 2),
        plannedRequest('a', 'A', 3),
      ]),
      analyses: [
        analysis('a', ['v1']),
        analysis('b', ['v2'], ['v1']),
        analysis('c', ['v3'], ['v2']),
        analysis('d', [], ['v3']),
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.extensions?.dependencies?.executionOrder, [
      'a',
      'b',
      'c',
      'd',
    ]);
    assert.deepEqual(
      result.plan.requests.map((request) => request.label),
      ['A', 'B', 'C', 'D'],
    );
  });

  test('TC027 — cycle A↔B → DEPENDENCY_CYCLE', () => {
    const result = enrichRunPlanWithDependencies({
      membershipPlan: plan([
        plannedRequest('a', 'A', 0),
        plannedRequest('b', 'B', 1),
      ]),
      analyses: [
        analysis('a', [], [], ['B']),
        analysis('b', [], [], ['A']),
      ],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'DEPENDENCY_CYCLE');
    assert.match(result.message, /A → B → A|B → A → B/);
  });

  test('TC028 — mixed manual+auto topo still valid', () => {
    const result = enrichRunPlanWithDependencies({
      membershipPlan: plan([
        plannedRequest('c', 'C', 0),
        plannedRequest('b', 'B', 1),
        plannedRequest('a', 'A', 2),
      ]),
      analyses: [
        analysis('a', ['token']),
        analysis('b', ['other'], ['token'], ['A']),
        analysis('c', [], ['other']),
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.plan.requests.map((request) => request.requestId),
      ['a', 'b', 'c'],
    );
  });
});

describe('TC032–TC035 — request editor HTML (string assertions only)', () => {
  const html = renderRequestEditorHtml('regression-nonce');

  test('TC032 — Auto list present', () => {
    assert.match(html, /data-testid="auto-dependencies"/u);
    assert.match(html, /data-testid="execution-status"/u);
    assert.match(html, /id="autoDependenciesSection"/u);
    assert.match(html, /id="dependenciesInfoBtn"/u);
    assert.match(html, /Automatically detected/u);
  });

  test('TC033 — Manual picker present', () => {
    assert.match(html, /data-testid="depends-on-picker"/u);
    assert.match(html, /id="manualDependenciesSection"/u);
    assert.match(html, /id="pinnedLabel"/u);
    assert.match(html, /id="dependsOnAddBtn"/u);
    assert.match(html, /\+ Add Dependency/u);
  });

  test('TC034 — Unknown list present (Create Extract suggestions PARTIAL)', () => {
    assert.match(html, /data-testid="unknown-variables"/u);
    assert.match(html, /id="unknownVariablesSection"/u);
  });

  test('TC035 — Ambiguous list + pinAutoDependency present', () => {
    assert.match(html, /data-testid="ambiguous-producers"/u);
    assert.match(html, /id="ambiguousProducersSection"/u);
    assert.match(html, /pinAutoDependency/u);
  });
});

describe('TC036–TC038 — performance / cache smoke', () => {
  test('TC036 — projectVariableDependencies for ~80 analyses succeeds with expected Auto edge', () => {
    const analyses: RequestDependencyAnalysis[] = [];
    const labelEntries: [string, string][] = [];
    for (let i = 0; i < 80; i += 1) {
      const id = `r${i}`;
      labelEntries.push([id, `Request ${i}`]);
      if (i === 0) {
        analyses.push(analysis(id, [`v${i}`]));
      } else {
        analyses.push(analysis(id, [`v${i}`], [`v${i - 1}`]));
      }
    }
    const labelByRequestId = labels(labelEntries);
    const projection = projectVariableDependencies({
      analyses,
      labelByRequestId,
      focusRequestId: 'r79',
    });
    assert.equal(isProjectionFailure(projection), false);
    if (isProjectionFailure(projection)) return;
    assert.equal(projection.auto.length, 1);
    assert.equal(projection.auto[0]?.dependRef, 'Request 78');
    assert.deepEqual(projection.auto[0]?.variables, ['v78']);
  });

  test('TC037 — rename cascade plan for ~40 dependents returns without throw', () => {
    const catalogBefore = [
      { requestId: 'login', name: 'Login', folderPath: '' },
      ...Array.from({ length: 40 }, (_, i) => ({
        requestId: `d${i}`,
        name: `Dep ${i}`,
        folderPath: '',
      })),
    ];
    const catalogAfter = [
      { requestId: 'login', name: 'Authenticate', folderPath: '' },
      ...catalogBefore.slice(1),
    ];
    const documents = catalogBefore.slice(1).map((entry) => ({
      filePath: `/ws/${entry.requestId}.api`,
      requestId: entry.requestId,
      dependsOn: ['Login'],
    }));

    assert.doesNotThrow(() => {
      const rewrites = planDependRefRewrites({
        identity: {
          requestId: 'login',
          oldName: 'Login',
          oldFolderPath: '',
          newName: 'Authenticate',
        },
        catalogBefore,
        catalogAfter,
        documents,
      });
      assert.equal(rewrites.length, 40);
      assert.equal(rewrites[0]?.dependsOn[0], 'Authenticate');
    });
  });

  test('TC038 — analyzeCollectionDependencies twice with cache — size stable', async () => {
    const cache = new Map();
    const text =
      '@name Login\n@extract accessToken from body.token\nPOST https://example.test/login\n';
    const fingerprint = contentFingerprint(text);
    const readText = async () => text;

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
    assert.equal(cache.size, 1);
    assert.deepEqual(again[0]?.produces, ['accessToken']);
  });
});
