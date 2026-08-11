/**
 * Collection runner regression: FakeStore chaining (mocked transport) +
 * variable resolver / run-store parity (TC014, TC018–TC020).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  analyzeProducesConsumesForDocument,
  enrichRunPlanWithDependencies,
  isProjectionFailure,
  projectVariableDependencies,
  type RequestDependencyAnalysis,
} from '../dependencies';
import {
  CompositeVariableWriter,
  DefaultExtractionEngine,
  InMemoryRuntimeVariableOverlay,
  type ExtractionReport,
  type VariableWriter,
} from '../extraction';
import { NoOpVariableWriter } from '../extraction/variable-writer';
import type {
  RunAtSourceLocationResult,
  RunRequestSource,
} from '../orchestration';
import { parseApiDocument } from '../parser';
import { freezeDetachedBytes } from '../shared';
import {
  DefaultVariableResolver,
  InMemoryRunVariableStore,
} from '../variables';
import {
  CollectionRunnerService,
  createCollectionRunVariableContext,
  freezeRunPlan,
  type CollectionRequestExecutorPort,
  type CollectionRunSourceReader,
  type CollectionRunVariableContext,
  type PlannedRequest,
  type RunPlan,
} from '../collection-runner';

const PRODUCTS_PATH = 'file:///collections/fakestore/products.api';
const DETAIL_PATH = 'file:///collections/fakestore/product-detail.api';
const COLLECTION_ROOT = 'file:///collections/fakestore';
const COLLECTION_ID = 'collection:collections/fakestore';

const PRODUCTS_SOURCE = [
  '@name List Products',
  '@extract productId from body[0].id',
  'GET https://fakestore.example/products',
  '',
].join('\n');

const DETAIL_SOURCE = [
  '@name Product Detail',
  'GET https://fakestore.example/products/{{productId}}',
  '',
].join('\n');

const TIMING = Object.freeze({
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:00.001Z',
  durationMs: 1,
});

class FakeSourceReader implements CollectionRunSourceReader {
  public async readText(filePath: string): Promise<string> {
    if (filePath === PRODUCTS_PATH) {
      return PRODUCTS_SOURCE;
    }
    if (filePath === DETAIL_PATH) {
      return DETAIL_SOURCE;
    }
    return 'GET https://example.test\n';
  }
}

function analyzeDoc(
  text: string,
  requestId: string,
  sourceId: string,
): RequestDependencyAnalysis {
  const document = parseApiDocument(text, { sourceId }).ast;
  return analyzeProducesConsumesForDocument(document, text, 0, requestId);
}

function membershipPlanUnordered(): RunPlan {
  const detail: PlannedRequest = {
    requestId: 'detail',
    collectionId: COLLECTION_ID,
    filePath: DETAIL_PATH,
    offset: 0,
    label: 'Product Detail',
    method: 'GET',
    url: 'https://fakestore.example/products/{{productId}}',
    ordinal: 0,
  };
  const products: PlannedRequest = {
    requestId: 'products',
    collectionId: COLLECTION_ID,
    filePath: PRODUCTS_PATH,
    offset: 0,
    label: 'List Products',
    method: 'GET',
    url: 'https://fakestore.example/products',
    ordinal: 1,
  };
  return freezeRunPlan({
    runId: 'run_fakestore',
    mode: 'collection',
    collectionId: COLLECTION_ID,
    collectionName: 'FakeStore',
    failurePolicy: 'continue-on-error',
    requests: [detail, products],
    createdAt: new Date(0).toISOString(),
  });
}

/**
 * Fake transport: products list returns `[{id:5,...}]`; detail returns a
 * product object. Uses real {@link DefaultExtractionEngine} for extract.
 */
class FakeStoreExecutor implements CollectionRequestExecutorPort {
  public readonly executionOrder: string[] = [];
  public detailResolvedUrl: string | undefined;
  public productIdBeforeDetail: string | undefined;

  public constructor(
    private readonly writer: VariableWriter,
    private readonly context: CollectionRunVariableContext,
  ) {}

