/**
 * OpenAPI 3.0 / 3.1 specification import provider.
 */

import {
  generateAuthProfiles,
  generateCollectionFiles,
  generateEnvironments,
} from '../generators';
import type {
  ImportArtifacts,
  ImportDiagnostic,
} from '../models';
import {
  OpenApiRefResolver,
  parseOpenApiDocument,
  validateOpenApiDocument,
} from '../openapi';
import { slugifyIdentifier } from '../sanitize';
import type {
  SpecificationImportContext,
  SpecificationImportProvider,
} from './types';

export class OpenApiImportProvider implements SpecificationImportProvider {
  public readonly id = 'openapi' as const;
  public readonly label = 'OpenAPI 3';
  public readonly extensions = ['json', 'yaml', 'yml'] as const;

  public canHandle(root: unknown): boolean {
    if (typeof root !== 'object' || root === null || Array.isArray(root)) {
      return false;
    }
    const openapi = (root as { openapi?: unknown }).openapi;
    return typeof openapi === 'string' && /^3\.(0|1)(\.\d+)?$/u.test(openapi.trim());
  }

  public importSpecification(
    root: unknown,
    context: SpecificationImportContext,
  ): ImportArtifacts {
    const diagnostics: ImportDiagnostic[] = [];
    throwIfCancelled(context);

    context.onProgress?.({
      phase: 'parsing',
      message: 'Parsing OpenAPI document…',
    });
    const parsed = parseOpenApiDocument(root);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.document === undefined) {
      return emptyArtifacts(diagnostics);
    }

    throwIfCancelled(context);
    context.onProgress?.({
      phase: 'validating',
      message: 'Validating OpenAPI document…',
    });
    const validated = validateOpenApiDocument(parsed.document);
    diagnostics.push(...validated.diagnostics);
    if (!validated.ok) {
      return emptyArtifacts(diagnostics, parsed.document.info.title, parsed.document.info.version, parsed.document.openapi);
    }

    throwIfCancelled(context);
    context.onProgress?.({
      phase: 'resolving',
      message: 'Resolving $ref pointers…',
    });
    const resolver = new OpenApiRefResolver(root, { limits: context.limits });

    const apiSlug = slugifyIdentifier(parsed.document.info.title, 'api');
    const existingEnvIds = new Set(
      context.existingEnvironments.map((item) => item.id),
    );
    const existingAuthIds = new Set(
      context.existingAuthProfiles.map((item) => item.id),
    );

    throwIfCancelled(context);
    context.onProgress?.({
      phase: 'generating',
      message: 'Generating authentication profiles…',
    });
    const auth = generateAuthProfiles(
      parsed.document,
      resolver,
      apiSlug,
      existingAuthIds,
    );
    diagnostics.push(...auth.diagnostics);

    throwIfCancelled(context);
    context.onProgress?.({
      phase: 'generating',
      message: 'Generating environments…',
    });
    const environments = generateEnvironments(
      parsed.document,
      apiSlug,
      existingEnvIds,
    );
    diagnostics.push(...environments.diagnostics);

    throwIfCancelled(context);
    context.onProgress?.({
      phase: 'generating',
      message: 'Generating request files…',
    });
    const collection = generateCollectionFiles(
      parsed.document,
      resolver,
      auth.schemeToProfileId,
      context.limits,
    );
    diagnostics.push(...collection.diagnostics);
    diagnostics.push(...resolver.getDiagnostics());

    const outputDirectoryName = `imported/${apiSlug}`;

    return {
      apiName: parsed.document.info.title,
      apiVersion: parsed.document.info.version,
      openapiVersion: parsed.document.openapi,
      outputDirectoryName,
      files: collection.files,
      environments: environments.environments,
      authProfiles: auth.profiles,
      diagnostics: dedupeDiagnostics(diagnostics),
      folderCount: collection.folderCount,
      requestCount: collection.requestCount,
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
    outputDirectoryName: 'imported/unknown',
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
