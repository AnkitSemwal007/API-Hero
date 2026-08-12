/**
 * MCP-facing service over collection discovery and the existing run stack.
 * No `vscode` imports. Structured results instead of opaque thrown errors.
 */

import * as path from 'node:path';

import { parseApiDocument } from '../parser';
import type { Collection, RequestReference } from '../collections';
import { normalizePathKey } from '../collections';
import {
  CollectionRunAlreadyActiveError,
  FailurePolicyKinds,
  buildRunPlan,
  mapOrchestratorResult,
  resolveFailurePolicy,
  validateCollectionRunOptions,
  type CollectionRequestExecutorPort,
  type CollectionRunManager,
  type CollectionRunOptions,
  type CollectionRunOptionsInput,
  type CollectionRunnerService,
  type CollectionRunVariableContext,
  type FailurePolicyKind,
  type PlannedRequest,
  type RequestRunResult,
  type RunSummary,
} from '../collection-runner';
import type { CollectionDiscoveryService } from '../collections';
import type { VariableDefinition } from '../models';
import {
  InMemoryRunVariableStore,
  type CollectionVariableStore,
  type VariableResolver,
} from '../variables';
import type { CollectionRunSourceReader } from '../collection-runner';
import type { Logger } from '../shared';
import {
  ScenarioEngine,
  ScenarioStorageService,
  discoverWorkspaceScenarios,
  scenariosRootPath,
  buildRequestCatalogFromSnapshot,
  resolveScenarioRequestSteps,
  findUnboundRequestSteps,
  formatUnboundRequestGuidance,
  type Scenario,
} from '../scenarios';
import {
  emptyWorkspaceHint,
  mcpError,
  mcpOk,
  ok,
  projectCollectionSummary,
  projectFolderTree,
  projectRequestRunResult,
  projectRequestSummary,
  projectRunSummary,
  projectScenarioReport,
  projectVariables,
  type McpAuthMetadata,
  type McpCollectionDetail,
  type McpCollectionSummary,
  type McpRequestDetail,
  type McpRequestSummary,
  type McpResult,
  type McpRunSummaryDto,
  type McpScenarioRunDto,
} from './dto';
import type { HeadlessApiHeroRuntime } from './composition';

/** Mirror CollectionRunManager default recent ring — keep MCP cache bounded. */
const MCP_SUMMARY_CACHE_LIMIT = 20;

export interface ApiHeroMcpServiceDeps {
  readonly workspaceRoot: string;
  readonly discovery: CollectionDiscoveryService;
  readonly runner: CollectionRunnerService;
  readonly runManager: CollectionRunManager;
  readonly executorPort: CollectionRequestExecutorPort;
  readonly sourceReader: CollectionRunSourceReader;
  readonly collectionVariableStore: CollectionVariableStore;
  readonly collectionRunContext: CollectionRunVariableContext;
  readonly variableResolver: VariableResolver;
  readonly getExternalVariableDefinitions: () => readonly VariableDefinition[];
  readonly fileExists: (filePath: string) => Promise<boolean>;
  readonly getStaticVariableNames: () => ReadonlySet<string>;
  readonly setActiveCollectionVariables: (
    variables: readonly VariableDefinition[],
  ) => void;
  readonly preloadCollectionVariables: (
    rootPath: string,
    collectionId: string,
  ) => Promise<readonly VariableDefinition[]>;
  readonly analyzeAndEnrich: HeadlessApiHeroRuntime['analyzeAndEnrich'];
  readonly logger?: Logger;
}

/** Public MCP domain methods. Prefer display-name resolution for agents. */
export class ApiHeroMcpService {
  private readonly summaries = new Map<string, RunSummary>();
  private readonly summaryOrder: string[] = [];
  /**
   * MCP-wide single-flight lock for collection and scenario runs that share
   * {@link CollectionRunVariableContext}. Complements CollectionRunManager.
   */
  private mcpRunActive = false;

  public constructor(private readonly deps: ApiHeroMcpServiceDeps) {}

