import {
  AstNodeType,
  type ApiDocument,
  type DirectiveNode,
} from '../../ast';
import type { ValidationContext, ValidationRule } from '../types';
import { parseExtractDirective } from '../../../extraction/parse-extract';
import { VALIDATION_DIAGNOSTIC_CODES } from './diagnostic-codes';

/**
 * Semantic validation for `@extract` / `@sensitive-extract` directive values.
 */
export const extractDirectiveValidationRule: ValidationRule = Object.freeze({
  id: 'extract-directives',
  validate(_document: ApiDocument, context: ValidationContext): void {
    const seenByScope = new Map<string, Map<string, DirectiveNode>>();

    for (const directive of context.directives) {
      if (
        directive.knownName !== 'extract' &&
        directive.knownName !== 'sensitive-extract'
      ) {
        continue;
      }

      const value = directive.value.trim();
      if (value.length === 0) {
        // Empty values are owned by the generic directive rule.
        continue;
      }

      const parsed = parseExtractDirective({
        knownName: directive.knownName,
        value: directive.value,
      });

      if (!parsed.ok) {
        reportParseFailure(directive, parsed.reason, context);
        continue;
      }

      const scopeKey = directiveScope(directive);
      let names = seenByScope.get(scopeKey);
      if (names === undefined) {
        names = new Map();
        seenByScope.set(scopeKey, names);
      }
      const first = names.get(parsed.rule.variableName);
      if (first === undefined) {
        names.set(parsed.rule.variableName, directive);
      } else {
        context.report({
          code: VALIDATION_DIAGNOSTIC_CODES.extractionDuplicateVariable,
          message: `Duplicate extraction variable "${parsed.rule.variableName}" on this request.`,
          severity: 'warning',
          range: directive.range,
          relatedInformation: [
            {
              message: 'The first extraction for this variable is declared here.',
              location: first.location,
            },
          ],
        });
      }
    }
  },
});

function reportParseFailure(
  directive: DirectiveNode,
  reason: string,
  context: ValidationContext,
): void {
  if (reason.startsWith('forbidden-scope:')) {
    context.report({
      code: VALIDATION_DIAGNOSTIC_CODES.extractionForbiddenScope,
      message: 'Extraction cannot target scope=global.',
      severity: 'error',
      range: directive.range,
    });
    return;
  }
  if (reason.startsWith('invalid-scope:')) {
    const scope = reason.slice('invalid-scope:'.length).trim();
    context.report({
      code: VALIDATION_DIAGNOSTIC_CODES.extractionInvalidScope,
      message: `Unknown extraction scope "${scope}".`,
      severity: 'error',
      range: directive.range,
    });
    return;
  }
  if (reason.startsWith('invalid-source:')) {
    context.report({
      code: VALIDATION_DIAGNOSTIC_CODES.extractionInvalidSource,
      message: reason.startsWith('invalid-source: empty header')
        ? 'Extraction header source is missing a header name.'
        : 'Extraction source path is empty.',
      severity: 'error',
      range: directive.range,
    });
    return;
  }
  context.report({
    code: VALIDATION_DIAGNOSTIC_CODES.extractionInvalidDirective,
    message: 'Malformed @extract / @sensitive-extract directive value.',
    severity: 'error',
    range: directive.range,
  });
}

function directiveScope(directive: DirectiveNode): string {
  const explicitBlock = directive.metadata.requestBlock;
  if (
    typeof explicitBlock === 'number' &&
    Number.isSafeInteger(explicitBlock) &&
    explicitBlock >= 0
  ) {
    return `block-${explicitBlock}`;
  }
  if (directive.parent?.type === AstNodeType.Request) {
    return `request-${directive.parent.range.start.offset}`;
  }
  return 'document';
}