  public async runAtSourceLocation(
    source: RunRequestSource,
  ): Promise<RunAtSourceLocationResult> {
    const engine = new DefaultExtractionEngine();

    if (source.sourceId === PRODUCTS_PATH) {
      this.executionOrder.push('products');
      const result = {
        success: true as const,
        requestId: 'products',
        response: {
          requestId: 'products',
          statusCode: 200,
          statusText: 'OK',
          headers: [],
          body: {
            bytes: freezeDetachedBytes(new Uint8Array(0)),
            json: [
              { id: 5, title: 'Fjallraven', price: 109.95 },
              { id: 6, title: 'Mens Casual', price: 22.3 },
            ] as never,
          },
          bodySizeBytes: 0,
          contentType: 'application/json',
          url: 'https://fakestore.example/products',
          redirected: false,
          redirectCount: 0,
          timing: TIMING,
        },
        timing: TIMING,
      };
      const extraction = await engine.apply(
        [
          {
            id: 'extract_productId',
            variableName: 'productId',
            source: { kind: 'json-path', path: 'body[0].id' },
            targetScope: 'run',
            sensitive: false,
            required: true,
            enabled: true,
            when: { kind: 'always' },
          },
        ],
        { result, requestKey: 'request:products#0' },
        this.writer,
      );
      return {
        outcome: 'success',
        durationMs: 5,
        statusCode: 200,
        extraction,
      };
    }

    if (source.sourceId === DETAIL_PATH) {
      this.executionOrder.push('detail');
      const productId = this.context
        .getRunStore()
        ?.toDefinitions()
        .find((definition) => definition.name === 'productId')?.value;
      this.productIdBeforeDetail = productId;
      this.detailResolvedUrl =
        productId === undefined
          ? 'https://fakestore.example/products/{{productId}}'
          : `https://fakestore.example/products/${productId}`;

      if (productId === undefined) {
        return { outcome: 'failed', durationMs: 3, statusCode: 400 };
      }

      const extraction: ExtractionReport = {
        outcomes: [],
        extractedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        malformedCount: 0,
      };
      return {
        outcome: 'success',
        durationMs: 3,
        statusCode: 200,
        extraction,
      };
    }

    return { outcome: 'failed' };
  }
}

describe('TC014 — FakeStore flow (mocked)', () => {
  test('TC014 — analyze+enrich+run: R1→R2, extract productId, store before R2', async () => {
    const productsAnalysis = analyzeDoc(
      PRODUCTS_SOURCE,
      'products',
      PRODUCTS_PATH,
    );
    const detailAnalysis = analyzeDoc(DETAIL_SOURCE, 'detail', DETAIL_PATH);
    assert.deepEqual(productsAnalysis.produces, ['productId']);
    assert.ok(detailAnalysis.consumes.includes('productId'));

    const enriched = enrichRunPlanWithDependencies({
      membershipPlan: membershipPlanUnordered(),
      analyses: [productsAnalysis, detailAnalysis],
    });
    assert.equal(enriched.ok, true);
    if (!enriched.ok) return;
    assert.deepEqual(
      enriched.plan.requests.map((request) => request.requestId),
      ['products', 'detail'],
    );

    const collectionRunContext = createCollectionRunVariableContext();
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: new InMemoryRunVariableStore(),
      environment: new NoOpVariableWriter(),
      resolveRunStore: () => collectionRunContext.getRunStore(),
    });
    const runVariableStore = new InMemoryRunVariableStore();
    const executor = new FakeStoreExecutor(writer, collectionRunContext);
    const runner = new CollectionRunnerService({
      executor,
      sourceReader: new FakeSourceReader(),
    });

    collectionRunContext.begin({
      runId: enriched.plan.runId,
      collectionId: enriched.plan.collectionId,
      collectionRootPath: COLLECTION_ROOT,
      runStore: runVariableStore,
    });
    try {
      const summary = await runner.execute({
        plan: enriched.plan,
        runVariableStore,
      });

      assert.deepEqual(executor.executionOrder, ['products', 'detail']);
      assert.equal(summary.results[0]?.outcome, 'passed');
      assert.deepEqual(summary.results[0]?.producedVariables, ['productId']);
      assert.equal(summary.results[1]?.outcome, 'passed');
      assert.equal(executor.productIdBeforeDetail, '5');
      assert.equal(runVariableStore.get('productId')?.value, '5');
      assert.deepEqual(runVariableStore.toDefinitions(), [
        {
          name: 'productId',
          value: '5',
          scope: 'run',
          sensitive: false,
        },
      ]);
    } finally {
      runVariableStore.clear();
      collectionRunContext.end(enriched.plan.runId);
    }
  });
});