  private tryAcquireMcpRun(): McpResult<never> | undefined {
    if (
      this.mcpRunActive ||
      this.deps.runManager.activeCount > 0 ||
      this.deps.collectionRunContext.isActive()
    ) {
      const active = this.deps.runManager.listActive()[0];
      return mcpError(
        'RUN_ALREADY_ACTIVE',
        active === undefined
          ? 'A collection or scenario run is already in progress.'
          : `A collection run is already active (runId=${active.runId}). Wait for it to finish or cancel it before starting another.`,
      );
    }
    this.mcpRunActive = true;
    return undefined;
  }

  private releaseMcpRun(): void {
    this.mcpRunActive = false;
  }

  private rememberSummary(summary: RunSummary): void {
    const existing = this.summaries.has(summary.runId);
    this.summaries.set(summary.runId, summary);
    if (!existing) {
      this.summaryOrder.push(summary.runId);
    }
    while (this.summaryOrder.length > MCP_SUMMARY_CACHE_LIMIT) {
      const evicted = this.summaryOrder.shift();
      if (evicted !== undefined) {
        this.summaries.delete(evicted);
      }
    }
  }

  public static fromRuntime(runtime: HeadlessApiHeroRuntime): ApiHeroMcpService {
    return new ApiHeroMcpService({
      workspaceRoot: runtime.workspaceRoot,
      discovery: runtime.discovery,
      runner: runtime.runner,
      runManager: runtime.runManager,
      executorPort: runtime.executorPort,
      sourceReader: runtime.sourceReader,
      collectionVariableStore: runtime.collectionVariableStore,
      collectionRunContext: runtime.collectionRunContext,
      variableResolver: runtime.variableResolver,
      getExternalVariableDefinitions: runtime.getExternalVariableDefinitions,
      fileExists: runtime.fileExists,
      getStaticVariableNames: runtime.getStaticVariableNames,
      setActiveCollectionVariables: runtime.setActiveCollectionVariables,
      preloadCollectionVariables: runtime.preloadCollectionVariables,
      analyzeAndEnrich: runtime.analyzeAndEnrich,
      logger: runtime.logger,
    });
  }

  public async listCollections(): Promise<
    McpResult<{ readonly collections: readonly McpCollectionSummary[] }>
  > {
    const aggregate = await this.deps.discovery.refresh();
    if (emptyWorkspaceHint(aggregate)) {
      return mcpError(
        'EMPTY_WORKSPACE',
        'No collections found. Open a workspace that contains Collections/<Name>/ (pass --workspace, set APIHERO_WORKSPACE, or use cwd).',
      );
    }
    const collections = Object.values(aggregate.collections).map(
      projectCollectionSummary,
    );
    return mcpOk({ collections });
  }

  public async getCollection(
    nameOrId: string,
  ): Promise<McpResult<McpCollectionDetail>> {
    const resolved = await this.resolveCollection(nameOrId);
    if (!resolved.ok) {
      return resolved;
    }
    const { collection } = resolved.data;
    let variables: readonly VariableDefinition[];
    try {
      variables = await this.deps.collectionVariableStore.load(
        collection.rootPath,
        collection.id,
      );
    } catch {
      variables = [];
    }
    const auth: McpAuthMetadata = {
      configured: collection.metadata.defaultAuthenticationId !== undefined,
      ...(collection.metadata.defaultAuthenticationId !== undefined
        ? { type: 'profile' }
        : {}),
    };
    return mcpOk({
      ...projectCollectionSummary(collection),
      folders: projectFolderTree(collection),
      variables: projectVariables(variables),
      auth,
    });
  }

  public async listRequests(
    nameOrId: string,
    folder?: string,
  ): Promise<McpResult<{ readonly requests: readonly McpRequestSummary[] }>> {
    const resolved = await this.resolveCollection(nameOrId);
    if (!resolved.ok) {
      return resolved;
    }
    const { collection } = resolved.data;
    let requests = Object.values(collection.requests);
    if (folder !== undefined && folder.trim().length > 0) {
      const needle = folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      requests = requests.filter((request) => {
        const folderPath =
          request.folderId === undefined
            ? ''
            : (collection.folders[request.folderId]?.relativePath ?? '');
        return (
          folderPath === needle ||
          folderPath.startsWith(`${needle}/`) ||
          folderPath.toLowerCase() === needle.toLowerCase()
        );
      });
    }
    return mcpOk({
      requests: requests.map((request) =>
        projectRequestSummary(collection, request),
      ),
    });
  }

