import {
  AstNodeType,
  type ApiDocument,
  type HeaderNode,
  type RequestNode,
} from '../../ast';
import type { ValidationContext, ValidationRule } from '../types';
import { VALIDATION_DIAGNOSTIC_CODES } from './diagnostic-codes';

export const headerValidationRule: ValidationRule = Object.freeze({
  id: 'headers',
  validate(_document: ApiDocument, context: ValidationContext): void {
    const headersByRequest = new Map<RequestNode, Map<string, HeaderNode>>();

    for (const header of context.headers) {
      validateHeaderShape(header, context);
      if (header.parent?.type !== AstNodeType.Request) {
        continue;
      }

      const seen = headersByRequest.get(header.parent) ?? new Map();
      headersByRequest.set(header.parent, seen);
      const normalizedName = header.name.trim().toLowerCase();
      const first = seen.get(normalizedName);
      if (normalizedName.length > 0 && first !== undefined) {
        context.report({
          code: VALIDATION_DIAGNOSTIC_CODES.duplicateHeader,
          message: `Duplicate "${header.name}" header in this request.`,
          severity: 'warning',
          range: header.range,
          relatedInformation: [{
            message: 'The first header is declared here.',
            location: first.location,
          }],
        });
      } else {
        seen.set(normalizedName, header);
      }
    }
  },
});

function validateHeaderShape(
  header: HeaderNode,
  context: ValidationContext,
): void {
  const malformedName =
    header.name.trim().length === 0 ||
    ![...header.name].every(isHeaderNameCharacter);
  const missingValue = header.value.trim().length === 0;
  if (
    !malformedName &&
    (!missingValue ||
      context.hasDiagnostic('parser.missing-header-value', header.range))
  ) {
    return;
  }
  context.report({
    code: VALIDATION_DIAGNOSTIC_CODES.malformedHeader,
    message: malformedName
      ? 'Header name contains invalid characters.'
      : `Header "${header.name}" is missing a value.`,
    severity: 'error',
    range: header.range,
  });
}

function isHeaderNameCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    "!#$%&'*+-.^_`|~".includes(character)
  );
}
