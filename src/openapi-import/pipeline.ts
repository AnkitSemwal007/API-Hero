/**
 * Orchestrates OpenAPI (and future) specification import stages:
 * load → detect provider → import → write → settings patch summary.
 *
 * Success policy: any diagnostic with severity `error` means `success: false`
 * and the pipeline does **not** write files or produce a settings patch.
 * Warnings alone still allow write + settings (UI refresh on success).
 */

import type { AuthenticationProfile, Environment } from '../models';
import { loadSpecification } from './loader';
import type {
  ImportArtifacts,
  ImportCancellation,
  ImportDiagnostic,
  ImportLimits,
  ImportProgressEvent,
  ImportSummary,
} from './models';
import { DEFAULT_IMPORT_LIMITS } from './models';
import {
  createDefaultImportProviderRegistry,
  type SpecificationImportProvider,
  type SpecificationImportProviderRegistry,
} from './providers';
import { maskImportSecretText } from './sanitize';
import {
  writeImportArtifacts,
  type WorkspaceFileWriter,
} from './workspace-writer';

export interface SettingsPatch {
  readonly environments: readonly Environment[];
  readonly activeEnvironmentId?: string;
  readonly authenticationProfiles: readonly AuthenticationProfile[];
  readonly secretHints: readonly string[];
}

export interface ImportPipelineOptions {
  readonly sourceText: string;
  readonly sourcePath?: string;
  readonly fileName?: string;
  /** Absolute path to the workspace folder (or chosen target root). */
  readonly targetRoot: string;
  /** Override output subdirectory; default comes from the provider. */
  readonly outputDirectoryName?: string;
  readonly limits?: Partial<ImportLimits>;
  readonly existingEnvironments?: readonly Environment[];
  readonly existingAuthProfiles?: readonly AuthenticationProfile[];
  readonly cancellation?: ImportCancellation;
  readonly onProgress?: (event: ImportProgressEvent) => void;
  readonly writer: WorkspaceFileWriter;
  /** When set, only this provider is used; otherwise auto-detect. */
  readonly provider?: SpecificationImportProvider;
  readonly registry?: SpecificationImportProviderRegistry;
}

export interface ImportPipelineResult {
  readonly summary: ImportSummary;
  readonly artifacts?: ImportArtifacts;
  readonly settingsPatch?: SettingsPatch;
}

/** @deprecated Prefer {@link createDefaultImportProviderRegistry}. */
export function createOpenApiImportRegistry(): SpecificationImportProviderRegistry {
  return createDefaultImportProviderRegistry();
}

/**
 * Runs the full import pipeline. Never executes imported HTTP content.
 * Cancellation stops between stages and during file writes.
 */