  public async getRequest(options: {
    readonly collection?: string;
    readonly request?: string;
    readonly requestId?: string;
  }): Promise<McpResult<McpRequestDetail>> {
    const found = await this.findRequest(options);
    if (!found.ok) {
      return found;
    }
    const { collection, request } = found.data;
    const auth = await this.requestAuthMetadata(request);
    const variableRefs = await this.requestVariableRefs(request);
    return mcpOk({
      ...projectRequestSummary(collection, request),
      auth,
      variableRefs,
    });
  }

  public async runRequest(options: {
    readonly collection?: string;
    readonly request?: string;
    readonly requestId?: string;
  }): Promise<McpResult<ReturnType<typeof projectRequestRunResult>>> {
    const found = await this.findRequest(options);
    if (!found.ok) {
      return found;
    }
    const { collection, request } = found.data;
    let text: string;
    try {
      text = await this.deps.sourceReader.readText(request.filePath);
    } catch (error) {
      return mcpError(
        'REQUEST_UNREADABLE',
        error instanceof Error
          ? error.message
          : `Unable to read request file "${request.filePath}".`,
      );
    }

    // Prime the collection-variable cache (used when no run context is active)
    // and the active snapshot (for getExternalVariableDefinitions). Always clear
    // the active snapshot in finally so a long-lived MCP process cannot leak
    // stale collection vars into a later scenario.
    const definitions = await this.deps.preloadCollectionVariables(
      collection.rootPath,
      collection.id,
    );
    this.deps.setActiveCollectionVariables(definitions);
    try {
      const orchestratorResult = await this.deps.executorPort.runAtSourceLocation(
        {
          text,
          sourceId: request.filePath,
          offset: request.range.start.offset,
        },
        {
          showViewer: false,
          useProgressUi: false,
          showNotifications: false,
        },
      );

      const mapped = mapSingleRequestResult(request, orchestratorResult);
      return mcpOk(projectRequestRunResult(mapped));
    } finally {
      this.deps.setActiveCollectionVariables([]);
    }
  }

  public async runCollection(
    nameOrId: string,
    failurePolicy?: string,
    runOptions?: CollectionRunOptionsInput,
  ): Promise<McpResult<McpRunSummaryDto>> {
    const busy = this.tryAcquireMcpRun();
    if (busy !== undefined) {
      return busy;
    }

    try {
      return await this.runCollectionUnlocked(
        nameOrId,
        failurePolicy,
        runOptions,
      );
    } finally {
      this.releaseMcpRun();
    }
  }

