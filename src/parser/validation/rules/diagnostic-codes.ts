/** Stable machine-readable semantic validation diagnostic codes. */
export const VALIDATION_DIAGNOSTIC_CODES = Object.freeze({
  missingMethod: 'validation.missing-method',
  missingUrl: 'parser.missing-url',
  invalidRequestStructure: 'validation.invalid-request-structure',
  multipleRequestDeclarations: 'validation.multiple-request-declarations',
  malformedOrdering: 'validation.malformed-ordering',
  duplicateHeader: 'validation.duplicate-header',
  malformedHeader: 'validation.malformed-header',
  duplicateDirective: 'api-runner.duplicate-directive',
  unknownDirective: 'parser.unknown-directive',
  invalidDirective: 'api-runner.invalid-directive',
  invalidDirectivePlacement: 'validation.invalid-directive-placement',
  malformedVariable: 'validation.malformed-variable',
} as const);
