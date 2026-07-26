import type { ValidationRule } from '../types';
import { dependsOnDirectiveValidationRule } from './depends-on-directive-rule';
import { directiveValidationRule } from './directive-rule';
import { extractDirectiveValidationRule } from './extract-directive-rule';
import { headerValidationRule } from './header-rule';
import { requestValidationRule } from './request-rule';
import { variableValidationRule } from './variable-rule';

export { VALIDATION_DIAGNOSTIC_CODES } from './diagnostic-codes';
export { dependsOnDirectiveValidationRule } from './depends-on-directive-rule';
export { directiveValidationRule } from './directive-rule';
export { extractDirectiveValidationRule } from './extract-directive-rule';
export { headerValidationRule } from './header-rule';
export { requestValidationRule } from './request-rule';
export { variableValidationRule } from './variable-rule';

/** Built-in semantic domains. Consumers may supply a different rule list. */
export const defaultValidationRules: readonly ValidationRule[] = Object.freeze([
  requestValidationRule,
  headerValidationRule,
  directiveValidationRule,
  extractDirectiveValidationRule,
  dependsOnDirectiveValidationRule,
  variableValidationRule,
]);