  private async runCollectionUnlocked(
    nameOrId: string,
    failurePolicy?: string,
    runOptionsInput?: CollectionRunOptionsInput,
  ): Promise<McpResult<McpRunSummaryDto>> {
    const resolved = await this.resolveCollection(nameOrId);
    if (!resolved.ok) {
      return resolved;
    }
    const { collection, aggregate } = resolved.data;
    const policy = parseFailurePolicy(failurePolicy);
    if (!policy.ok) {
      return policy;
    }

    let runOptions: CollectionRunOptions | undefined;
    if (runOptionsInput !== undefined) {
      const validated = validateCollectionRunOptions(runOptionsInput);
      if (!validated.ok) {
        return mcpError('INVALID_RUN_OPTIONS', validated.message);
      }
      runOptions = validated.options;
    }

    let plan;
    try {
      plan = buildRunPlan({
        aggregate,
        target: { mode: 'collection', collectionId: collection.id },
        failurePolicy: policy.data,
        ...(runOptions === undefined ? {} : { runOptions }),
      });
    } catch (error) {
      return mcpError(
        'PLAN_BUILD_FAILED',
        error instanceof Error ? error.message : 'Unable to build a collection run plan.',
      );
    }

    if (plan.requests.length === 0) {
      return mcpError(
        'NO_REQUESTS',
        `Collection "${collection.metadata.name}" has no runnable requests.`,
      );
    }

    const enrichment = await this.deps.analyzeAndEnrich(plan, {
      readText: (filePath) => this.deps.sourceReader.readText(filePath),
    });
    if (!enrichment.ok) {
      return mcpError('DEPENDENCY_ENRICH_FAILED', enrichment.message);
    }
    const enrichedPlan = enrichment.plan;

    let session;
    try {
      session = this.deps.runManager.begin({ plan: enrichedPlan });
    } catch (error) {
      if (error instanceof CollectionRunAlreadyActiveError) {
        return mcpError(
          'RUN_ALREADY_ACTIVE',
          `A collection run is already active (runId=${error.activeRunId}). Wait for it to finish or cancel it before starting another.`,
        );
      }
      throw error;
    }

    const runVariableStore = new InMemoryRunVariableStore();
    let collectionVariables: readonly VariableDefinition[];
    try {
      collectionVariables = await this.deps.collectionVariableStore.load(
        collection.rootPath,
        enrichedPlan.collectionId,
      );
    } catch {
      collectionVariables = [];
    }
    this.deps.setActiveCollectionVariables(collectionVariables);
    this.deps.collectionRunContext.begin({
      runId: enrichedPlan.runId,
      collectionId: enrichedPlan.collectionId,
      collectionRootPath: collection.rootPath,
      runStore: runVariableStore,
    });

    try {
      const summary = await this.deps.runner.execute({
        plan: enrichedPlan,
        signal: session.signal,
        historyCaptureContext: {
          collectionName: enrichedPlan.collectionName,
        },
        runVariableStore,
        staticVariableNames: this.deps.getStaticVariableNames,
      });
      this.deps.runManager.complete(summary);
      this.rememberSummary(summary);
      return mcpOk(projectRunSummary(summary));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.runManager.fail(enrichedPlan.runId, message);
      return mcpError('RUN_FAILED', message);
    } finally {
      runVariableStore.clear();
      this.deps.collectionRunContext.end(enrichedPlan.runId);
      this.deps.setActiveCollectionVariables([]);
    }
  }

  /**
   * Run a Scenario via ScenarioEngine (same engine as UI Run Scenario).
   * Domain failure (report status=failed) still returns ok:true with the report.
   */
  public async runScenario(args: {
    readonly scenario: string;
    readonly inputs?: Record<string, string>;
  }): Promise<McpResult<McpScenarioRunDto>> {
    const busy = this.tryAcquireMcpRun();
    if (busy !== undefined) {
      return busy;
    }

    try {
      return await this.runScenarioUnlocked(args);
    } finally {
      this.releaseMcpRun();
    }
  }