describe('TC018–TC020 — variables parity', () => {
  const resolver = new DefaultVariableResolver();

  test('TC018 — global baseUrl resolves; static scopes never create Auto edges', () => {
    const analysis = resolver.analyze({
      definitions: [
        {
          name: 'baseUrl',
          value: 'https://api.example.test',
          scope: 'global',
          sensitive: false,
        },
      ],
    });
    assert.equal(
      analysis.values.get('baseUrl')?.value,
      'https://api.example.test',
    );
    assert.equal(analysis.values.get('baseUrl')?.scope, 'global');

    const staticVariableNames = new Set(['baseUrl']);
    assert.ok(staticVariableNames.has('baseUrl'));

    // Consumer of {{baseUrl}} alone: no extract producer → no Auto edge;
    // static name filtered from Unknown (Q2 / RULE 10).
    const projection = projectVariableDependencies({
      analyses: [
        {
          requestId: 'products',
          produces: [],
          consumes: ['baseUrl'],
          dependsOnNames: [],
        },
      ],
      labelByRequestId: new Map([['products', 'Products']]),
      focusRequestId: 'products',
      staticVariableNames,
    });
    assert.equal(isProjectionFailure(projection), false);
    if (isProjectionFailure(projection)) return;
    assert.deepEqual(projection.auto, []);
    assert.deepEqual(projection.unknownVariables, []);
  });

  test('TC019 — after producer extract, run store has productId for consumer', async () => {
    const collectionRunContext = createCollectionRunVariableContext();
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: new InMemoryRunVariableStore(),
      environment: new NoOpVariableWriter(),
      resolveRunStore: () => collectionRunContext.getRunStore(),
    });
    const runVariableStore = new InMemoryRunVariableStore();
    const executor = new FakeStoreExecutor(writer, collectionRunContext);

    const productsAnalysis = analyzeDoc(
      PRODUCTS_SOURCE,
      'products',
      PRODUCTS_PATH,
    );
    const detailAnalysis = analyzeDoc(DETAIL_SOURCE, 'detail', DETAIL_PATH);
    const enriched = enrichRunPlanWithDependencies({
      membershipPlan: membershipPlanUnordered(),
      analyses: [productsAnalysis, detailAnalysis],
    });
    assert.equal(enriched.ok, true);
    if (!enriched.ok) return;

    collectionRunContext.begin({
      runId: enriched.plan.runId,
      collectionId: enriched.plan.collectionId,
      collectionRootPath: COLLECTION_ROOT,
      runStore: runVariableStore,
    });
    try {
      await new CollectionRunnerService({
        executor,
        sourceReader: new FakeSourceReader(),
      }).execute({ plan: enriched.plan, runVariableStore });

      assert.equal(
        runVariableStore
          .toDefinitions()
          .find((definition) => definition.name === 'productId')?.value,
        '5',
      );
      assert.equal(executor.productIdBeforeDetail, '5');
    } finally {
      runVariableStore.clear();
      collectionRunContext.end(enriched.plan.runId);
    }
  });

  test('TC020 — env overrides global in DefaultVariableResolver', () => {
    const analysis = resolver.analyze({
      definitions: [
        {
          name: 'baseUrl',
          value: 'https://global.example',
          scope: 'global',
          sensitive: false,
        },
        {
          name: 'baseUrl',
          value: 'https://env.example',
          scope: 'environment',
          sensitive: false,
        },
      ],
    });
    assert.equal(analysis.values.get('baseUrl')?.value, 'https://env.example');
    assert.equal(analysis.values.get('baseUrl')?.scope, 'environment');
  });
});

// --- A→B→C Login → Get User → Get Orders (TC039–TC041) ---

const LOGIN_PATH = 'file:///collections/checkout/login.api';
const GET_USER_PATH = 'file:///collections/checkout/get-user.api';
const GET_ORDERS_PATH = 'file:///collections/checkout/get-orders.api';
const CHECKOUT_ROOT = 'file:///collections/checkout';
const CHECKOUT_ID = 'collection:collections/checkout';

const LOGIN_SOURCE = [
  '@name Login',
  '@extract token from body.access_token',
  'POST https://checkout.example/login',
  '',
].join('\n');

const GET_USER_SOURCE = [
  '@name Get User',
  '@extract userId from body.id',
  'GET https://checkout.example/me',
  'Authorization: Bearer {{token}}',
  '',
].join('\n');

const GET_ORDERS_SOURCE = [
  '@name Get Orders',
  'GET https://checkout.example/users/{{userId}}/orders',
  '',
].join('\n');

