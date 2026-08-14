import type { ExtensionContext } from 'vscode';
import { commands, languages, Position, Uri, window, workspace } from 'vscode';

import {
  CommandRegistrar,
  createCopyAsCurlCommand,
  createPlaceholderCommands,
  createRunRequestCommand,
  createRunRequestWithAssertionsCommand,
  createSelectAuthenticationCommand,
  createSwitchEnvironmentCommand,
  type RunRequestCommandOptions,
} from './commands';
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
  summarizeAuthenticationProfileForUi,
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
import {
  CollectionRunManager,
  createCollectionRunVariableContext,
} from './collection-runner';
import {
  CollectionRunReportPanel,
  registerCollectionRunner,
  registerExecutionView,
} from './collection-runner/vscode';
import {
  createHistoryInfrastructure,
  registerHistory,
} from './history/vscode';
import { registerCurlImport } from './curl/vscode';
import { registerOpenApiImport, registerPostmanImport, registerInsomniaImport } from './openapi-import/vscode';
import { registerRequestEditor } from './request-editor/vscode';
import { registerScenarios } from './scenarios/vscode';
import { registerSourceIntegration } from './source-integration/vscode';
import { COMMAND_IDS, EXTENSION_NAME, normalizeHistoryMaxEntries } from './constants';
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
  type ResponsePresentation,
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
import {
  registerProjectStore,
  registerResetWorkspace,
} from './project-store/vscode';
import { registerProjectPackage } from './project-package/vscode';
import { VsCodeCollectionFilesystem } from './collections/vscode/mutation-filesystem';
import {
  createVsCodeNamespaceMigrationPorts,
  migrateConfigurationNamespace,
} from './migration';

