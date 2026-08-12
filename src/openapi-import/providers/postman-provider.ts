/**
 * Postman Collection v2 / v2.1 specification import provider.
 *
 * Note: {@link ImportArtifacts.openapiVersion} stores the *source format*
 * version string (e.g. `postman-collection-v2.1`), not an OpenAPI version.
 */

import type { ImportArtifacts, ImportDiagnostic } from '../models';
import { collectionsImportOutputDirectory } from '../output-paths';
import {
  isPostmanCollectionRoot,
  mapPostmanCollection,
  parsePostmanCollection,
} from '../postman';
import { slugifyIdentifier } from '../sanitize';
import type {
  SpecificationImportContext,
  SpecificationImportProvider,
} from './types';

export class PostmanImportProvider implements SpecificationImportProvider {
  public readonly id = 'postman' as const;
  public readonly label = 'Postman Collection';
  public readonly extensions = ['json'] as const;

  public canHandle(root: unknown): boolean {
    return isPostmanCollectionRoot(root);
  }

  public importSpecification(
    root: unknown,
    context: SpecificationImportContext,
  ): ImportArtifacts {
    const diagnostics: ImportDiagnostic[] = [];
    throwIfCancelled(context);

    context.onProgress?.({
      phase: 'parsing',
      message: 'Parsing Postman collection…',
    });
    const parsed = parsePostmanCollection(root);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.collection === undefined) {
      return emptyArtifacts(diagnostics);
    }

    throwIfCancelled(context);
    context.onProgress?.({
      phase: 'validating',
      message: 'Validating Postman collection…',
    });

    const apiSlug = slugifyIdentifier(parsed.collection.info.name, 'collection');
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

    const mapped = mapPostmanCollection(parsed.collection, {
      apiSlug,
      existingEnvIds,
      existingAuthIds,
      cancellation: context.cancellation,
    });
    diagnostics.push(...mapped.diagnostics);

    const outputDirectoryName = collectionsImportOutputDirectory(apiSlug);
    const apiVersion =
      parsed.collection.info.version.trim().length > 0
        ? parsed.collection.info.version.trim()
        : 'postman';

    return {
      apiName: parsed.collection.info.name,
      apiVersion,
      /** Source format version (Postman schema), not OpenAPI. */
      openapiVersion: parsed.collection.formatVersion,
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
