/**
 * Phase 2 (PR5) integration coverage: `CollectionRunnerService.execute`
 * wired to a real `CollectionRunVariableContext` + `CompositeVariableWriter`,
 * exercising per-run store isolation, run-scope extract propagation across
 * requests in one run, dependent skip on upstream failure, and cleanup on
 * cancellation. Uses a fake executor — no `vscode` import.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CompositeVariableWriter, InMemoryRuntimeVariableOverlay } from '../extraction';
import type { ExtractionReport } from '../extraction';
import type { VariableWriter } from '../extraction/variable-writer';
import { NoOpVariableWriter } from '../extraction/variable-writer';
import type {
  RunAtSourceLocationResult,
  RunRequestSource,
} from '../orchestration';
import { InMemoryRunVariableStore } from '../variables';
import {
  CollectionRunnerService,
  createCollectionRunVariableContext,
  freezeRunPlan,
  type CollectionRequestExecutorPort,
  type CollectionRunSourceReader,
  type CollectionRunVariableContext,
  type PlannedRequest,
  type RunPlan,
} from './index';

const LOGIN_PATH = 'file:///collections/checkout/login.api';
const PRODUCTS_PATH = 'file:///collections/checkout/products.api';
const COLLECTION_ROOT = 'file:///collections/checkout';
const COLLECTION_ID = 'collection:collections/checkout';

class FakeSourceReader implements CollectionRunSourceReader {
  public async readText(): Promise<string> {
    return 'GET https://example.test\n';
  }
}

function loginThenProductsPlan(runId: string): RunPlan {
  const login: PlannedRequest = {
    requestId: 'login',
    collectionId: COLLECTION_ID,
    filePath: LOGIN_PATH,
    offset: 0,
    label: 'Login',
    method: 'POST',
    url: 'https://example.test/login',
    ordinal: 0,
    produces: ['accessToken'],
    consumes: [],
  };
  const products: PlannedRequest = {
    requestId: 'products',
    collectionId: COLLECTION_ID,
    filePath: PRODUCTS_PATH,
    offset: 0,
    label: 'Products',
    method: 'GET',
    url: 'https://example.test/products',
    ordinal: 1,
    produces: [],
    consumes: ['accessToken'],
  };
  return freezeRunPlan({
    runId,
    mode: 'collection',
    collectionId: COLLECTION_ID,
    collectionName: 'Checkout',
    failurePolicy: 'continue-on-error',
    requests: [login, products],
    createdAt: new Date(0).toISOString(),
    extensions: {
      dependencies: {
        nodes: [
          { requestId: 'login', produces: ['accessToken'], consumes: [], dependsOnNames: [] },
          { requestId: 'products', produces: [], consumes: ['accessToken'], dependsOnNames: [] },
        ],
        edges: [
          {
            fromRequestId: 'login',
            toRequestId: 'products',
            kind: 'implicit',
            variable: 'accessToken',
          },
        ],
        reordered: false,
        originalOrder: ['login', 'products'],
        executionOrder: ['login', 'products'],
        cycles: [],
        unresolvedConsumes: [],
      },
    },
  });
}

/** Simulates the orchestrator: Login writes `accessToken` (scope=run) via the
 * composite writer; Products reads it back through the active run store. */
class LoginProductsExecutor implements CollectionRequestExecutorPort {
  public readonly loginOutcome: 'success' | 'failed';
  public constructor(
    private readonly writer: VariableWriter,
    private readonly context: CollectionRunVariableContext,
    options: { readonly loginOutcome?: 'success' | 'failed' } = {},
  ) {
    this.loginOutcome = options.loginOutcome ?? 'success';
  }

  public async runAtSourceLocation(
    source: RunRequestSource,
  ): Promise<RunAtSourceLocationResult> {
    if (source.sourceId === LOGIN_PATH) {
      if (this.loginOutcome === 'failed') {
        return { outcome: 'failed', durationMs: 4, statusCode: 500 };
      }
      await this.writer.write({
        name: 'accessToken',
        value: 'tok-123',
        scope: 'run',
        sensitive: false,
      });
      const extraction: ExtractionReport = {
        outcomes: [
          {
            rule: {
              id: 'e1',
              variableName: 'accessToken',
              source: { kind: 'status' },
              targetScope: 'run',
              sensitive: false,
              required: false,
              enabled: true,
              when: { kind: 'always' },
            },
            kind: 'extracted',
          },
        ],
        extractedCount: 1,
        failedCount: 0,
        skippedCount: 0,
        malformedCount: 0,
      };
      return { outcome: 'success', durationMs: 5, statusCode: 200, extraction };
    }
    if (source.sourceId === PRODUCTS_PATH) {
      // Resolve like extension.ts: active collection-run store, not session.
      const token = this.context
        .getRunStore()
        ?.toDefinitions()
        .find((definition) => definition.name === 'accessToken')?.value;
      return token === undefined
        ? { outcome: 'failed', durationMs: 3, statusCode: 401 }
        : { outcome: 'success', durationMs: 3, statusCode: 200 };
    }
    return { outcome: 'failed' };
  }
}

