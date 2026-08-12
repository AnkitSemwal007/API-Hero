export type {
  SpecificationFormatId,
  SpecificationImportContext,
  SpecificationImportProvider,
} from './types';
export { SpecificationImportProviderRegistry } from './types';
export { OpenApiImportProvider } from './openapi-provider';
export { PostmanImportProvider } from './postman-provider';
export { InsomniaImportProvider } from './insomnia-provider';

import { OpenApiImportProvider } from './openapi-provider';
import { PostmanImportProvider } from './postman-provider';
import { InsomniaImportProvider } from './insomnia-provider';
import { SpecificationImportProviderRegistry } from './types';

/** Registry with OpenAPI 3, Postman, and Insomnia providers registered. */
export function createDefaultImportProviderRegistry(): SpecificationImportProviderRegistry {
  const registry = new SpecificationImportProviderRegistry();
  registry.register(new OpenApiImportProvider());
  registry.register(new PostmanImportProvider());
  registry.register(new InsomniaImportProvider());
  return registry;
}
