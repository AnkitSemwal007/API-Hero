/**
 * Headless DI composition for API Hero MCP / CLI hosts.
 * Mirrors `extension.ts` domain wiring with no-op UI adapters.
 * No `vscode` imports.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import {
  ApiKeyAuthenticationProvider,
  AuthenticationProfileManager,
  AuthenticationProviderRegistry,
  AuthenticationSessionStore,
  BasicAuthenticationProvider,
  BearerAuthenticationProvider,
  DefaultAuthenticationResolver,
  DefaultAuthenticationSecretRepository,
  EphemeralAuthenticationSlot,
  NoneAuthenticationProvider,
  type AuthenticationProfileRepository,
} from '../auth';
import {
  ApiFileParseCache,
  CollectionDiscoveryService,
  InMemoryCollectionRepository,
  NodeApiFileReader,
  NodeWorkspaceScanner,
  collectionIdForRoot,
  normalizePathKey,
  toFsPath,
} from '../collections';
import {
  CollectionRunManager,
  CollectionRunnerService,
  createCollectionRunVariableContext,
  type CollectionRequestExecutorPort,
  type CollectionRunSourceReader,
  type CollectionRunVariableContext,
} from '../collection-runner';
import {
  analyzeRunPlanDependencies,
  enrichRunPlanWithDependencies,
} from '../dependencies';
import {
  DefaultRequestExecutor,
  NodeHttpTransport,
} from '../execution';
import {
  CollectionVariableWriter,
  CompositeVariableWriter,
  DefaultExtractionEngine,
  InMemoryRuntimeVariableOverlay,
  NoOpVariableWriter,
  requestKeyFor,
} from '../extraction';
import type { TestReport } from '../assertions';
import type { ExecutionResult } from '../execution';
import type { AuthenticatedRequest, VariableDefinition } from '../models';
import {
  ExecutionOrchestrator,
  type ExecutionNotificationSink,
  type ExecutionProgressRunner,
  type ExecutionResultViewer,
  type ExecutionStatusPresenter,
  type PostExecutionObserver,
} from '../orchestration';
import {
  readVariablesLocalOverlay,
  writeVariablesLocalOverlay,
} from '../project-store';
import type { ProjectStoreFilesystem } from '../project-store';
import type { SecretStore } from '../storage/stores';
import { Logger, type LogSink } from '../shared';
import {
  DefaultVariableResolver,
  EnvironmentManager,
  FilesystemCollectionVariableStore,
  InMemoryRunVariableStore,
  extractDocumentVariables,
  type CollectionVariableStore,
  type CollectionVariableStorePorts,
  type VariableConfigurationRepository,
} from '../variables';

export interface HeadlessApiHeroRuntime {
  readonly workspaceRoot: string;
  readonly logger: Logger;
  readonly discovery: CollectionDiscoveryService;
  readonly orchestrator: ExecutionOrchestrator;
  readonly runner: CollectionRunnerService;
  readonly runManager: CollectionRunManager;
  readonly collectionVariableStore: CollectionVariableStore;
  readonly collectionRunContext: CollectionRunVariableContext;
  readonly sourceReader: CollectionRunSourceReader;
  readonly executorPort: CollectionRequestExecutorPort;
  readonly getStaticVariableNames: () => ReadonlySet<string>;
  readonly setActiveCollectionVariables: (
    variables: readonly VariableDefinition[],
  ) => void;
  readonly analyzeAndEnrich: typeof analyzeAndEnrichPlan;
}

export interface CreateHeadlessApiHeroRuntimeOptions {
  readonly workspaceRoot: string;
  /** When true, logger writes to stderr; otherwise silent. Default false. */
  readonly verbose?: boolean;
}