  private async runScenarioUnlocked(args: {
    readonly scenario: string;
    readonly inputs?: Record<string, string>;
  }): Promise<McpResult<McpScenarioRunDto>> {
    // Defensive cleanup: prior runRequest must not leave collection vars in
    // getExternalVariableDefinitions for ScenarioEngine.
    this.deps.setActiveCollectionVariables([]);

    const resolvedScenario = await this.resolveScenario(args.scenario);
    if (!resolvedScenario.ok) {
      return resolvedScenario;
    }
    const scenario = applyScenarioInputs(
      resolvedScenario.data,
      args.inputs,
    );

    await this.deps.discovery.refresh();
    const catalog = buildRequestCatalogFromSnapshot(this.deps.discovery.snapshot);

    const unbound = findUnboundRequestSteps(scenario, catalog);
    if (unbound.length > 0) {
      return mcpError(
        'SCENARIO_UNBOUND',
        formatUnboundRequestGuidance(unbound, 'cli'),
      );
    }

    let resolved: Scenario;
    try {
      resolved = resolveScenarioRequestSteps(scenario, catalog);
    } catch (error) {
      return mcpError(
        'REQUEST_REF_UNRESOLVED',
        error instanceof Error ? error.message : String(error),
      );
    }

    const logger = this.deps.logger;
    const scenarioLogger = {
      info: (message: string, context?: Readonly<Record<string, unknown>>) => {
        logger?.info(message, context);
      },
      warning: (message: string, context?: Readonly<Record<string, unknown>>) => {
        logger?.warning(message, context);
      },
      error: (
        message: string,
        cause?: unknown,
        context?: Readonly<Record<string, unknown>>,
      ) => {
        logger?.error(message, cause, context);
      },
      debug: (message: string, context?: Readonly<Record<string, unknown>>) => {
        logger?.debug(message, context);
      },
    };

    const workspaceRoot = this.deps.workspaceRoot;
    const engine = new ScenarioEngine({
      executor: this.deps.executorPort,
      sourceReader: this.deps.sourceReader,
      externalVariableResolver: this.deps.variableResolver,
      externalVariableDefinitions: this.deps.getExternalVariableDefinitions(),
      fileExists: this.deps.fileExists,
      logger: scenarioLogger,
      onRunStoreBegin: (runId, store) => {
        this.deps.collectionRunContext.begin({
          runId,
          collectionId: `scenario:${resolved.id}`,
          collectionRootPath: scenariosRootPath(workspaceRoot),
          runStore: store,
        });
      },
      onRunStoreEnd: (runId) => {
        this.deps.collectionRunContext.end(runId);
      },
    });

    const controller = new AbortController();
    try {
      const result = await engine.runScenario(resolved, {
        signal: controller.signal,
      });
      return mcpOk(projectScenarioReport(result.report));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('Scenario validation failed:')) {
        return mcpError('SCENARIO_VALIDATION_FAILED', message);
      }
      return mcpError('RUN_FAILED', message);
    }
  }

  public async getRun(
    runId: string,
  ): Promise<McpResult<McpRunSummaryDto | { readonly session: unknown }>> {
    const summary = this.summaries.get(runId);
    if (summary !== undefined) {
      return mcpOk(projectRunSummary(summary));
    }
    const session =
      this.deps.runManager.get(runId) ??
      this.deps.runManager.listRecent().find((entry) => entry.runId === runId);
    if (session === undefined) {
      return mcpError('RUN_NOT_FOUND', `No run found for id "${runId}".`);
    }
    if (session.summary !== undefined) {
      this.rememberSummary(session.summary);
      return mcpOk(projectRunSummary(session.summary));
    }
    return mcpOk({
      session: {
        runId: session.runId,
        status: session.status,
        collectionName: session.collectionName,
        collectionId: session.collectionId,
        total: session.total,
        completed: session.completed,
        remaining: session.remaining,
        elapsedMs: session.elapsedMs,
        results: session.results.map((result) =>
          projectRequestRunResult(result, { includeFullResponse: false }),
        ),
      },
    });
  }

  public async getRequestResult(
    runId: string,
    requestIdOrLabel: string,
  ): Promise<McpResult<ReturnType<typeof projectRequestRunResult>>> {
    const run = await this.getRun(runId);
    if (!run.ok) {
      return run;
    }
    const summary = this.summaries.get(runId);
    const results =
      summary?.results ??
      this.deps.runManager.get(runId)?.results ??
      this.deps.runManager
        .listRecent()
        .find((entry) => entry.runId === runId)?.results;
    if (results === undefined) {
      return mcpError(
        'REQUEST_RESULT_NOT_FOUND',
        `No request results available for run "${runId}".`,
      );
    }
    const needle = requestIdOrLabel.trim().toLowerCase();
    const match = results.find(
      (result) =>
        result.requestId.toLowerCase() === needle ||
        result.label.trim().toLowerCase() === needle,
    );
    if (match === undefined) {
      return mcpError(
        'REQUEST_NOT_FOUND',
        `No request "${requestIdOrLabel}" in run "${runId}".`,
      );
    }
    return mcpOk(projectRequestRunResult(match));
  }

  private async resolveCollection(
    nameOrId: string,
  ): Promise<
    McpResult<{
      readonly collection: Collection;
      readonly aggregate: Awaited<
        ReturnType<CollectionDiscoveryService['refresh']>
      >;
    }>
  > {
    const aggregate = await this.deps.discovery.refresh();
    if (emptyWorkspaceHint(aggregate)) {
      return mcpError(
        'EMPTY_WORKSPACE',
        'No collections found. Open a workspace that contains Collections/<Name>/ (pass --workspace, set APIHERO_WORKSPACE, or use cwd).',
      );
    }
    const trimmed = nameOrId.trim();
    if (trimmed.length === 0) {
      return mcpError('COLLECTION_NOT_FOUND', 'Collection name is required.');
    }
    const lower = trimmed.toLowerCase();
    const byName = Object.values(aggregate.collections).find(
      (collection) => collection.metadata.name.trim().toLowerCase() === lower,
    );
    if (byName !== undefined) {
      return ok({ collection: byName, aggregate });
    }
    const byId = aggregate.collections[trimmed];
    if (byId !== undefined) {
      return ok({ collection: byId, aggregate });
    }
    const byNormalizedId = Object.values(aggregate.collections).find(
      (collection) =>
        normalizePathKey(collection.id) === normalizePathKey(trimmed),
    );
    if (byNormalizedId !== undefined) {
      return ok({ collection: byNormalizedId, aggregate });
    }
    return mcpError(
      'COLLECTION_NOT_FOUND',
      `Collection "${nameOrId}" was not found.`,
    );
  }

  private async resolveScenario(
    nameOrIdOrPath: string,
  ): Promise<McpResult<Scenario>> {
    const trimmed = nameOrIdOrPath.trim();
    if (trimmed.length === 0) {
      return mcpError('SCENARIO_NOT_FOUND', 'Scenario name is required.');
    }

    const storage = new ScenarioStorageService();
    const discovered = await discoverWorkspaceScenarios(
      this.deps.workspaceRoot,
      storage,
    );
    if (!discovered.ok) {
      return mcpError(
        'SCENARIO_LOAD_FAILED',
        discovered.error.message,
      );
    }

    type ScenarioEntry = { readonly scenario: Scenario; readonly filePath: string };
    const entries: ScenarioEntry[] = [];
    const failedFiles: string[] = [];
    for (const filePath of discovered.files) {
      const loaded = await storage.load(filePath);
      if (loaded.ok) {
        entries.push({ scenario: loaded.scenario, filePath });
      } else {
        failedFiles.push(filePath);
      }
    }

    const pathCandidates = scenarioPathCandidates(
      this.deps.workspaceRoot,
      trimmed,
    );
    const byPath = entries.filter((entry) =>
      pathCandidates.some(
        (candidate) =>
          normalizePathKey(entry.filePath) === normalizePathKey(candidate),
      ),
    );
    if (byPath.length === 1) {
      return ok(byPath[0]!.scenario);
    }
    if (byPath.length > 1) {
      return mcpError(
        'SCENARIO_AMBIGUOUS',
        `Multiple scenarios matched path "${nameOrIdOrPath}".`,
      );
    }

    const failedPathMatch = failedFiles.find((filePath) =>
      pathCandidates.some(
        (candidate) =>
          normalizePathKey(filePath) === normalizePathKey(candidate),
      ),
    );
    if (failedPathMatch !== undefined) {
      return mcpError(
        'SCENARIO_LOAD_FAILED',
        `Scenario file "${failedPathMatch}" could not be loaded.`,
      );
    }

    const lower = trimmed.toLowerCase();
    const byId = entries.filter(
      (entry) => entry.scenario.id.toLowerCase() === lower,
    );
    if (byId.length === 1) {
      return ok(byId[0]!.scenario);
    }
    if (byId.length > 1) {
      return mcpError(
        'SCENARIO_AMBIGUOUS',
        `Multiple scenarios matched id "${nameOrIdOrPath}".`,
      );
    }

    const byName = entries.filter(
      (entry) => entry.scenario.name.trim().toLowerCase() === lower,
    );
    if (byName.length > 1) {
      return mcpError(
        'SCENARIO_AMBIGUOUS',
        `Multiple scenarios named "${nameOrIdOrPath}". Identify by id or .scenario.json path.`,
      );
    }
    if (byName.length === 1) {
      return ok(byName[0]!.scenario);
    }

    return mcpError(
      'SCENARIO_NOT_FOUND',
      `Scenario "${nameOrIdOrPath}" was not found.`,
    );
  }

  private async findRequest(options: {
    readonly collection?: string;
    readonly request?: string;
    readonly requestId?: string;
  }): Promise<
    McpResult<{ readonly collection: Collection; readonly request: RequestReference }>
  > {
    const aggregate = await this.deps.discovery.refresh();

    if (options.requestId !== undefined && options.requestId.trim().length > 0) {
      const needle = options.requestId.trim();
      for (const collection of Object.values(aggregate.collections)) {
        const request = collection.requests[needle];
        if (request !== undefined) {
          return ok({ collection, request });
        }
        const byId = Object.values(collection.requests).find(
          (entry) => entry.id === needle,
        );
        if (byId !== undefined) {
          return ok({ collection, request: byId });
        }
      }
    }

    if (options.collection !== undefined && options.collection.trim().length > 0) {
      const resolved = await this.resolveCollection(options.collection);
      if (!resolved.ok) {
        return resolved;
      }
      const { collection } = resolved.data;
      const requestName = options.request?.trim() ?? options.requestId?.trim();
      if (requestName === undefined || requestName.length === 0) {
        return mcpError('REQUEST_NOT_FOUND', 'Request name or id is required.');
      }
      const match = matchRequestInCollection(collection, requestName);
      if (match === undefined) {
        return mcpError(
          'REQUEST_NOT_FOUND',
          `Request "${requestName}" was not found in collection "${collection.metadata.name}".`,
        );
      }
      return ok({ collection, request: match });
    }

    const workspaceNeedle =
      options.request?.trim() || options.requestId?.trim() || undefined;
    if (workspaceNeedle === undefined || workspaceNeedle.length === 0) {
      return mcpError(
        'COLLECTION_REQUIRED',
        'Provide collection (name) and request name, or a request id.',
      );
    }

    const matches: Array<{
      readonly collection: Collection;
      readonly request: RequestReference;
    }> = [];
    for (const collection of Object.values(aggregate.collections)) {
      const match = matchRequestInCollection(collection, workspaceNeedle);
      if (match !== undefined) {
        matches.push({ collection, request: match });
      }
    }
    if (matches.length === 1) {
      return ok(matches[0]!);
    }
    if (matches.length > 1) {
      return mcpError(
        'REQUEST_AMBIGUOUS',
        `Multiple requests matched "${workspaceNeedle}". Provide a collection name.`,
      );
    }
    return mcpError(
      'REQUEST_NOT_FOUND',
      `Request "${workspaceNeedle}" was not found.`,
    );
  }

  private async requestAuthMetadata(
    request: RequestReference,
  ): Promise<McpAuthMetadata> {
    try {
      const text = await this.deps.sourceReader.readText(request.filePath);
      const parsed = parseApiDocument(text, { sourceId: request.filePath });
      const node = parsed.ast.requests[request.requestIndex];
      const directives = [
        ...(parsed.ast.directives ?? []),
        ...(node?.directives ?? []),
      ];
      const auth = directives.find((directive) => directive.knownName === 'auth');
      if (auth === undefined || auth.value === undefined || auth.value.trim().length === 0) {
        return { configured: false };
      }
      const type = auth.value.trim().split(/\s+/u)[0]!;
      return { configured: true, type };
    } catch {
      return { configured: false };
    }
  }

  private async requestVariableRefs(
    request: RequestReference,
  ): Promise<
    readonly { readonly name: string; readonly value: string; readonly sensitive: boolean }[]
  > {
    try {
      const text = await this.deps.sourceReader.readText(request.filePath);
      const parsed = parseApiDocument(text, { sourceId: request.filePath });
      const names = new Set<string>();
      for (const directive of [
        ...parsed.ast.directives,
        ...(parsed.ast.requests[request.requestIndex]?.directives ?? []),
      ]) {
        for (const variable of directive.variables ?? []) {
          names.add(variable.name);
        }
      }
      const requestNode = parsed.ast.requests[request.requestIndex];
      if (requestNode !== undefined) {
        for (const variable of requestNode.variables ?? []) {
          names.add(variable.name);
        }
      }
      return [...names].map((name) => ({
        name,
        value: `{{${name}}}`,
        sensitive: false,
      }));
    } catch {
      return [];
    }
  }
}

