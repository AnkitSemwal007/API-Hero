/**
 * Insomnia export v3 / v4 specification import provider.
 *
 * Note: {@link ImportArtifacts.openapiVersion} stores the *source format*
 * version string (e.g. `insomnia-export-v4`), not an OpenAPI version.
 */

import type { ImportArtifacts, ImportDiagnostic } from '../models';
import { collectionsImportOutputDirectory } from '../output-paths';
import {
  isInsomniaExportRoot,
  mapInsomniaCollection,
  parseInsomniaExport,
} from '../insomnia';
import { slugifyIdentifier } from '../sanitize';
import type {
  SpecificationImportContext,
  SpecificationImportProvider,
} from './types';

export class InsomniaImportProvider implements SpecificationImportProvider {
  public readonly id = 'insomnia' as const;
  public readonly label = 'Insomnia Export';
  public readonly extensions = ['json'] as const;

  public canHandle(root: unknown): boolean {
    return isInsomniaExportRoot(root);
  }

  public importSpecification(
    root: unknown,
    context: SpecificationImportContext,
  ): ImportArtifacts {
    const diagnostics: ImportDiagnostic[] = [];
    throwIfCancelled(context);

    context.onProgress?.({
      phase: 'parsing',
      message: 'Parsing Insomnia export…',
    });
    const parsed = parseInsomniaExport(root);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.export === undefined) {
      return emptyArtifacts(diagnostics);
    }

    throwIfCancelled(context);
    context.onProgress?.({
      phase: 'validating',
      message: 'Validating Insomnia export…',
    });

    const apiSlug = slugifyIdentifier(
      parsed.export.info.name,
      'collection',
    );
    const existingEnvIds = new Set(
      context.existingEnvironments.map((item) => item.id),
    );
    const existingAuthIds = new Set(
      context.existingAuthProfiles.map((item) => item.id),
    );

    throwIfCancelled(context);
    context.onProgress?.({
      phase: 'generating',
      message: 'Generating collection files…',
    });

    const mapped = mapInsomniaCollection(parsed.export, {
      apiSlug,
      existingEnvIds,
      existingAuthIds,
      cancellation: context.cancellation,
    });
    diagnostics.push(...mapped.diagnostics);

    const outputDirectoryName = collectionsImportOutputDirectory(apiSlug);

    return {
      apiName: parsed.export.info.name,
      apiVersion: 'insomnia',
      /** Source format version (Insomnia export), not OpenAPI. */
      openapiVersion: parsed.export.formatVersion,
      outputDirectoryName,
      files: mapped.files,
      environments: mapped.environments,
      authProfiles: mapped.authProfiles,
      diagnostics: dedupeDiagnostics(diagnostics),
      folderCount: mapped.folderCount,
      requestCount: mapped.requestCount,
    };
  }
}

function emptyArtifacts(
  diagnostics: readonly ImportDiagnostic[],
  apiName = '',
  apiVersion = '',
  openapiVersion = '',
): ImportArtifacts {
  return {
    apiName,
    apiVersion,
    openapiVersion,
    outputDirectoryName: collectionsImportOutputDirectory('unknown'),
    files: [],
    environments: [],
    authProfiles: [],
    diagnostics,
    folderCount: 0,
    requestCount: 0,
  };
}

function throwIfCancelled(context: SpecificationImportContext): void {
  if (context.cancellation?.isCancellationRequested === true) {
    const error = new Error('Import cancelled');
    error.name = 'ImportCancelledError';
    throw error;
  }
}

function dedupeDiagnostics(
  diagnostics: readonly ImportDiagnostic[],
): readonly ImportDiagnostic[] {
  const seen = new Set<string>();
  const result: ImportDiagnostic[] = [];
  for (const item of diagnostics) {
    const key = `${item.code}|${item.path ?? ''}|${item.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}