class CheckoutSourceReader implements CollectionRunSourceReader {
  public async readText(filePath: string): Promise<string> {
    if (filePath === LOGIN_PATH) {
      return LOGIN_SOURCE;
    }
    if (filePath === GET_USER_PATH) {
      return GET_USER_SOURCE;
    }
    if (filePath === GET_ORDERS_PATH) {
      return GET_ORDERS_SOURCE;
    }
    return 'GET https://example.test\n';
  }
}

/** Membership order C, B, A — enrich must reorder to Login → Get User → Get Orders. */
function checkoutMembershipPlanCBA(runId: string): RunPlan {
  const orders: PlannedRequest = {
    requestId: 'orders',
    collectionId: CHECKOUT_ID,
    filePath: GET_ORDERS_PATH,
    offset: 0,
    label: 'Get Orders',
    method: 'GET',
    url: 'https://checkout.example/users/{{userId}}/orders',
    ordinal: 0,
  };
  const getUser: PlannedRequest = {
    requestId: 'getUser',
    collectionId: CHECKOUT_ID,
    filePath: GET_USER_PATH,
    offset: 0,
    label: 'Get User',
    method: 'GET',
    url: 'https://checkout.example/me',
    ordinal: 1,
  };
  const login: PlannedRequest = {
    requestId: 'login',
    collectionId: CHECKOUT_ID,
    filePath: LOGIN_PATH,
    offset: 0,
    label: 'Login',
    method: 'POST',
    url: 'https://checkout.example/login',
    ordinal: 2,
  };
  return freezeRunPlan({
    runId,
    mode: 'collection',
    collectionId: CHECKOUT_ID,
    collectionName: 'Checkout',
    failurePolicy: 'continue-on-error',
    requests: [orders, getUser, login],
    createdAt: new Date(0).toISOString(),
  });
}

/**
 * Fake transport for Login → Get User → Get Orders. Reads run-store token /
 * userId the same way FakeStoreExecutor reads productId.
 */
class LoginGetUserOrdersExecutor implements CollectionRequestExecutorPort {
  public readonly executionOrder: string[] = [];
  public tokenBeforeGetUser: string | undefined;
  public userIdBeforeOrders: string | undefined;
  public loginOutcome: 'success' | 'failed';

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
    const engine = new DefaultExtractionEngine();

    if (source.sourceId === LOGIN_PATH) {
      this.executionOrder.push('login');
      if (this.loginOutcome === 'failed') {
        return { outcome: 'failed', durationMs: 4, statusCode: 500 };
      }
      const result = {
        success: true as const,
        requestId: 'login',
        response: {
          requestId: 'login',
          statusCode: 200,
          statusText: 'OK',
          headers: [],
          body: {
            bytes: freezeDetachedBytes(new Uint8Array(0)),
            json: { access_token: 'tok-abc' } as never,
          },
          bodySizeBytes: 0,
          contentType: 'application/json',
          url: 'https://checkout.example/login',
          redirected: false,
          redirectCount: 0,
          timing: TIMING,
        },
        timing: TIMING,
      };
      const extraction = await engine.apply(
        [
          {
            id: 'extract_token',
            variableName: 'token',
            source: { kind: 'json-path', path: 'body.access_token' },
            targetScope: 'run',
            sensitive: false,
            required: true,
            enabled: true,
            when: { kind: 'always' },
          },
        ],
        { result, requestKey: 'request:login#0' },
        this.writer,
      );
      return {
        outcome: 'success',
        durationMs: 5,
        statusCode: 200,
        extraction,
      };
    }

    if (source.sourceId === GET_USER_PATH) {
      this.executionOrder.push('getUser');
      const token = this.context
        .getRunStore()
        ?.toDefinitions()
        .find((definition) => definition.name === 'token')?.value;
      this.tokenBeforeGetUser = token;
      if (token === undefined) {
        return { outcome: 'failed', durationMs: 3, statusCode: 401 };
      }
      const result = {
        success: true as const,
        requestId: 'getUser',
        response: {
          requestId: 'getUser',
          statusCode: 200,
          statusText: 'OK',
          headers: [],
          body: {
            bytes: freezeDetachedBytes(new Uint8Array(0)),
            json: { id: 'user-42', name: 'Ada' } as never,
          },
          bodySizeBytes: 0,
          contentType: 'application/json',
          url: 'https://checkout.example/me',
          redirected: false,
          redirectCount: 0,
          timing: TIMING,
        },
        timing: TIMING,
      };
      const extraction = await engine.apply(
        [
          {
            id: 'extract_userId',
            variableName: 'userId',
            source: { kind: 'json-path', path: 'body.id' },
            targetScope: 'run',
            sensitive: false,
            required: true,
            enabled: true,
            when: { kind: 'always' },
          },
        ],
        { result, requestKey: 'request:getUser#0' },
        this.writer,
      );
      return {
        outcome: 'success',
        durationMs: 4,
        statusCode: 200,
        extraction,
      };
    }