function matchRequestInCollection(
  collection: Collection,
  requestName: string,
): RequestReference | undefined {
  const lower = requestName.toLowerCase();
  return (
    collection.requests[requestName] ??
    Object.values(collection.requests).find((request) => {
      const label = request.display.label.trim().toLowerCase();
      const folderPath =
        request.folderId === undefined
          ? ''
          : (collection.folders[request.folderId]?.relativePath ?? '');
      const pathLabel =
        folderPath.length === 0
          ? label
          : `${folderPath}/${label}`.toLowerCase();
      return (
        label === lower ||
        pathLabel === lower ||
        request.id.toLowerCase() === lower ||
        request.filePath.toLowerCase().endsWith(lower) ||
        request.filePath.replace(/\\/g, '/').toLowerCase().endsWith(`/${lower}`)
      );
    })
  );
}

function parseFailurePolicy(
  raw: string | undefined,
): McpResult<FailurePolicyKind> {
  if (raw === undefined || raw.trim().length === 0) {
    return ok(FailurePolicyKinds.ContinueOnError);
  }
  const value = raw.trim().toLowerCase();
  if (
    value === FailurePolicyKinds.StopOnFirstError ||
    value === FailurePolicyKinds.ContinueOnError ||
    value === FailurePolicyKinds.SkipInvalidRequests
  ) {
    return ok(value);
  }
  return mcpError(
    'INVALID_FAILURE_POLICY',
    `Unknown failurePolicy "${raw}". Use stop-on-first-error, continue-on-error, or skip-invalid-requests.`,
  );
}