describe('Collection Runner integration (PR5 context + writer wiring)', () => {
  test('per-run store isolation: run-scope extracts land in the active run store, not the session store', async () => {
    const collectionRunContext = createCollectionRunVariableContext();
    const sessionRunStore = new InMemoryRunVariableStore();
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: sessionRunStore,
      environment: new NoOpVariableWriter(),
      resolveRunStore: () => collectionRunContext.getRunStore(),
    });
    const runVariableStore = new InMemoryRunVariableStore();
    const plan = loginThenProductsPlan('run_login_products');

    collectionRunContext.begin({
      runId: plan.runId,
      collectionId: plan.collectionId,
      collectionRootPath: COLLECTION_ROOT,
      runStore: runVariableStore,
    });
    const runner = new CollectionRunnerService({
      executor: new LoginProductsExecutor(writer, collectionRunContext),
      sourceReader: new FakeSourceReader(),
    });
    try {
      const summary = await runner.execute({ plan, runVariableStore });

      assert.equal(summary.results[0]?.outcome, 'passed');
      assert.deepEqual(summary.results[0]?.producedVariables, ['accessToken']);
      assert.equal(summary.results[1]?.outcome, 'passed');

      // Isolation: the write landed in the per-run store, never the session
      // store used for single-request runs.
      assert.equal(sessionRunStore.toDefinitions().length, 0);
      assert.deepEqual(runVariableStore.toDefinitions(), [
        { name: 'accessToken', value: 'tok-123', scope: 'run', sensitive: false },
      ]);
    } finally {
      runVariableStore.clear();
      collectionRunContext.end(plan.runId);
    }

    assert.equal(collectionRunContext.isActive(), false);
    assert.equal(runVariableStore.toDefinitions().length, 0);
  });

  test('skips a dependent request when its upstream producer failed, with a clear reason', async () => {
    const collectionRunContext = createCollectionRunVariableContext();
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: new InMemoryRunVariableStore(),
      environment: new NoOpVariableWriter(),
      resolveRunStore: () => collectionRunContext.getRunStore(),
    });
    const runVariableStore = new InMemoryRunVariableStore();
    const plan = loginThenProductsPlan('run_login_failed');

    collectionRunContext.begin({
      runId: plan.runId,
      collectionId: plan.collectionId,
      collectionRootPath: COLLECTION_ROOT,
      runStore: runVariableStore,
    });
    const runner = new CollectionRunnerService({
      executor: new LoginProductsExecutor(writer, collectionRunContext, {
        loginOutcome: 'failed',
      }),
      sourceReader: new FakeSourceReader(),
    });
    try {
      const summary = await runner.execute({ plan, runVariableStore });

      assert.equal(summary.results[0]?.outcome, 'failed');
      assert.equal(summary.results[1]?.outcome, 'skipped');
      assert.equal(
        summary.results[1]?.skipReason,
        'Missing run variable: accessToken (producer Login failed)',
      );
    } finally {
      runVariableStore.clear();
      collectionRunContext.end(plan.runId);
    }
  });

  test('a static definition (env/collection/workspace/global) prevents the dependency skip even when the run store is empty after a failed producer (§6.7)', async () => {
    const collectionRunContext = createCollectionRunVariableContext();
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: new InMemoryRunVariableStore(),
      environment: new NoOpVariableWriter(),
      resolveRunStore: () => collectionRunContext.getRunStore(),
    });
    const runVariableStore = new InMemoryRunVariableStore();
    const plan = loginThenProductsPlan('run_login_failed_static_override');

    collectionRunContext.begin({
      runId: plan.runId,
      collectionId: plan.collectionId,
      collectionRootPath: COLLECTION_ROOT,
      runStore: runVariableStore,
    });
    const runner = new CollectionRunnerService({
      executor: new LoginProductsExecutor(writer, collectionRunContext, {
        loginOutcome: 'failed',
      }),
      sourceReader: new FakeSourceReader(),
    });
    try {
      const summary = await runner.execute({
        plan,
        runVariableStore,
        // Simulates an environment-scope `accessToken` still satisfying the
        // request even though the producer failed and the run store is empty.
        staticVariableNames: () => new Set(['accessToken']),
      });

      assert.equal(summary.results[0]?.outcome, 'failed');
      // Not skipped: the static definition means resolution can still fall
      // through to it, so pre-flight must not pre-emptively skip.
      assert.notEqual(summary.results[1]?.outcome, 'skipped');
    } finally {
      runVariableStore.clear();
      collectionRunContext.end(plan.runId);
    }
  });

  test('cleanup on cancellation: the run store is cleared and the context deactivated even when aborted mid-flight', async () => {
    const collectionRunContext = createCollectionRunVariableContext();
    const runVariableStore = new InMemoryRunVariableStore();
    runVariableStore.set('leftoverFromPreviousWrite', 'should-not-survive');
    const plan = loginThenProductsPlan('run_cancelled');
    const controller = new AbortController();

    collectionRunContext.begin({
      runId: plan.runId,
      collectionId: plan.collectionId,
      collectionRootPath: COLLECTION_ROOT,
      runStore: runVariableStore,
    });

    const hangingExecutor: CollectionRequestExecutorPort = {
      runAtSourceLocation: async (_source, options) =>
        new Promise<RunAtSourceLocationResult>((resolve) => {
          const signal = options?.signal;
          if (signal?.aborted) {
            resolve({ outcome: 'cancelled', durationMs: 1 });
            return;
          }
          signal?.addEventListener(
            'abort',
            () => resolve({ outcome: 'cancelled', durationMs: 1 }),
            { once: true },
          );
        }),
    };
    const runner = new CollectionRunnerService({
      executor: hangingExecutor,
      sourceReader: new FakeSourceReader(),
    });

    try {
      const pending = runner.execute({
        plan,
        signal: controller.signal,
        runVariableStore,
      });
      await Promise.resolve();
      await Promise.resolve();
      controller.abort('cancelled');
      const summary = await pending;
      assert.equal(summary.status, 'cancelled');
    } finally {
      // Mirrors register-collection-runner.ts's finally block (§5.4, §13).
      runVariableStore.clear();
      collectionRunContext.end(plan.runId);
    }

    assert.equal(collectionRunContext.isActive(), false);
    assert.equal(collectionRunContext.getRunStore(), undefined);
    assert.equal(runVariableStore.toDefinitions().length, 0);
  });
});
