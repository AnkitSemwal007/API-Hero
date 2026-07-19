/**
 * Pluggable specification import providers.
 * Only OpenAPI 3 is implemented; Swagger/Postman/etc. can register later.
 */

import type { AuthenticationProfile, Environment } from '../../models';
import type {
  ImportArtifacts,
  ImportCancellation,
  ImportDiagnostic,
  ImportLimits,
  ImportProgressEvent,
} from '../models';

/** Identifies a specification format a provider can import. */
export type SpecificationFormatId = 'openapi' | 'swagger' | 'postman' | 'insomnia';

export interface SpecificationImportContext {
  readonly sourceText: string;
  readonly sourcePath?: string;
  readonly fileName?: string;
  readonly limits: ImportLimits;
  readonly existingEnvironments: readonly Environment[];
  readonly existingAuthProfiles: readonly AuthenticationProfile[];
  readonly cancellation?: ImportCancellation;
  readonly onProgress?: (event: ImportProgressEvent) => void;
}

export interface SpecificationImportProvider {
  readonly id: SpecificationFormatId;
  readonly label: string;
  /** File extensions this provider accepts (without dot), lowercase. */
  readonly extensions: readonly string[];
  /**
   * Returns true when the loaded root looks like this provider's format.
   * Used for auto-detection; OpenAPI checks `openapi: "3.x"`.
   */
  canHandle(root: unknown): boolean;
  importSpecification(
    root: unknown,
    context: SpecificationImportContext,
  ): Promise<ImportArtifacts> | ImportArtifacts;
}

/** Registry of import providers (currently OpenAPI only). */
export class SpecificationImportProviderRegistry {
  private readonly providers = new Map<
    SpecificationFormatId,
    SpecificationImportProvider
  >();

  public register(provider: SpecificationImportProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Import provider "${provider.id}" is already registered.`);
    }
    this.providers.set(provider.id, provider);
  }

  public get(id: SpecificationFormatId): SpecificationImportProvider | undefined {
    return this.providers.get(id);
  }

  public list(): readonly SpecificationImportProvider[] {
    return [...this.providers.values()];
  }

  public detect(root: unknown): SpecificationImportProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.canHandle(root)) {
        return provider;
      }
    }
    return undefined;
  }
}

export type { ImportArtifacts, ImportDiagnostic };
