import type { ExtensionContext } from 'vscode';
import { languages, window } from 'vscode';

import {
  CommandRegistrar,
  createPlaceholderCommands,
  createRunRequestCommand,
  createRunRequestWithAssertionsCommand,
  createSelectAuthenticationCommand,
  createSwitchEnvironmentCommand,
} from './commands';
import {
  ApiKeyAuthenticationProvider,
  AuthenticationProfileManager,
  AuthenticationProviderRegistry,
  BasicAuthenticationProvider,
  BearerAuthenticationProvider,
  DefaultAuthenticationResolver,
  DefaultAuthenticationSecretRepository,
  NoneAuthenticationProvider,
} from './auth';
import { registerAssertions } from './assertions/vscode';
import {
  InMemoryRuntimeVariableOverlay,
  planCollectionVariablePersistRefresh,
  requestKeyFor,
} from './extraction';
import { registerExtraction } from './extraction/vscode';
import { normalizePathKey } from './collections';
import { registerCollections } from './collections/vscode';
import { createCollectionRunVariableContext } from './collection-runner';
import { registerCollectionRunner } from './collection-runner/vscode';
import {
  createHistoryInfrastructure,
  registerHistory,
} from './history/vscode';
import { registerOpenApiImport } from './openapi-import/vscode';
import { registerRequestEditor } from './request-editor/vscode';
import { EXTENSION_NAME, normalizeHistoryMaxEntries } from './constants';
import {
  API_LANGUAGE_ID,
  ApiRequestCodeLensProvider,
  registerLanguageProviders,
} from './language-support';
import {
  DefaultRequestExecutor,
  NodeHttpTransport,
} from './execution';
import {
  ExecutionOrchestrator,
} from './orchestration';
import {
  SuppressibleExecutionStatusPresenter,
  VsCodeExecutionNotificationSink,
  VsCodeExecutionProgressRunner,
  VsCodeExecutionStatusPresenter,
} from './orchestration/vscode';
import {
  VsCodeLogSink,
  VsCodeAuthenticationProfileRepository,
  VsCodeSettingsProvider,
  VsCodeVariableConfigurationRepository,
} from './providers';
import { SecretStorageService } from './storage';
import {
  ResponseViewerService,
} from './response';
import {
  createVsCodeResponseViewerHostActions,
  VsCodeResponsePanelFactory,
} from './response/vscode-response-panel';
import { Logger, fireAndForget } from './shared';
import type { VariableDefinition } from './models';
import {
  DefaultVariableResolver,
  EnvironmentManager,
  extractDocumentVariables,
  FilesystemCollectionVariableStore,
  InMemoryRunVariableStore,
} from './variables';
import {
  createCollectionVariableStorePorts,
  registerEnvironments,
} from './variables/vscode';
import { registerAuth } from './auth/vscode';
import { registerOverview } from './overview/vscode';
import { registerProjectStore } from './project-store/vscode';

