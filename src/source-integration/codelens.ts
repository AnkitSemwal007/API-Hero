import { COMMAND_IDS } from '../constants';
import type { SourceIntegrationCatalog } from './catalog';
import { parseSourceAnnotations } from './annotation';
import type {
  CatalogRequest,
  SourceCodeLensDescriptor,
  SourceMappingArgument,
} from './models';
import { parseSourceDirectiveValue } from './source-ref';

const RUN_TITLE = '$(play) Run Request';
const OPEN_DEFINITION_TITLE = '$(go-to-file) Open API Definition';
const GENERATE_TYPES_TITLE = '$(symbol-interface) Generate TypeScript';
const OPEN_SOURCE_TITLE = '$(go-to-file) Open Related Source';

export interface SourceCodeLensContext {
  readonly sourceFilePath: string;
  readonly workspaceRoots: readonly string[];
}

/**
 * CodeLens descriptors for a source document. Empty when no explicit mapping
 * resolves uniquely.
 */
export function createSourceFileCodeLensDescriptors(
  text: string,
  catalog: SourceIntegrationCatalog,
  context: SourceCodeLensContext,
): readonly SourceCodeLensDescriptor[] {
  const sites = parseSourceAnnotations(text);
  const lenses: SourceCodeLensDescriptor[] = [];
  for (const site of sites) {
    const resolved = catalog.resolveFromAnnotations(site.annotations, context);
    if (resolved.kind !== 'match') {
      continue;
    }
    const argument = mappingArgument(resolved.request);
    lenses.push(
      lens(site.line, site.character, COMMAND_IDS.runRequest, RUN_TITLE, argument),
      lens(
        site.line,
        site.character,
        COMMAND_IDS.openApiDefinition,
        OPEN_DEFINITION_TITLE,
        argument,
      ),
      lens(
        site.line,
        site.character,
        COMMAND_IDS.generateTypeScript,
        GENERATE_TYPES_TITLE,
        argument,
      ),
    );
  }
  return lenses;
}

/**
 * CodeLens on a `.api` request when `@source` is present. The VS Code adapter
 * still verifies the target file exists before the command runs.
 */
export function createApiFileSourceCodeLensDescriptors(
  request: CatalogRequest,
): readonly SourceCodeLensDescriptor[] {
  if (request.sourceRef === undefined) {
    return [];
  }
  const parsed = parseSourceDirectiveValue(request.sourceRef);
  if (parsed === undefined) {
    return [];
  }
  return [
    lens(
      request.range.start.line,
      request.range.start.column,
      COMMAND_IDS.openRelatedSource,
      OPEN_SOURCE_TITLE,
      mappingArgument(request),
    ),
  ];
}

function mappingArgument(request: CatalogRequest): SourceMappingArgument {
  return {
    uri: request.filePath,
    position: {
      line: request.range.start.line,
      character: request.range.start.column,
    },
  };
}

function lens(
  line: number,
  character: number,
  id: string,
  title: string,
  argument: SourceMappingArgument,
): SourceCodeLensDescriptor {
  return {
    line,
    character,
    command: { id, title, argument },
  };
}