    if (source.sourceId === GET_ORDERS_PATH) {
      this.executionOrder.push('orders');
      const userId = this.context
        .getRunStore()
        ?.toDefinitions()
        .find((definition) => definition.name === 'userId')?.value;
      this.userIdBeforeOrders = userId;
      if (userId === undefined) {
        return { outcome: 'failed', durationMs: 3, statusCode: 400 };
      }
      return { outcome: 'success', durationMs: 3, statusCode: 200 };
    }

    return { outcome: 'failed' };
  }
}

function checkoutAnalyses(): RequestDependencyAnalysis[] {
  return [
    analyzeDoc(LOGIN_SOURCE, 'login', LOGIN_PATH),
    analyzeDoc(GET_USER_SOURCE, 'getUser', GET_USER_PATH),
    analyzeDoc(GET_ORDERS_SOURCE, 'orders', GET_ORDERS_PATH),
  ];
}

describe('TC039–TC041 — A→B→C Login → Get User → Get Orders', () => {
  test('TC039 — enrich+run: membership C,B,A → Login→GetUser→GetOrders; token and userId flow', async () => {
    const analyses = checkoutAnalyses();
    assert.deepEqual(analyses[0]?.produces, ['token']);
    assert.ok(analyses[1]?.consumes.includes('token'));
    assert.deepEqual(analyses[1]?.produces, ['userId']);
    assert.ok(analyses[2]?.consumes.includes('userId'));

    const enriched = enrichRunPlanWithDependencies({
      membershipPlan: checkoutMembershipPlanCBA('run_abc_happy'),
      analyses,
    });
    assert.equal(enriched.ok, true);
    if (!enriched.ok) return;
    assert.deepEqual(
      enriched.plan.requests.map((request) => request.requestId),
      ['login', 'getUser', 'orders'],
    );
    assert.equal(enriched.plan.extensions?.dependencies?.reordered, true);

    const collectionRunContext = createCollectionRunVariableContext();
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: new InMemoryRunVariableStore(),
      environment: new NoOpVariableWriter(),
      resolveRunStore: () => collectionRunContext.getRunStore(),
    });
    const runVariableStore = new InMemoryRunVariableStore();
    const executor = new LoginGetUserOrdersExecutor(writer, collectionRunContext);
    const runner = new CollectionRunnerService({
      executor,
      sourceReader: new CheckoutSourceReader(),
    });

    collectionRunContext.begin({
      runId: enriched.plan.runId,
      collectionId: enriched.plan.collectionId,
      collectionRootPath: CHECKOUT_ROOT,
      runStore: runVariableStore,
    });
    try {
      const summary = await runner.execute({
        plan: enriched.plan,
        runVariableStore,
      });

      assert.deepEqual(executor.executionOrder, ['login', 'getUser', 'orders']);
      assert.equal(summary.results[0]?.outcome, 'passed');
      assert.deepEqual(summary.results[0]?.producedVariables, ['token']);
      assert.equal(runVariableStore.get('token')?.value, 'tok-abc');
      assert.equal(executor.tokenBeforeGetUser, 'tok-abc');
      assert.equal(summary.results[1]?.outcome, 'passed');
      assert.deepEqual(summary.results[1]?.producedVariables, ['userId']);
      assert.equal(runVariableStore.get('userId')?.value, 'user-42');
      assert.equal(executor.userIdBeforeOrders, 'user-42');
      assert.equal(summary.results[2]?.outcome, 'passed');
    } finally {
      runVariableStore.clear();
      collectionRunContext.end(enriched.plan.runId);
    }
  });

  test('TC040 — Login failure skips Get User and Get Orders with Missing run variable reasons', async () => {
    const analyses = checkoutAnalyses();
    const enriched = enrichRunPlanWithDependencies({
      membershipPlan: checkoutMembershipPlanCBA('run_abc_login_fail'),
      analyses,
    });
    assert.equal(enriched.ok, true);
    if (!enriched.ok) return;

    const collectionRunContext = createCollectionRunVariableContext();
    const writer = new CompositeVariableWriter({
      overlay: new InMemoryRuntimeVariableOverlay(),
      runStore: new InMemoryRunVariableStore(),
      environment: new NoOpVariableWriter(),
      resolveRunStore: () => collectionRunContext.getRunStore(),
    });
    const runVariableStore = new InMemoryRunVariableStore();
    const executor = new LoginGetUserOrdersExecutor(writer, collectionRunContext, {
      loginOutcome: 'failed',
    });
    const runner = new CollectionRunnerService({
      executor,
      sourceReader: new CheckoutSourceReader(),
    });

    collectionRunContext.begin({
      runId: enriched.plan.runId,
      collectionId: enriched.plan.collectionId,
      collectionRootPath: CHECKOUT_ROOT,
      runStore: runVariableStore,
    });
    try {
      const summary = await runner.execute({
        plan: enriched.plan,
        runVariableStore,
      });

      assert.equal(summary.results[0]?.outcome, 'failed');
      assert.equal(summary.results[1]?.outcome, 'skipped');
      assert.equal(
        summary.results[1]?.skipReason,
        'Missing run variable: token (producer Login failed)',
      );
      assert.equal(summary.results[2]?.outcome, 'skipped');
      assert.equal(
        summary.results[2]?.skipReason,
        'Missing run variable: userId (producer Get User was skipped)',
      );
    } finally {
      runVariableStore.clear();
      collectionRunContext.end(enriched.plan.runId);
    }
  });

  test('TC041 — cycle Login↔Get User → DEPENDENCY_CYCLE with labels; single-request plan has no reorder', () => {
    const cycleResult = enrichRunPlanWithDependencies({
      membershipPlan: freezeRunPlan({
        runId: 'run_login_getuser_cycle',
        mode: 'collection',
        collectionId: CHECKOUT_ID,
        collectionName: 'Checkout',
        failurePolicy: 'continue-on-error',
        requests: [
          {
            requestId: 'login',
            collectionId: CHECKOUT_ID,
            filePath: LOGIN_PATH,
            offset: 0,
            label: 'Login',
            method: 'POST',
            url: 'https://checkout.example/login',
            ordinal: 0,
          },
          {
            requestId: 'getUser',
            collectionId: CHECKOUT_ID,
            filePath: GET_USER_PATH,
            offset: 0,
            label: 'Get User',
            method: 'GET',
            url: 'https://checkout.example/me',
            ordinal: 1,
          },
        ],
        createdAt: new Date(0).toISOString(),
      }),
      analyses: [
        {
          requestId: 'login',
          produces: [],
          consumes: [],
          dependsOnNames: ['Get User'],
        },
        {
          requestId: 'getUser',
          produces: [],
          consumes: [],
          dependsOnNames: ['Login'],
        },
      ],
    });
    assert.equal(cycleResult.ok, false);
    if (cycleResult.ok) return;
    assert.equal(cycleResult.code, 'DEPENDENCY_CYCLE');
    assert.match(
      cycleResult.message,
      /Login → Get User → Login|Get User → Login → Get User/,
    );

    // One-request enrich with no dependency edges leaves order unchanged
    // (`reordered === false`). Editor Run Request does not call enrich at all;
    // this only locks enrich semantics for a lone membership plan.
    const single = enrichRunPlanWithDependencies({
      membershipPlan: freezeRunPlan({
        runId: 'run_single_login',
        mode: 'selected-requests',
        collectionId: CHECKOUT_ID,
        collectionName: 'Checkout',
        failurePolicy: 'continue-on-error',
        requests: [
          {
            requestId: 'login',
            collectionId: CHECKOUT_ID,
            filePath: LOGIN_PATH,
            offset: 0,
            label: 'Login',
            method: 'POST',
            url: 'https://checkout.example/login',
            ordinal: 0,
          },
        ],
        createdAt: new Date(0).toISOString(),
      }),
      analyses: [
        {
          requestId: 'login',
          produces: ['token'],
          consumes: [],
          dependsOnNames: [],
        },
      ],
    });
    assert.equal(single.ok, true);
    if (!single.ok) return;
    assert.equal(single.plan.extensions?.dependencies?.reordered, false);
    assert.deepEqual(
      single.plan.requests.map((request) => request.requestId),
      ['login'],
    );
  });
});
