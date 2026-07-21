import type {
  ApiDocument,
  AstDiagnostic,
  DirectiveNode,
} from '../parser';
import type { VariableDefinition } from '../models';
import { VARIABLE_DIAGNOSTIC_CODES } from './variable-resolver';

export interface DocumentVariableExtraction {
  readonly definitions: readonly VariableDefinition[];
  readonly diagnostics: readonly AstDiagnostic[];
}

/**
 * Parser adapter for document-scoped `@variable name=value` and
 * `@sensitive-variable name=value` directives.
 */
export function extractDocumentVariables(
  document: ApiDocument,
): DocumentVariableExtraction {
  const definitions: VariableDefinition[] = [];
  const diagnostics: AstDiagnostic[] = [];
  for (const directive of document.directives) {
    const name = directive.knownName;
    if (name !== 'variable' && name !== 'sensitive-variable') {
      continue;
    }
    const equals = directive.value.indexOf('=');
    const variableName = equals < 0 ? '' : directive.value.slice(0, equals).trim();
    const value = equals < 0 ? '' : directive.value.slice(equals + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(variableName)) {
      diagnostics.push(toDiagnostic(
        directive,
        VARIABLE_DIAGNOSTIC_CODES.malformedDefinition,
        `@${name} must use name=value with a valid variable name.`,
      ));
      continue;
    }
    definitions.push(Object.freeze({
      name: variableName,
      value,
      scope: 'document',
      sensitive: name === 'sensitive-variable',
    }));
  }
  return Object.freeze({
    definitions: Object.freeze(definitions),
    diagnostics: Object.freeze(diagnostics),
  });
}

function toDiagnostic(
  directive: DirectiveNode,
  code: string,
  message: string,
): AstDiagnostic {
  return Object.freeze({
    code,
    message,
    severity: 'error',
    range: directive.range,
    location: directive.location,
    source: 'API Hero Variables',
  });
}