/** Composes infrastructure adapters and registers extension entry points. */
export async function activate(context: ExtensionContext): Promise<void> {
  // Activation stays eager for correct DI order. Safe future deferred-load
  // candidates (documented in docs/release/marketplace-readiness.md): response
  // viewer HTML, OpenAPI import pipeline, and collection-runner UI helpers —
  // only after first command/view use, without changing registration order.
  const outputChannel = window.createOutputChannel(EXTENSION_NAME);
  const logger = new Logger(new VsCodeLogSink(outputChannel));
  const registrar = new CommandRegistrar(logger);
  const settingsProvider = new VsCodeSettingsProvider();
  // Migrate / load `.apihero` before EnvironmentManager first capture so
  // dual-read repositories prefer project files when present.
  const projectStoreRegistration = await registerProjectStore(context, logger);
  const environmentManager = new EnvironmentManager(
    new VsCodeVariableConfigurationRepository(),
  );
  const projectStoreEnvironmentSync =
    projectStoreRegistration.coordinator.onDidChange(() => {
      environmentManager.refresh();
    });
  const variableResolver = new DefaultVariableResolver();
  const runtimeOverlay = new InMemoryRuntimeVariableOverlay();
  const runVariableStore = new InMemoryRunVariableStore();
  // Phase 2: one process-wide holder for the active collection run's store +
  // identity (§3.6), and the filesystem-backed collection variable store
  // consulted by both the writer (extraction) and the resolver (below).
  const collectionRunVariableContext = createCollectionRunVariableContext();
  const collectionVariableStore = new FilesystemCollectionVariableStore(
    createCollectionVariableStorePorts(),
  );
  const collectionVariableCache = new Map<string, readonly VariableDefinition[]>();
  let activeCollectionRunVariables: readonly VariableDefinition[] = [];
  /**
   * Resolves the owning collection's root path for a single-request source
   * (§8.3 "Single request in a collection file"). Filled in once Collections
   * discovery is registered; returns `undefined` until then.
   */
  let resolveCollectionRootPathForSource: (
    sourceId: string,
  ) => string | undefined = () => undefined;
  /**
   * Best-effort synchronous lookup for collection variable definitions.
   * `getVariableContext` / `externalVariableContext` are synchronous, so a
   * cache miss triggers a background refresh and resolves with `[]` for the
   * current call — the next resolution picks up the loaded values.
   */
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
    const cached = collectionVariableCache.get(key);
    if (cached === undefined) {
      fireAndForget(
        collectionVariableStore.load(rootPath).then((definitions) => {
          collectionVariableCache.set(key, definitions);
        }),
        (error: unknown) => {
          logger.warning('Failed to load collection variables', {
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
      return [];
    }
    return cached;
  };
  const authenticationProfileRepository =
    new VsCodeAuthenticationProfileRepository();
  const authenticationProfiles = new AuthenticationProfileManager(
    authenticationProfileRepository,
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
  const secretStorage = new SecretStorageService(context.secrets);
  const authenticationSecrets = new DefaultAuthenticationSecretRepository(
    secretStorage,
  );
  /**
   * Active run-scope definitions: collection-run store while a collection
   * execute is active, otherwise the session store (Phase 1 single-request).
   * Must match CompositeVariableWriter.resolveRunStore (§8.2 / §9.3).
   */
  const activeRunDefinitions = (): readonly VariableDefinition[] =>
    collectionRunVariableContext.getRunStore()?.toDefinitions() ??
    runVariableStore.toDefinitions();

  /**
   * After any successful collection-scope persist, reload definitions into
   * `collectionVariableCache` for that root (so single-request resolve sees
   * Create Variable / extract writes). Also refresh the active-run snapshot
   * when the persist belongs to the collection currently executing.
   */
  const refreshCollectionVariablesAfterPersist = async (persisted: {
    readonly rootPath: string;
    readonly collectionId: string;
  }): Promise<void> => {
    try {
      const definitions = await collectionVariableStore.load(
        persisted.rootPath,
        persisted.collectionId,
      );
      const plan = planCollectionVariablePersistRefresh({
        persistedRootPath: persisted.rootPath,
        definitions,
        isCollectionRunActive: collectionRunVariableContext.isActive(),
        activeRootPath: collectionRunVariableContext.getCollectionRootPath(),
        normalizeKey: normalizePathKey,
      });
      collectionVariableCache.set(plan.cacheKey, plan.definitions);
      if (plan.updateActiveRunSnapshot) {
        activeCollectionRunVariables = plan.definitions;
      }
    } catch (error: unknown) {
      logger.warning('Failed to refresh collection variables after write', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  /**
   * Names of variables statically defined outside the run store — env
   * (global/workspace/active) + active collection variables (§6.7). Evaluated
   * fresh per pre-flight check so mid-run collection variable refreshes are
   * visible to `CollectionRunnerService`'s dependency skip logic.
   */
  const staticVariableNamesForRun = (): ReadonlySet<string> => {
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

  /** Global + workspace + active env (+ optional overlay/run for IntelliSense). */
  const externalVariableContext = (requestKey?: string) => {
    const snapshot = environmentManager.capture();
    const sourceId = window.activeTextEditor?.document.uri.toString() ?? '';
    const key = requestKey ?? requestKeyFor(sourceId, 0);
    return {
      definitions: [
        ...snapshot.globalVariables,
        ...snapshot.workspaceVariables,
        ...collectionDefinitionsForSource(sourceId),
        ...(snapshot.active?.variables ?? []),
        ...runtimeOverlay.getDefinitions({ requestKey: key }),
        ...activeRunDefinitions(),
      ],
    };
  };
  const assertionsRegistration = registerAssertions(context);
  const extractionRegistration = registerExtraction({
    context,
    environmentManager,
    overlay: runtimeOverlay,
    runStore: runVariableStore,
    collectionVariableStore,
    collectionRunContext: collectionRunVariableContext,
    onCollectionVariablePersisted: refreshCollectionVariablesAfterPersist,
    resolveCollectionRootPathForSource: (sourceId) =>
      resolveCollectionRootPathForSource(sourceId),
  });
  const responseViewer = new ResponseViewerService(
    new VsCodeResponsePanelFactory(),
    undefined,
    createVsCodeResponseViewerHostActions({
      writer: extractionRegistration.writer,
    }),
    {
      getKnownVariableNames: (context) => {
        const snapshot = environmentManager.capture();
        const names = new Set<string>();
        for (const variable of snapshot.globalVariables) {
          names.add(variable.name);
        }
        for (const variable of snapshot.workspaceVariables) {
          names.add(variable.name);
        }
        for (const variable of snapshot.active?.variables ?? []) {
          names.add(variable.name);
        }
        for (const variable of activeRunDefinitions()) {
          names.add(variable.name);
        }
        const sourceId =
          context?.sourceId
          ?? window.activeTextEditor?.document.uri.toString()
          ?? '';
        for (const variable of collectionDefinitionsForSource(sourceId)) {
          names.add(variable.name);
        }
        if (context?.requestKey !== undefined) {
          for (const variable of runtimeOverlay.getDefinitions({
            requestKey: context.requestKey,
          })) {
            names.add(variable.name);
          }
        }
        return [...names];
      },
      variableWriter: extractionRegistration.writer,
    },
  );
  const executor = new DefaultRequestExecutor(new NodeHttpTransport());
  const historyInfrastructure = createHistoryInfrastructure(
    context,
    normalizeHistoryMaxEntries(
      settingsProvider.getSettings().historyMaxEntries,
    ),
    logger,
  );
  /**
   * Single capture-context provider for history. Filled after
   * {@link registerHistory}; orchestrator invokes it only at commit time.
   */
  let getHistoryCaptureContext: () => {
    readonly environmentName?: string;
    readonly collectionName?: string;
  } = () => ({});
  const executionStatusPresenter = new SuppressibleExecutionStatusPresenter(
    new VsCodeExecutionStatusPresenter(),
  );
  const orchestrator = new ExecutionOrchestrator(
    executor,
    responseViewer,
    executionStatusPresenter,
    new VsCodeExecutionProgressRunner(),
    new VsCodeExecutionNotificationSink(),
    () => {
      const settings = settingsProvider.getSettings();
      return {
        timeoutMs: settings.requestTimeout,
        maxResponseBytes: settings.maxResponseBytes,
      };
    },
    undefined,
    variableResolver,
    (document, requestKey) => {
      const key =
        requestKey ?? requestKeyFor(document.sourceId ?? '', 0);
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
    () => ({
      ...authenticationProfiles.capture(),
      secrets: authenticationSecrets,
    }),
    historyInfrastructure.recorder,
    () => getHistoryCaptureContext(),
    assertionsRegistration.observer,
    extractionRegistration.observer,
  );
  const registrations = registrar.register([
    createRunRequestCommand(orchestrator),
    createRunRequestWithAssertionsCommand(orchestrator),
    createSwitchEnvironmentCommand(environmentManager),
    createSelectAuthenticationCommand(authenticationProfiles),
    ...createPlaceholderCommands(),
  ]);
  const languageRegistrations = registerLanguageProviders(
    () => settingsProvider.getSettings().languageFeatures,
    logger,
    externalVariableContext,
    (listener) => {
      const environmentRegistration = environmentManager.onDidChange(listener);
      const authenticationRegistration =
        authenticationProfiles.onDidChange(listener);
      const secretRegistration = secretStorage.onDidChange(listener);
      return {
        dispose: () => {
          environmentRegistration.dispose();
          authenticationRegistration.dispose();
          secretRegistration.dispose();
        },
      };
    },
    () => {
      const snapshot = authenticationProfiles.capture();
      return {
        validation: { profiles: snapshot.profiles, issues: snapshot.issues },
        providerIds: authenticationRegistry.list().map((provider) => provider.id),
        secrets: authenticationSecrets,
      };
    },
  );
  const variableConfigurationRegistration = settingsProvider.onDidChange(
    () => environmentManager.refresh(),
  );
  const historyRetentionRegistration = settingsProvider.onDidChange(
    (settings) => {
      fireAndForget(
        historyInfrastructure.repository.setMaxEntries(
          settings.historyMaxEntries,
        ),
        (error: unknown) => {
          logger.warning('Failed to update history retention', {
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
    },
  );
  const codeLensRegistration = languages.registerCodeLensProvider(
    { language: API_LANGUAGE_ID },
    new ApiRequestCodeLensProvider(),
  );
  const collectionsRegistration = registerCollections(context, logger);
  resolveCollectionRootPathForSource = (sourceId) => {
    const snapshot = collectionsRegistration.discovery.snapshot;
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
  const historyRegistration = registerHistory({
    context,
    logger,
    orchestrator,
    environmentManager,
    infrastructure: historyInfrastructure,
  });
  getHistoryCaptureContext = historyRegistration.getCaptureContext;
  registerCollectionRunner({
    context,
    logger,
    discovery: collectionsRegistration.discovery,
    orchestrator,
    collectionsTreeView: collectionsRegistration.treeView,
    getHistoryCaptureContext: () => getHistoryCaptureContext(),
    setRequestStatusSuppressed: (suppressed) => {
      executionStatusPresenter.setSuppressed(suppressed);
    },
    collectionRunContext: collectionRunVariableContext,
    collectionVariableStore,
    setActiveCollectionVariables: (variables) => {
      activeCollectionRunVariables = variables;
    },
    getStaticVariableNames: staticVariableNamesForRun,
  });
  registerOpenApiImport({
    context,
    logger,
    discovery: collectionsRegistration.discovery,
  });
  registerRequestEditor({
    context,
    orchestrator,
    discovery: collectionsRegistration.discovery,
    getAuthProfiles: () =>
      authenticationProfiles.list().map((profile) => ({
        id: profile.id,
        label: profile.label?.trim() || profile.id,
      })),
    variableResolver,
    getExternalVariableDefinitions: () =>
      externalVariableContext().definitions,
    getStaticVariableNames: staticVariableNamesForRun,
    getActiveEnvironmentLabel: () => {
      const activeId = environmentManager.activeId;
      if (activeId === undefined) {
        return undefined;
      }
      return environmentManager.list().find(
        (environment) => environment.id === activeId,
      )?.name;
    },
  });
  registerEnvironments({
    context,
    environmentManager,
  });
  registerAuth({
    context,
    profileManager: authenticationProfiles,
    secrets: authenticationSecrets,
  });
  registerOverview({
    context,
    historyRepository: historyInfrastructure.repository,
    discovery: collectionsRegistration.discovery,
  });

  context.subscriptions.push(
    outputChannel,
    orchestrator,
    responseViewer,
    codeLensRegistration,
    variableConfigurationRegistration,
    historyRetentionRegistration,
    projectStoreEnvironmentSync,
    ...registrations,
    ...languageRegistrations,
  );
  logger.info('Extension activated');
}

/** Releases no resources beyond those owned by the extension context. */
export function deactivate(): void {}
