export type {
  SpecificationFormatId,
  SpecificationImportContext,
  SpecificationImportProvider,
} from './types';
export { SpecificationImportProviderRegistry } from './types';
export { OpenApiImportProvider } from './openapi-provider';

import { OpenApiImportProvider } from './openapi-provider';
import { SpecificationImportProviderRegistry } from './types';

/** Registry with the OpenAPI 3 provider registered. */
export function createDefaultImportProviderRegistry(): SpecificationImportProviderRegistry {
  const registry = new SpecificationImportProviderRegistry();
  registry.register(new OpenApiImportProvider());
  return registry;
}