/** Composes a fully wired headless API Hero runtime for one workspace root. */
export function createHeadlessApiHeroRuntime(
  options: CreateHeadlessApiHeroRuntimeOptions,
): HeadlessApiHeroRuntime {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const logger = new Logger(
    options.verbose === true ? new StderrLogSink() : new SilentLogSink(),
  );

  const environmentManager = new EnvironmentManager(
    new EmptyVariableConfigurationRepository(),
  );
  const variableResolver = new DefaultVariableResolver();
  const runtimeOverlay = new InMemoryRuntimeVariableOverlay();
  const runVariableStore = new InMemoryRunVariableStore();
  const collectionRunVariableContext = createCollectionRunVariableContext();
  const collectionVariableStore = new FilesystemCollectionVariableStore(
    createNodeCollectionVariableStorePorts(workspaceRoot),
  );
  const collectionVariableCache = new Map<
    string,
    readonly VariableDefinition[]
  >();
  let activeCollectionRunVariables: readonly VariableDefinition[] = [];

  const scanner = new NodeWorkspaceScanner({ workspaceRoot });
  const reader = new NodeApiFileReader();
  const discovery = new CollectionDiscoveryService({
    scanner,
    reader,
    repository: new InMemoryCollectionRepository(),
    parseCache: new ApiFileParseCache(),
  });

  const resolveCollectionRootPathForSource = (
    sourceId: string,
  ): string | undefined => {
    const snapshot = discovery.snapshot;
    if (snapshot === undefined) {
      return undefined;
    }
    const target = normalizePathKey(sourceId);
    for (const collection of Object.values(snapshot.collections)) {
      for (const request of Object.values(collection.requests)) {
        if (normalizePathKey(request.filePath) === target) {
          return collection.rootPath;
        }
      }
    }
    return undefined;
  };

  const resolveCollectionDefaultAuthenticationId = (
    sourceId: string,
  ): string | undefined => {
    const snapshot = discovery.snapshot;
    if (snapshot === undefined) {
      return undefined;
    }
    const target = normalizePathKey(sourceId);
    for (const collection of Object.values(snapshot.collections)) {
      for (const request of Object.values(collection.requests)) {
        if (normalizePathKey(request.filePath) === target) {
          return collection.metadata.defaultAuthenticationId;
        }
      }
    }
    return undefined;
  };

  const collectionDefinitionsForSource = (
    sourceId: string | undefined,
  ): readonly VariableDefinition[] => {
    if (collectionRunVariableContext.isActive()) {
      return activeCollectionRunVariables;
    }
    if (sourceId === undefined || sourceId.length === 0) {
      return [];
    }
    const rootPath = resolveCollectionRootPathForSource(sourceId);
    if (rootPath === undefined) {
      return [];
    }
    const key = normalizePathKey(rootPath);
    return collectionVariableCache.get(key) ?? [];
  };

  const setActiveCollectionVariables = (
    variables: readonly VariableDefinition[],
  ): void => {
    activeCollectionRunVariables = variables;
  };

  const preloadCollectionVariables = async (
    rootPath: string,
    collectionId: string,
  ): Promise<readonly VariableDefinition[]> => {
    try {
      const definitions = await collectionVariableStore.load(
        rootPath,
        collectionId,
      );
      collectionVariableCache.set(normalizePathKey(rootPath), definitions);
      return definitions;
    } catch (error) {
      logger.warning('Failed to load collection variables', {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  };

  const authenticationProfiles = new AuthenticationProfileManager(
    new EmptyAuthenticationProfileRepository(),
  );
  const authenticationRegistry = new AuthenticationProviderRegistry([
    new NoneAuthenticationProvider(),
    new BasicAuthenticationProvider(),
    new BearerAuthenticationProvider(),
    new ApiKeyAuthenticationProvider(),
  ]);
  const authenticationResolver = new DefaultAuthenticationResolver(
    authenticationRegistry,
  );
  const secretStore = new InMemorySecretStore();
  const authenticationSecrets = new DefaultAuthenticationSecretRepository(
    secretStore,
  );
  const ephemeralAuthentication = new EphemeralAuthenticationSlot();
  const authenticationSessions = new AuthenticationSessionStore();

  const activeRunDefinitions = (): readonly VariableDefinition[] =>
    collectionRunVariableContext.getRunStore()?.toDefinitions() ??
    runVariableStore.toDefinitions();

  const getStaticVariableNames = (): ReadonlySet<string> => {
    const capture = environmentManager.capture();
    const names = new Set<string>();
    for (const variable of capture.globalVariables) {
      names.add(variable.name);
    }
    for (const variable of capture.workspaceVariables) {
      names.add(variable.name);
    }
    for (const variable of capture.active?.variables ?? []) {
      names.add(variable.name);
    }
    for (const variable of activeCollectionRunVariables) {
      names.add(variable.name);
    }
    return names;
  };

  const collectionWriter = new CollectionVariableWriter({
    store: collectionVariableStore,
    getCollectionRootPath: () =>
      collectionRunVariableContext.getCollectionRootPath(),
    getCollectionId: () => collectionRunVariableContext.getCollectionId(),
    resolveCollectionRootPathForSource,
    collectionIdForRoot,
  });
  const writer = new CompositeVariableWriter({
    overlay: runtimeOverlay,
    runStore: runVariableStore,
    environment: new NoOpVariableWriter(),
    workspace: new NoOpVariableWriter(),
    collection: collectionWriter,
    resolveRunStore: () => collectionRunVariableContext.getRunStore(),
  });
  const extractionObserver: PostExecutionObserver = {
    async onExecuted(input: {
      readonly sourceId: string;
      readonly requestKey: string;
      readonly request: AuthenticatedRequest;
      readonly result: ExecutionResult;
      readonly assertionReport: TestReport | undefined;
      readonly extractionRules: readonly import('../extraction').ExtractionRule[];
    }) {
      const engine = new DefaultExtractionEngine();
      return engine.apply(
        input.extractionRules,
        {
          result: input.result,
          assertionReport: input.assertionReport,
          requestKey: input.requestKey,
        },
        writer,
      );
    },
  };

  const executor = new DefaultRequestExecutor(new NodeHttpTransport());
  const orchestrator = new ExecutionOrchestrator(
    executor,
    new NoOpResultViewer(),
    new NoOpStatusPresenter(),
    new DirectProgressRunner(),
    new NoOpNotificationSink(),
    () => ({
      timeoutMs: 30_000,
      maxResponseBytes: 10 * 1024 * 1024,
    }),
    undefined,
    variableResolver,
    (document, requestKey) => {
      const key = requestKey ?? requestKeyFor(document.sourceId ?? '', 0);
      const snapshot = environmentManager.capture();
      return {
        definitions: [
          ...snapshot.globalVariables,
          ...snapshot.workspaceVariables,
          ...collectionDefinitionsForSource(document.sourceId),
          ...(snapshot.active?.variables ?? []),
          ...extractDocumentVariables(document).definitions,
          ...runtimeOverlay.getDefinitions({ requestKey: key }),
          ...activeRunDefinitions(),
        ],
      };
    },
    authenticationResolver,
    (_variables, meta) => {
      const ephemeral = ephemeralAuthentication.take();
      const collectionDefault =
        meta?.sourceId === undefined
          ? undefined
          : resolveCollectionDefaultAuthenticationId(meta.sourceId);
      return {
        ...authenticationProfiles.capture(),
        secrets: authenticationSecrets,
        sessions: authenticationSessions,
        ...(ephemeral === undefined ? {} : { ephemeral }),
        ...(collectionDefault === undefined
          ? {}
          : { collectionDefaultAuthenticationId: collectionDefault }),
      };
    },
    undefined,
    undefined,
    undefined,
    extractionObserver,
  );

  const sourceReader: CollectionRunSourceReader = {
    readText: (filePath) => reader.readText(filePath),
  };
  const runManager = new CollectionRunManager();
  const runner = new CollectionRunnerService({
    executor: {
      runAtSourceLocation: (source, options) =>
        orchestrator.runAtSourceLocation(source, {
          ...options,
          showViewer: false,
          useProgressUi: false,
          showNotifications: false,
        }),
    },
    sourceReader,
    progress: runManager,
  });

  const executorPort: CollectionRequestExecutorPort = {
    runAtSourceLocation: (source, options) =>
      orchestrator.runAtSourceLocation(source, {
        ...options,
        showViewer: false,
        useProgressUi: false,
        showNotifications: false,
      }),
  };

  return {
    workspaceRoot,
    logger,
    discovery,
    orchestrator,
    runner,
    runManager,
    collectionVariableStore,
    collectionRunContext: collectionRunVariableContext,
    sourceReader,
    executorPort,
    getStaticVariableNames,
    setActiveCollectionVariables,
    analyzeAndEnrich: async (plan, ports) => {
      // Ensure collection variables are cached before enrich/execute.
      const collection = discovery.snapshot?.collections[plan.collectionId];
      if (collection !== undefined) {
        await preloadCollectionVariables(
          collection.rootPath,
          plan.collectionId,
        );
      }
      return analyzeAndEnrichPlan(plan, ports);
    },
  };
}

async function analyzeAndEnrichPlan(
  plan: import('../collection-runner').RunPlan,
  ports: { readonly readText: (filePath: string) => Promise<string> },
): Promise<
  | { readonly ok: true; readonly plan: import('../collection-runner').RunPlan }
  | { readonly ok: false; readonly message: string }
> {
  const analyses = await analyzeRunPlanDependencies(plan, ports);
  return enrichRunPlanWithDependencies({ membershipPlan: plan, analyses });
}

export function createNodeCollectionVariableStorePorts(
  workspaceRoot: string,
): CollectionVariableStorePorts {
  const filesystem = new NodeProjectStoreFilesystem();
  const root = path.resolve(workspaceRoot);
  return {
    readText: (filePath) => filesystem.readText(filePath),
    writeText: (filePath, text) => filesystem.writeText(filePath, text),
    exists: (filePath) => filesystem.exists(filePath),
    createDirectory: (filePath) => filesystem.createDirectory(filePath),
    readLocalOverlay: async () => {
      const document = await readVariablesLocalOverlay(filesystem, root);
      return { collections: document.collections ?? {} };
    },
    writeLocalOverlay: async (collections) => {
      const existing = await readVariablesLocalOverlay(filesystem, root);
      await writeVariablesLocalOverlay(filesystem, root, {
        ...existing,
        collections,
      });
      return true;
    },
  };
}

class NodeProjectStoreFilesystem implements ProjectStoreFilesystem {
  public async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(toFsPath(filePath));
      return true;
    } catch {
      return false;
    }
  }

  public async createDirectory(filePath: string): Promise<void> {
    await fs.mkdir(toFsPath(filePath), { recursive: true });
  }

  public async readText(filePath: string): Promise<string> {
    return fs.readFile(toFsPath(filePath), 'utf8');
  }

  public async writeText(filePath: string, content: string): Promise<void> {
    const absolute = toFsPath(filePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, 'utf8');
  }

  public async delete(
    filePath: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    await fs.rm(toFsPath(filePath), {
      recursive: options?.recursive === true,
      force: true,
    });
  }

  public async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(toFsPath(oldPath), toFsPath(newPath));
  }

  public async copy(oldPath: string, newPath: string): Promise<void> {
    await fs.cp(toFsPath(oldPath), toFsPath(newPath), { recursive: true });
  }

  public async readDirectory(
    dirPath: string,
  ): Promise<readonly { readonly name: string; readonly type: 'file' | 'directory' }[]> {
    const entries = await fs.readdir(toFsPath(dirPath), { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    }));
  }
}

class InMemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  public async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  public async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  public async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

class EmptyVariableConfigurationRepository
  implements VariableConfigurationRepository
{
  public getSnapshot() {
    return {
      environments: [],
      globalVariables: [],
      workspaceVariables: [],
    };
  }
}

class EmptyAuthenticationProfileRepository
  implements AuthenticationProfileRepository
{
  public getProfiles() {
    return [];
  }

  public onDidChange(): { dispose(): void } {
    return {
      dispose(): void {
        /* no-op: headless host has no profile change events */
      },
    };
  }
}

class SilentLogSink implements LogSink {
  public appendLine(message: string): void {
    void message;
  }
}

class StderrLogSink implements LogSink {
  public appendLine(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}

class NoOpResultViewer implements ExecutionResultViewer {
  public show(): void {
    /* no-op: MCP does not open a response viewer */
  }
}

class NoOpStatusPresenter implements ExecutionStatusPresenter {
  public update(): void {
    /* no-op: MCP has no status bar */
  }
  public dispose(): void {
    /* no-op */
  }
}

class NoOpNotificationSink implements ExecutionNotificationSink {
  public error(): void {
    /* no-op: MCP surfaces errors via tool results */
  }
}

class DirectProgressRunner implements ExecutionProgressRunner {
  public run<T>(
    task: (
      signal: AbortSignal,
      reporter: { report(message: string): void },
    ) => Promise<T>,
  ): Promise<T> {
    return task(new AbortController().signal, {
      report(): void {
        /* no-op: MCP has no progress UI */
      },
    });
  }
}

/** Resolve workspace root from env or cwd. */
export function resolveMcpWorkspaceRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const fromEnv = env.APIHERO_WORKSPACE?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }
  return path.resolve(cwd);
}