/** Composes infrastructure adapters and registers extension entry points. */
export async function activate(context: ExtensionContext): Promise<void> {
  // Activation stays eager for correct DI order. Safe future deferred-load
  // candidates (documented in docs/release/marketplace-readiness.md): response
  // viewer HTML, OpenAPI import pipeline, and collection-runner UI helpers —
  // only after first command/view use, without changing registration order.
  const outputChannel = window.createOutputChannel(EXTENSION_NAME);
  const logger = new Logger(new VsCodeLogSink(outputChannel));
  try {
    await migrateConfigurationNamespace(
      context.globalState,
      createVsCodeNamespaceMigrationPorts(),
    );
  } catch (error) {
    logger.warning('Configuration namespace migration failed; continuing activation', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const registrar = new CommandRegistrar(logger);
  const settingsProvider = new VsCodeSettingsProvider();
  // Migrate / load `.apihero` before EnvironmentManager first capture so
  // dual-read repositories prefer project files when present.
  const projectStoreRegistration = await registerProjectStore(context, logger);
  registerProjectPackage({ context, logger });
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
  /** Listeners notified when collection (or other external) catalog definitions change. */
  const variableCatalogListeners = new Set<() => void>();
  const notifyVariableCatalogChanged = (): void => {
    for (const listener of variableCatalogListeners) {
      listener();
    }
  };
  const onVariableCatalogChanged = (listener: () => void): { dispose: () => void } => {
    variableCatalogListeners.add(listener);
    return {
      dispose: () => {
        variableCatalogListeners.delete(listener);
      },
    };
  };
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
          notifyVariableCatalogChanged();
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
  const ephemeralAuthentication = new EphemeralAuthenticationSlot();
  const authenticationSessions = new AuthenticationSessionStore();
  const rawSessions = context.workspaceState.get<unknown>(
    'apiHero.authentication.sessions',
  );
  if (Array.isArray(rawSessions)) {
    authenticationSessions.replaceAll(
      rawSessions.filter(
        (entry): entry is import('./auth').AuthenticationSession =>
          entry !== null &&
          typeof entry === 'object' &&
          typeof (entry as { authenticationId?: unknown }).authenticationId ===
            'string' &&
          typeof (entry as { status?: unknown }).status === 'string',
      ),
    );
  }
  let resolveCollectionDefaultAuthenticationId: (
    sourceId: string,
  ) => string | undefined = () => undefined;
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
      notifyVariableCatalogChanged();
    } catch (error: unknown) {
      logger.warning('Failed to refresh collection variables after write', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  /**
   * Environment variables for an in-flight collection run. Uses the Run Setup
   * override when present; otherwise the session active environment.
   */
  const environmentDefinitionsForRun = (): readonly VariableDefinition[] => {
    const override = collectionRunVariableContext.getEnvironmentOverride();
    if (override === undefined) {
      return environmentManager.capture().active?.variables ?? [];
    }
    if (override.environmentId === undefined) {
      return [];
    }
    return (
      environmentManager.list().find((environment) => environment.id === override.environmentId)
        ?.variables ?? []
    );
  };

  /**
   * Names of variables statically defined outside the run store — env
   * (global/workspace/active-or-override) + active collection variables (§6.7).
   * Evaluated fresh per pre-flight check so mid-run collection variable refreshes
   * are visible to `CollectionRunnerService`'s dependency skip logic.
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
    for (const variable of environmentDefinitionsForRun()) {
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
    const environmentName = snapshot.active?.name;
    const environmentDefinitions = (snapshot.active?.variables ?? []).map(
      (variable) =>
        environmentName === undefined || environmentName.length === 0
          ? variable
          : {
              ...variable,
              environmentName,
            },
    );
    return {
      definitions: [
        ...snapshot.globalVariables,
        ...snapshot.workspaceVariables,
        ...collectionDefinitionsForSource(sourceId),
        ...environmentDefinitions,
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
  const useResponseAsAuthenticationHandler: {
    current?: (body: unknown) => Promise<void>;
  } = {};
  const responseViewer = new ResponseViewerService(
    new VsCodeResponsePanelFactory(),
    undefined,
    createVsCodeResponseViewerHostActions({
      writer: extractionRegistration.writer,
      useResponseAsAuthentication: (body) =>
        useResponseAsAuthenticationHandler.current?.(body),
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
      getPresentOptions: () => {
        const environmentName = environmentManager.capture().active?.name?.trim();
        const timeoutMs = settingsProvider.getSettings().requestTimeout;
        return {
          ...(environmentName === undefined || environmentName.length === 0
            ? {}
            : { environmentLabel: environmentName }),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        };
      },
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
  registerResetWorkspace({
    context,
    logger,
    filesystem: new VsCodeCollectionFilesystem(),
    secrets: authenticationSecrets,
    clearHistory: async () => {
      const entries = await historyInfrastructure.repository.list({ limit: 1 });
      if (entries.length === 0) {
        return false;
      }
      await historyInfrastructure.repository.clear();
      return true;
    },
    projectStoreCoordinator: projectStoreRegistration.coordinator,
    authenticationSessions,
    environmentManager,
  });
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
          ...environmentDefinitionsForRun(),
          ...extractDocumentVariables(document).definitions,
          ...runtimeOverlay.getDefinitions({ requestKey: key }),
          ...activeRunDefinitions(),
        ],
      };
    },
    authenticationResolver,
    (_variables, meta) => {
      const ephemeral = ephemeralAuthentication.take();
      const skipCollectionDefault =
        collectionRunVariableContext.getAuthenticationPreference() === 'resolved';
      const collectionDefault =
        skipCollectionDefault || meta?.sourceId === undefined
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
    historyInfrastructure.recorder,
    () => getHistoryCaptureContext(),
    assertionsRegistration.observer,
    extractionRegistration.observer,
  );
  const mappedRunHolder: {
    current?: RunRequestCommandOptions['resolveMappedRequest'];
  } = {};
  const registrations = registrar.register([
    createRunRequestCommand(orchestrator, {
      resolveMappedRequest: async (argument) =>
        mappedRunHolder.current?.(argument),
    }),
    createRunRequestWithAssertionsCommand(orchestrator, {
      resolveMappedRequest: async (argument) =>
        mappedRunHolder.current?.(argument),
    }),
    createCopyAsCurlCommand(orchestrator),
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
      const catalogRegistration = onVariableCatalogChanged(listener);
      return {
        dispose: () => {
          environmentRegistration.dispose();
          authenticationRegistration.dispose();
          secretRegistration.dispose();
          catalogRegistration.dispose();
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
  resolveCollectionDefaultAuthenticationId = (sourceId) => {
    const snapshot = collectionsRegistration.discovery.snapshot;
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
  const historyRegistration = registerHistory({
    context,
    logger,
    orchestrator,
    environmentManager,
    infrastructure: historyInfrastructure,
  });
  getHistoryCaptureContext = historyRegistration.getCaptureContext;
  const collectionRunManager = new CollectionRunManager();
  const collectionRunReportPanel = new CollectionRunReportPanel({
    openRequest: async (requestId) => {
      await commands.executeCommand(COMMAND_IDS.openCollectionRequest, requestId);
    },
    revealRequest: async (requestId) => {
      await commands.executeCommand(COMMAND_IDS.openCollectionRequest, requestId);
      await commands.executeCommand(COMMAND_IDS.focusCollections);
    },
    compareRuns: async (requestId, current) => {
      const previous = findPreviousCollectionPresentation(
        collectionRunManager,
        requestId,
        current,
      );
      if (previous === undefined) {
        await window.showInformationMessage(
          'No previous collection run presentation is available for this request. Run the collection again, then Compare Runs.',
        );
        return;
      }
      responseViewer.showDiff(previous.presentation, current, {
        leftLabel: previous.label,
        rightLabel: 'Current',
      });
    },
  });
  registerExecutionView({
    context,
    manager: collectionRunManager,
    reportPanel: collectionRunReportPanel,
    discovery: collectionsRegistration.discovery,
    collectionsTreeView: collectionsRegistration.treeView,
  });
  registerCollectionRunner({
    context,
    logger,
    discovery: collectionsRegistration.discovery,
    orchestrator,
    collectionsTreeView: collectionsRegistration.treeView,
    collectionRunManager,
    reportPanel: collectionRunReportPanel,
    setRequestStatusSuppressed: (suppressed) => {
      executionStatusPresenter.setSuppressed(suppressed);
    },
    collectionRunContext: collectionRunVariableContext,
    collectionVariableStore,
    setActiveCollectionVariables: (variables) => {
      activeCollectionRunVariables = variables;
    },
    getStaticVariableNames: staticVariableNamesForRun,
    environmentManager,
    getAuthenticationSnapshot: () => {
      const snapshot = authenticationProfiles.capture();
      return {
        profiles: snapshot.profiles.map(summarizeAuthenticationProfileForUi),
        ...(snapshot.defaultProfileId === undefined
          ? {}
          : { defaultProfileId: snapshot.defaultProfileId }),
      };
    },
    onAuthenticationChanged: (listener) =>
      authenticationProfiles.onDidChange(listener),
    responseViewer,
  });
  registerScenarios({
    context,
    logger,
    orchestrator,
    discovery: collectionsRegistration.discovery,
    variableResolver,
    getExternalVariableDefinitions: () =>
      externalVariableContext().definitions,
    collectionRunContext: collectionRunVariableContext,
  });
  registerOpenApiImport({
    context,
    logger,
    discovery: collectionsRegistration.discovery,
    environmentManager,
  });
  registerPostmanImport({
    context,
    logger,
    discovery: collectionsRegistration.discovery,
    environmentManager,
  });
  registerInsomniaImport({
    context,
    logger,
    discovery: collectionsRegistration.discovery,
    environmentManager,
  });
  registerCurlImport({ context });
  registerEnvironments({
    context,
    environmentManager,
  });
  const authRegistration = registerAuth({
    context,
    profileManager: authenticationProfiles,
    secrets: authenticationSecrets,
    executor,
    sessions: authenticationSessions,
    discovery: collectionsRegistration.discovery,
  });
  useResponseAsAuthenticationHandler.current = async (body) => {
    const { runUseResponseAsAuthenticationCommand } = await import(
      './auth/vscode/auth-commands.js'
    );
    await runUseResponseAsAuthenticationCommand(authRegistration.services, body);
  };
  registerRequestEditor({
    context,
    orchestrator,
    discovery: collectionsRegistration.discovery,
    mutation: collectionsRegistration.mutation,
    getAuthProfiles: () =>
      authenticationProfiles.list().map((profile) => {
        const summary = summarizeAuthenticationProfileForUi(profile);
        const option: {
          id: string;
          label: string;
          providerId: string;
          name?: string;
          location?: 'header' | 'query';
          apiKeyName?: string;
          apiKeyLocation?: 'header' | 'query';
          fields: typeof summary.fields;
        } = {
          id: summary.id,
          label: summary.label,
          providerId: summary.providerId,
          fields: summary.fields,
        };
        if (summary.apiKeyName !== undefined) {
          option.name = summary.apiKeyName;
          option.apiKeyName = summary.apiKeyName;
        }
        if (summary.apiKeyLocation !== undefined) {
          option.location = summary.apiKeyLocation;
          option.apiKeyLocation = summary.apiKeyLocation;
        }
        return option;
      }),
    ephemeralAuthentication,
    authServices: () => authRegistration.services,
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
    onExternalVariablesChanged: (listener) => {
      const environmentRegistration = environmentManager.onDidChange(listener);
      const catalogRegistration = onVariableCatalogChanged(listener);
      const authenticationRegistration =
        authenticationProfiles.onDidChange(listener);
      const discoveryRegistration =
        collectionsRegistration.discovery.onDidChange(listener);
      return {
        dispose: () => {
          environmentRegistration.dispose();
          catalogRegistration.dispose();
          authenticationRegistration.dispose();
          discoveryRegistration.dispose();
        },
      };
    },
  });
  registerOverview({
    context,
    historyRepository: historyInfrastructure.repository,
    discovery: collectionsRegistration.discovery,
  });
  const sourceIntegration = registerSourceIntegration({
    context,
    logger,
    discovery: collectionsRegistration.discovery,
  });
  mappedRunHolder.current = async (argument) => {
    const request = await sourceIntegration.resolveMappedRun(argument);
    if (request === undefined) {
      return undefined;
    }
    const document = await workspace.openTextDocument(Uri.parse(request.filePath));
    return {
      text: document.getText(),
      sourceId: document.uri.toString(),
      offset: document.offsetAt(
        new Position(request.range.start.line, request.range.start.column),
      ),
    };
  };

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

/**
 * Finds the most recent prior collection-run presentation for a request id
 * from {@link CollectionRunManager.listRecent}, skipping the current snapshot
 * when it is the same object reference as `current`.
 */
function findPreviousCollectionPresentation(
  manager: CollectionRunManager,
  requestId: string,
  current: ResponsePresentation,
): { readonly presentation: ResponsePresentation; readonly label: string } | undefined {
  const recent = manager.listRecent();
  for (const session of recent) {
    const match = session.results.find(
      (result) =>
        result.requestId === requestId && result.presentation !== undefined,
    );
    if (match?.presentation === undefined) {
      continue;
    }
    if (match.presentation === current) {
      continue;
    }
    const started =
      session.completedAt
      ?? session.startedAt
      ?? session.runId;
    return {
      presentation: match.presentation,
      label: `Run A (${started})`,
    };
  }
  return undefined;
}

/** Releases no resources beyond those owned by the extension context. */
export function deactivate(): void {}
