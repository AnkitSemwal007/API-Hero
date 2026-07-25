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
  requestKeyFor,
} from './extraction';
import { registerExtraction } from './extraction/vscode';
import { registerCollections } from './collections/vscode';
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
import {
  DefaultVariableResolver,
  EnvironmentManager,
  extractDocumentVariables,
  InMemoryRunVariableStore,
} from './variables';
import { registerEnvironments } from './variables/vscode';
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
  /** Global + workspace + active env (+ optional overlay/run for IntelliSense). */
  const externalVariableContext = (requestKey?: string) => {
    const snapshot = environmentManager.capture();
    const key =
      requestKey ??
      requestKeyFor(
        window.activeTextEditor?.document.uri.toString() ?? '',
        0,
      );
    return {
      definitions: [
        ...snapshot.globalVariables,
        ...snapshot.workspaceVariables,
        // collection: empty until Phase 2
        ...(snapshot.active?.variables ?? []),
        ...runtimeOverlay.getDefinitions({ requestKey: key }),
        ...runVariableStore.toDefinitions(),
      ],
    };
  };
  const responseViewer = new ResponseViewerService(
    new VsCodeResponsePanelFactory(),
    undefined,
    createVsCodeResponseViewerHostActions(),
  );
  const executor = new DefaultRequestExecutor(new NodeHttpTransport());
  const historyInfrastructure = createHistoryInfrastructure(
    context,
    normalizeHistoryMaxEntries(
      settingsProvider.getSettings().historyMaxEntries,
    ),
    logger,
  );
  const assertionsRegistration = registerAssertions(context);
  const extractionRegistration = registerExtraction({
    context,
    environmentManager,
    overlay: runtimeOverlay,
    runStore: runVariableStore,
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
          // collection: empty until Phase 2
          ...(snapshot.active?.variables ?? []),
          ...extractDocumentVariables(document).definitions,
          ...runtimeOverlay.getDefinitions({ requestKey: key }),
          ...runVariableStore.toDefinitions(),
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
  });
  registerOpenApiImport({
    context,
    logger,
    discovery: collectionsRegistration.discovery,
  });
  registerRequestEditor({
    context,
    orchestrator,
    getAuthProfiles: () =>
      authenticationProfiles.list().map((profile) => ({
        id: profile.id,
        label: profile.label?.trim() || profile.id,
      })),
    variableResolver,
    getExternalVariableDefinitions: () =>
      externalVariableContext().definitions,
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
