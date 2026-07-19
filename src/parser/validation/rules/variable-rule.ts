import type { ApiDocument } from '../../ast';
import type { ValidationContext, ValidationRule } from '../types';
import { VALIDATION_DIAGNOSTIC_CODES } from './diagnostic-codes';

const VARIABLE_EXPRESSION =
  /^\{\{(?:[A-Za-z_][A-Za-z0-9_.-]*|\$(?:timestamp|uuid))\}\}$/u;

export const variableValidationRule: ValidationRule = Object.freeze({
  id: 'variables',
  validate(_document: ApiDocument, context: ValidationContext): void {
    for (const variable of context.variables) {
      if (
        VARIABLE_EXPRESSION.test(variable.originalText) &&
        (/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(variable.name) ||
          variable.name === '$timestamp' ||
          variable.name === '$uuid')
      ) {
        continue;
      }
      if (context.hasDiagnostic('lexer.malformed-variable', variable.range)) {
        continue;
      }
      context.report({
        code: VALIDATION_DIAGNOSTIC_CODES.malformedVariable,
        message:
          'Variable expressions must use {{name}} with a valid variable name.',
        severity: 'error',
        range: variable.range,
      });
    }
  },
});