export async function runImportPipeline(
  options: ImportPipelineOptions,
): Promise<ImportPipelineResult> {
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...options.limits };
  const diagnostics: ImportDiagnostic[] = [];

  const report = (phase: ImportProgressEvent['phase'], message: string): void => {
    options.onProgress?.({ phase, message });
  };

  if (isImportCancelled(options.cancellation)) {
    return {
      summary: cancelledSummary(options.targetRoot, diagnostics),
    };
  }

  report('loading', 'Loading specification…');
  const loaded = loadSpecification(options.sourceText, {
    sourcePath: options.sourcePath,
    fileName: options.fileName,
    limits,
  });
  diagnostics.push(...loaded.diagnostics);

  if (loaded.root === undefined) {
    return {
      summary: failureSummary(options.targetRoot, diagnostics),
    };
  }

  if (isImportCancelled(options.cancellation)) {
    return {
      summary: cancelledSummary(options.targetRoot, diagnostics),
    };
  }

  const registry = options.registry ?? createDefaultImportProviderRegistry();
  const provider =
    options.provider ??
    registry.detect(loaded.root) ??
    registry.get('openapi');

  if (provider === undefined) {
    diagnostics.push({
      code: 'no-provider',
      severity: 'error',
      message:
        'No import provider could handle this specification. Only OpenAPI 3.0/3.1 is supported.',
    });
    return {
      summary: failureSummary(options.targetRoot, diagnostics),
    };
  }

  if (!provider.canHandle(loaded.root) && options.provider === undefined) {
    diagnostics.push({
      code: 'unsupported-specification',
      severity: 'error',
      message:
        'Specification is not a supported OpenAPI 3.0/3.1 document. Swagger 2.0 and other formats are not imported.',
    });
    return {
      summary: failureSummary(options.targetRoot, diagnostics),
    };
  }

  let artifacts: ImportArtifacts;
  try {
    artifacts = await Promise.resolve(
      provider.importSpecification(loaded.root, {
        sourceText: options.sourceText,
        sourcePath: options.sourcePath,
        fileName: options.fileName,
        limits,
        existingEnvironments: options.existingEnvironments ?? [],
        existingAuthProfiles: options.existingAuthProfiles ?? [],
        cancellation: options.cancellation,
        onProgress: options.onProgress,
      }),
    );
  } catch (error) {
    if (isCancelledError(error) || isImportCancelled(options.cancellation)) {
      return {
        summary: cancelledSummary(options.targetRoot, diagnostics),
      };
    }
    diagnostics.push({
      code: 'import-failed',
      severity: 'error',
      message: maskImportSecretText(
        error instanceof Error ? error.message : String(error),
      ),
    });
    return {
      summary: failureSummary(options.targetRoot, diagnostics),
    };
  }

  diagnostics.push(...artifacts.diagnostics);

  // Any error ⇒ do not write files, do not return a settings patch.
  if (hasErrorDiagnostic(diagnostics)) {
    return {
      summary: abortedBeforeWriteSummary(
        options.targetRoot,
        diagnostics,
        artifacts,
      ),
      artifacts,
    };
  }

  if (isImportCancelled(options.cancellation)) {
    return {
      summary: cancelledSummary(options.targetRoot, diagnostics, artifacts),
      artifacts,
    };
  }

  report('writing', 'Writing `.api` files…');
  const outputDirectoryName =
    options.outputDirectoryName ?? artifacts.outputDirectoryName;
  const written = await writeImportArtifacts({
    targetRoot: options.targetRoot,
    outputDirectoryName,
    files: artifacts.files,
    writer: options.writer,
    cancellation: options.cancellation,
  });
  diagnostics.push(...written.diagnostics);

  if (written.cancelled) {
    return {
      summary: {
        ...cancelledSummary(written.targetDirectory, diagnostics, artifacts),
        writtenFiles: written.writtenFiles,
      },
      artifacts,
    };
  }

  if (hasErrorDiagnostic(diagnostics)) {
    return {
      summary: {
        apiName: artifacts.apiName,
        apiVersion: artifacts.apiVersion,
        openapiVersion: artifacts.openapiVersion,
        targetDirectory: written.targetDirectory,
        folderCount: artifacts.folderCount,
        requestCount: artifacts.requestCount,
        variableCount: 0,
        authProfileCount: artifacts.authProfiles.length,
        environmentCount: artifacts.environments.length,
        writtenFiles: written.writtenFiles,
        diagnostics: maskDiagnostics(diagnostics),
        cancelled: false,
        success: false,
      },
      artifacts,
    };
  }

  const settingsPatch = buildSettingsPatch(
    artifacts,
    options.existingEnvironments ?? [],
    options.existingAuthProfiles ?? [],
  );

  const variableCount = artifacts.environments.reduce(
    (sum, environment) => sum + environment.variables.length,
    0,
  );

  report('completed', 'Import finished');

  return {
    artifacts,
    settingsPatch,
    summary: {
      apiName: artifacts.apiName,
      apiVersion: artifacts.apiVersion,
      openapiVersion: artifacts.openapiVersion,
      targetDirectory: written.targetDirectory,
      folderCount: artifacts.folderCount,
      requestCount: artifacts.requestCount,
      variableCount,
      authProfileCount: artifacts.authProfiles.length,
      environmentCount: artifacts.environments.length,
      writtenFiles: written.writtenFiles,
      diagnostics: maskDiagnostics(diagnostics),
      cancelled: false,
      success: true,
    },
  };
}