function mapSingleRequestResult(
  request: RequestReference,
  orchestratorResult: Awaited<
    ReturnType<CollectionRequestExecutorPort['runAtSourceLocation']>
  >,
): RequestRunResult {
  const planned: PlannedRequest = {
    requestId: request.id,
    collectionId: request.collectionId,
    ...(request.folderId !== undefined ? { folderId: request.folderId } : {}),
    filePath: request.filePath,
    offset: request.range.start.offset,
    label: request.display.label,
    method: request.method,
    url: request.url,
    ordinal: 0,
  };
  return mapOrchestratorResult(
    planned,
    orchestratorResult,
    resolveFailurePolicy(FailurePolicyKinds.ContinueOnError),
    orchestratorResult.durationMs ?? 0,
  );
}

/** Apply known input keys as scenario variable defaultValue overrides for this run. */
function applyScenarioInputs(
  scenario: Scenario,
  inputs: Record<string, string> | undefined,
): Scenario {
  if (inputs === undefined) {
    return scenario;
  }
  return {
    ...scenario,
    variables: scenario.variables.map((variable) =>
      Object.prototype.hasOwnProperty.call(inputs, variable.name)
        ? { ...variable, defaultValue: inputs[variable.name] }
        : variable,
    ),
  };
}

/** Absolute path candidates for scenario resolution (workspace-relative + scenarios root). */
function scenarioPathCandidates(
  workspaceRoot: string,
  raw: string,
): readonly string[] {
  const root = path.resolve(workspaceRoot);
  const scenariosRoot = scenariosRootPath(root);
  const candidates = new Set<string>();
  if (path.isAbsolute(raw)) {
    candidates.add(path.resolve(raw));
  } else {
    candidates.add(path.resolve(root, raw));
    candidates.add(path.resolve(scenariosRoot, raw));
    candidates.add(path.resolve(scenariosRoot, path.basename(raw)));
  }
  return [...candidates];
}
