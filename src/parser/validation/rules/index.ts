import type { ValidationRule } from '../types';
import { directiveValidationRule } from './directive-rule';
import { headerValidationRule } from './header-rule';
import { requestValidationRule } from './request-rule';
import { variableValidationRule } from './variable-rule';

export { VALIDATION_DIAGNOSTIC_CODES } from './diagnostic-codes';
export { directiveValidationRule } from './directive-rule';
export { headerValidationRule } from './header-rule';
export { requestValidationRule } from './request-rule';
export { variableValidationRule } from './variable-rule';

/** Built-in semantic domains. Consumers may supply a different rule list. */
export const defaultValidationRules: readonly ValidationRule[] = Object.freeze([
  requestValidationRule,
  headerValidationRule,
  directiveValidationRule,
  variableValidationRule,
]);
