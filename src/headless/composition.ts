/**
 * Headless DI composition for API Hero CLI / MCP hosts.
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
import type {
  AuthenticatedRequest,
  AuthenticationProfile,
  Environment,
  VariableDefinition,
} from '../models';
import {
  ExecutionOrchestrator,
  type ExecutionNotificationSink,
  type ExecutionProgressRunner,
  type ExecutionResultViewer,
  type ExecutionStatusPresenter,
  type PostExecutionObserver,
} from '../orchestration';
import {
  ProjectStoreService,
  readVariablesLocalOverlay,
  writeVariablesLocalOverlay,
  type ProjectStoreFilesystem,
} from '../project-store';
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
  type VariableConfigurationSnapshot,
  type VariableResolver,
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
  readonly variableResolver: VariableResolver;
  readonly environmentManager: EnvironmentManager;
  readonly getExternalVariableDefinitions: () => readonly VariableDefinition[];
  readonly fileExists: (filePath: string) => Promise<boolean>;
  readonly getStaticVariableNames: () => ReadonlySet<string>;
  readonly setActiveCollectionVariables: (
    variables: readonly VariableDefinition[],
  ) => void;
  /**
   * Load collection variables into the per-collection cache used by single-
   * request resolution when no collection run context is active.
   */
  readonly preloadCollectionVariables: (
    rootPath: string,
    collectionId: string,
  ) => Promise<readonly VariableDefinition[]>;
  readonly analyzeAndEnrich: typeof analyzeAndEnrichPlan;
}

export interface CreateHeadlessApiHeroRuntimeOptions {
  readonly workspaceRoot: string;
  /** When true, logger writes to stderr; otherwise silent. Default false. */
  readonly verbose?: boolean;
  /** Optional active environment id/name override (--environment). */
  readonly environmentId?: string;
  /** Injectable process env for secrets + tests. Default process.env */
  readonly env?: NodeJS.ProcessEnv;
}