function hasErrorDiagnostic(diagnostics: readonly ImportDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error');
}

function abortedBeforeWriteSummary(
  targetDirectory: string,
  diagnostics: readonly ImportDiagnostic[],
  artifacts: ImportArtifacts,
): ImportSummary {
  return {
    apiName: artifacts.apiName,
    apiVersion: artifacts.apiVersion,
    openapiVersion: artifacts.openapiVersion,
    targetDirectory,
    folderCount: artifacts.folderCount,
    requestCount: artifacts.requestCount,
    variableCount: 0,
    authProfileCount: artifacts.authProfiles.length,
    environmentCount: artifacts.environments.length,
    writtenFiles: [],
    diagnostics: maskDiagnostics(diagnostics),
    cancelled: false,
    success: false,
  };
}

function buildSettingsPatch(
  artifacts: ImportArtifacts,
  existingEnvironments: readonly Environment[],
  existingAuthProfiles: readonly AuthenticationProfile[],
): SettingsPatch {
  const environments: Environment[] = [
    ...existingEnvironments,
    ...artifacts.environments.map((item) => ({
      id: item.id,
      name: item.name,
      variables: item.variables.map((variable) => ({
        name: variable.name,
        value: variable.value,
        sensitive: variable.sensitive,
        scope: 'environment' as const,
      })),
    })),
  ];

  const active = artifacts.environments.find((item) => item.activate);

  const authenticationProfiles: AuthenticationProfile[] = [
    ...existingAuthProfiles,
    ...artifacts.authProfiles.map((item) => item.profile),
  ];

  const secretHints = artifacts.authProfiles.flatMap(
    (item) => item.secretHints,
  );

  return {
    environments,
    ...(active === undefined ? {} : { activeEnvironmentId: active.id }),
    authenticationProfiles,
    secretHints,
  };
}

function isImportCancelled(
  cancellation: ImportCancellation | undefined,
): boolean {
  return cancellation !== undefined && cancellation.isCancellationRequested;
}

function isCancelledError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'ImportCancelledError' || error.message === 'Import cancelled')
  );
}

function maskDiagnostics(
  diagnostics: readonly ImportDiagnostic[],
): readonly ImportDiagnostic[] {
  return diagnostics.map((item) => ({
    ...item,
    message: maskImportSecretText(item.message),
  }));
}

function failureSummary(
  targetDirectory: string,
  diagnostics: readonly ImportDiagnostic[],
): ImportSummary {
  return {
    apiName: '',
    apiVersion: '',
    openapiVersion: '',
    targetDirectory,
    folderCount: 0,
    requestCount: 0,
    variableCount: 0,
    authProfileCount: 0,
    environmentCount: 0,
    writtenFiles: [],
    diagnostics: maskDiagnostics(diagnostics),
    cancelled: false,
    success: false,
  };
}

function cancelledSummary(
  targetDirectory: string,
  diagnostics: readonly ImportDiagnostic[],
  artifacts?: ImportArtifacts,
): ImportSummary {
  return {
    apiName: artifacts?.apiName ?? '',
    apiVersion: artifacts?.apiVersion ?? '',
    openapiVersion: artifacts?.openapiVersion ?? '',
    targetDirectory,
    folderCount: artifacts?.folderCount ?? 0,
    requestCount: artifacts?.requestCount ?? 0,
    variableCount: 0,
    authProfileCount: artifacts?.authProfiles.length ?? 0,
    environmentCount: artifacts?.environments.length ?? 0,
    writtenFiles: [],
    diagnostics: maskDiagnostics(diagnostics),
    cancelled: true,
    success: false,
  };
}
