import {
  AstNodeType,
  type ApiDocument,
  type AstNode,
  type DirectiveNode,
} from '../../ast';
import type { ValidationContext, ValidationRule } from '../types';
import { VALIDATION_DIAGNOSTIC_CODES } from './diagnostic-codes';

const SINGLETON_DIRECTIVES = new Set([
  'connection',
  'auth',
  'timeout',
  'name',
  'description',
]);

export const directiveValidationRule: ValidationRule = Object.freeze({
  id: 'directives',
  validate(_document: ApiDocument, context: ValidationContext): void {
    const firstByScope = new Map<string, DirectiveNode>();

    for (const directive of context.directives) {
      const name = normalizedName(directive);
      if (directive.knownName === undefined) {
        context.report({
          code: VALIDATION_DIAGNOSTIC_CODES.unknownDirective,
          message: `Unknown directive "@${name}".`,
          severity: 'warning',
          range: directiveNameRange(directive),
        });
      } else if (directive.value.trim().length === 0) {
        reportInvalidValue(
          directive,
          'Invalid directive syntax or missing directive value.',
          context,
        );
      } else if (
        directive.knownName === 'timeout' &&
        !isNonNegativeInteger(directive.value)
      ) {
        reportInvalidValue(
          directive,
          'The @timeout value must be a non-negative safe integer.',
          context,
        );
      }

      if (!hasValidParent(directive.parent)) {
        context.report({
          code: VALIDATION_DIAGNOSTIC_CODES.invalidDirectivePlacement,
          message: `Directive "@${name}" is not placed in a document or request scope.`,
          severity: 'error',
          range: directive.range,
        });
      }

      if (!SINGLETON_DIRECTIVES.has(name)) {
        continue;
      }
      const key = `${directiveScope(directive)}:${name}`;
      const first = firstByScope.get(key);
      if (first === undefined) {
        firstByScope.set(key, directive);
      } else {
        context.report({
          code: VALIDATION_DIAGNOSTIC_CODES.duplicateDirective,
          message: `Duplicate @${name} directive in this request block.`,
          severity: 'warning',
          range: directiveNameRange(directive),
          relatedInformation: [{
            message: 'The first directive is declared here.',
            location: first.location,
          }],
        });
      }
    }
  },
});

function reportInvalidValue(
  directive: DirectiveNode,
  message: string,
  context: ValidationContext,
): void {
  context.report({
    code: VALIDATION_DIAGNOSTIC_CODES.invalidDirective,
    message,
    severity: 'error',
    range: directive.range,
  });
}

function normalizedName(directive: DirectiveNode): string {
  return (directive.knownName ?? directive.name.replace(/^@/, '')).toLowerCase();
}

function hasValidParent(parent: AstNode | undefined): boolean {
  return (
    parent?.type === AstNodeType.Document ||
    parent?.type === AstNodeType.Request
  );
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

function directiveNameRange(directive: DirectiveNode) {
  const start = directive.range.start;
  return {
    start,
    end: {
      line: start.line,
      column: start.column + directive.name.length,
      offset: start.offset + directive.name.length,
    },
  };
}

function isNonNegativeInteger(value: string): boolean {
  const containsOnlyDigits = value.length > 0 && [...value].every((character) => {
    const code = character.charCodeAt(0);
    return code >= 48 && code <= 57;
  });
  return containsOnlyDigits && Number.isSafeInteger(Number(value));
}