/** Composes a fully wired headless API Hero runtime for one workspace root. */
export async function createHeadlessApiHeroRuntime(
  options: CreateHeadlessApiHeroRuntimeOptions,
): Promise<HeadlessApiHeroRuntime> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const processEnv = options.env ?? process.env;
  const logger = new Logger(
    options.verbose === true ? new StderrLogSink() : new SilentLogSink(),
  );

  const filesystem = new NodeProjectStoreFilesystem();
  const projectSnapshot = await loadProjectStoreSnapshot(
    filesystem,
    workspaceRoot,
  );

  const environmentManager = new EnvironmentManager(
    new SnapshotVariableConfigurationRepository({
      environments: projectSnapshot.environments,
      workspaceVariables: projectSnapshot.workspaceVariables,
      globalVariables: [],
      ...(projectSnapshot.activeEnvironmentId === undefined
        ? {}
        : { activeEnvironmentId: projectSnapshot.activeEnvironmentId }),
    }),
  );

  if (options.environmentId !== undefined && options.environmentId.trim().length > 0) {
    const resolved = resolveEnvironmentSelector(
      environmentManager.list(),
      options.environmentId.trim(),
    );
    environmentManager.switchActive(resolved);
  }

  const variableResolver = new DefaultVariableResolver();
  const runtimeOverlay = new InMemoryRuntimeVariableOverlay();
  const runVariableStore = new InMemoryRunVariableStore();
  const collectionRunVariableContext = createCollectionRunVariableContext();
  const collectionVariableStore = new FilesystemCollectionVariableStore(
    createNodeCollectionVariableStorePorts(workspaceRoot, filesystem),
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
    new SnapshotAuthenticationProfileRepository(projectSnapshot.profiles),
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
  const secretStore = new ProcessEnvSecretStore(processEnv);
  const authenticationSecrets = new DefaultAuthenticationSecretRepository(
    secretStore,
  );
  const ephemeralAuthentication = new EphemeralAuthenticationSlot();
  const authenticationSessions = new AuthenticationSessionStore();

  const activeRunDefinitions = (): readonly VariableDefinition[] =>
    collectionRunVariableContext.getRunStore()?.toDefinitions() ??
    runVariableStore.toDefinitions();

  const getExternalVariableDefinitions = (): readonly VariableDefinition[] => {
    const capture = environmentManager.capture();
    return [
      ...capture.globalVariables,
      ...capture.workspaceVariables,
      ...(capture.active?.variables ?? []),
      ...activeCollectionRunVariables,
    ];
  };

  const getStaticVariableNames = (): ReadonlySet<string> => {
    const names = new Set<string>();
    for (const variable of getExternalVariableDefinitions()) {
      names.add(variable.name);
    }
    return names;
  };

  const fileExists = async (filePath: string): Promise<boolean> => {
    try {
      await fs.access(toFsPath(filePath));
      return true;
    } catch {
      return false;
    }
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
    variableResolver,
    environmentManager,
    getExternalVariableDefinitions,
    fileExists,
    getStaticVariableNames,
    setActiveCollectionVariables,
    preloadCollectionVariables,
    analyzeAndEnrich: async (plan, ports) => {
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
  filesystem: ProjectStoreFilesystem = new NodeProjectStoreFilesystem(),
): CollectionVariableStorePorts {
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

/** Match environment by id first, then by name (case-sensitive). */
export function resolveEnvironmentSelector(
  environments: readonly Environment[],
  selector: string,
): string {
  const byId = environments.find((environment) => environment.id === selector);
  if (byId !== undefined) {
    return byId.id;
  }
  const byName = environments.find(
    (environment) => environment.name === selector,
  );
  if (byName !== undefined) {
    return byName.id;
  }
  throw new Error(`Unknown environment "${selector}".`);
}

async function loadProjectStoreSnapshot(
  filesystem: ProjectStoreFilesystem,
  workspaceRoot: string,
): Promise<{
  readonly environments: readonly Environment[];
  readonly workspaceVariables: readonly VariableDefinition[];
  readonly activeEnvironmentId?: string;
  readonly profiles: readonly AuthenticationProfile[];
}> {
  const service = new ProjectStoreService({ filesystem });
  const metadata = await service.readProjectMetadata(workspaceRoot);
  if (metadata === undefined) {
    return {
      environments: [],
      workspaceVariables: [],
      profiles: [],
    };
  }
  return {
    environments: metadata.environments,
    workspaceVariables: metadata.workspaceVariables,
    ...(metadata.activeEnvironmentId === undefined
      ? {}
      : { activeEnvironmentId: metadata.activeEnvironmentId }),
    profiles: metadata.authenticationProfiles,
  };
}

export class NodeProjectStoreFilesystem implements ProjectStoreFilesystem {
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

/**
 * SecretStore for CI/headless hosts.
 *
 * Lookup order for `get(key)`:
 * 1. Exact Secret Storage key from `env` (e.g. `apiHero.auth.profile.demo.token`)
 * 2. `APIHERO_SECRET_<key with '.' replaced by '_'>`
 *    (e.g. `APIHERO_SECRET_apiHero_auth_profile_demo_token`)
 * 3. Optional in-memory seed map (tests / `set`)
 *
 * `set` / `delete` only mutate the in-memory map (not process.env).
 */
export class ProcessEnvSecretStore implements SecretStore {
  private readonly memory = new Map<string, string>();

  public constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    seed?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
  ) {
    if (seed !== undefined) {
      if (seed instanceof Map) {
        for (const [key, value] of seed) {
          this.memory.set(key, value);
        }
      } else {
        for (const [key, value] of Object.entries(seed)) {
          this.memory.set(key, value);
        }
      }
    }
  }

  public async get(key: string): Promise<string | undefined> {
    const exact = this.env[key];
    if (exact !== undefined && exact.length > 0) {
      return exact;
    }
    const aliased = this.env[toApiHeroSecretEnvName(key)];
    if (aliased !== undefined && aliased.length > 0) {
      return aliased;
    }
    return this.memory.get(key);
  }

  public async set(key: string, value: string): Promise<void> {
    this.memory.set(key, value);
  }

  public async delete(key: string): Promise<void> {
    this.memory.delete(key);
  }
}

/** Maps a Secret Storage key to the `APIHERO_SECRET_*` process env name. */
export function toApiHeroSecretEnvName(secretKey: string): string {
  return `APIHERO_SECRET_${secretKey.replace(/\./g, '_')}`;
}

class SnapshotVariableConfigurationRepository
  implements VariableConfigurationRepository
{
  public constructor(
    private readonly snapshot: VariableConfigurationSnapshot,
  ) {}

  public getSnapshot(): VariableConfigurationSnapshot {
    return this.snapshot;
  }
}

class SnapshotAuthenticationProfileRepository
  implements AuthenticationProfileRepository
{
  public constructor(
    private readonly profiles: readonly AuthenticationProfile[],
  ) {}

  public getProfiles(): readonly AuthenticationProfile[] {
    return this.profiles;
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
    /* no-op: headless hosts do not open a response viewer */
  }
}

class NoOpStatusPresenter implements ExecutionStatusPresenter {
  public update(): void {
    /* no-op: headless has no status bar */
  }
  public dispose(): void {
    /* no-op */
  }
}

class NoOpNotificationSink implements ExecutionNotificationSink {
  public error(): void {
    /* no-op: headless surfaces errors via CLI / MCP results */
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
        /* no-op: headless has no progress UI */
      },
    });
  }
}

/** Injectable inputs for {@link resolveMcpWorkspaceRoot}. */
export type ResolveMcpWorkspaceRootOptions = {
  readonly cliWorkspace?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
};

/**
 * Resolve MCP/CLI workspace root.
 * Priority: CLI `--workspace` → `APIHERO_WORKSPACE` env → cwd.
 * Injectable for tests; does not invent filesystem discovery.
 * Relative CLI/env paths resolve against the injectable `cwd`.
 */
export function resolveMcpWorkspaceRoot(
  options: ResolveMcpWorkspaceRootOptions = {},
): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const fromCli = options.cliWorkspace?.trim();
  if (fromCli !== undefined && fromCli.length > 0) {
    return path.resolve(cwd, fromCli);
  }
  const fromEnv = env.APIHERO_WORKSPACE?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return path.resolve(cwd, fromEnv);
  }
  return path.resolve(cwd);
}
