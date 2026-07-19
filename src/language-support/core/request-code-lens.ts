import type { RunRequestCommandArgument } from '../../commands/run-request-argument';
import { COMMAND_IDS } from '../../constants';
import type { ApiDocument, Range } from '../../parser';
import { extractAssertionsForDocument } from '../../assertions';

export interface RequestCodeLensDescriptor {
  readonly range: Range;
  readonly command: {
    readonly id:
      | typeof COMMAND_IDS.runRequest
      | typeof COMMAND_IDS.runRequestWithAssertions;
    readonly title: string;
    readonly argument: RunRequestCommandArgument;
  };
}

/**
 * Guards parsing and lens projection for a provider adapter.
 *
 * Honors cancellation before and after parsing and converts any parse or
 * projection failure into an empty result so a provider never surfaces errors
 * to VS Code. Programmer errors in the adapter's own mapping stay outside this
 * boundary.
 */
export function safeRequestCodeLensDescriptors(
  parse: () => ApiDocument,
  uri: string,
  isCancellationRequested: () => boolean,
  sourceText?: string,
): readonly RequestCodeLensDescriptor[] {
  if (isCancellationRequested()) {
    return [];
  }
  try {
    const document = parse();
    if (isCancellationRequested()) {
      return [];
    }
    return createRequestCodeLensDescriptors(document, uri, sourceText);
  } catch {
    return [];
  }
}

/** Projects canonical requests into framework-neutral CodeLens descriptors. */
export function createRequestCodeLensDescriptors(
  document: ApiDocument,
  uri: string,
  sourceText?: string,
): readonly RequestCodeLensDescriptor[] {
  const extracted =
    sourceText === undefined
      ? undefined
      : extractAssertionsForDocument(document, sourceText, { sourceId: uri });

  const lenses: RequestCodeLensDescriptor[] = [];
  for (let index = 0; index < document.requests.length; index += 1) {
    const request = document.requests[index]!;
    const start = request.range.start;
    const range: Range = {
      start,
      end: {
        line: start.line,
        column: start.column + String(request.method).length,
        offset: start.offset + String(request.method).length,
      },
    };
    const argument: RunRequestCommandArgument = {
      uri,
      position: {
        line: start.line,
        character: start.column,
      },
    };
    lenses.push({
      range,
      command: {
        id: COMMAND_IDS.runRequest,
        title: '$(play) Run Request',
        argument,
      },
    });
    const hasAssertions =
      extracted !== undefined &&
      (extracted[index]!.suite.assertions.length > 0 ||
        extracted[index]!.malformed.length > 0);
    if (hasAssertions) {
      lenses.push({
        range,
        command: {
          id: COMMAND_IDS.runRequestWithAssertions,
          title: '$(beaker) Run Tests',
          argument,
        },
      });
    }
  }
  return lenses;
}
