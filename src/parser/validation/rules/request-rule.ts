import type { ApiDocument, RequestNode } from '../../ast';
import type { ValidationContext, ValidationRule } from '../types';
import { HTTP_METHOD_SET } from '../../../shared';
import { VALIDATION_DIAGNOSTIC_CODES } from './diagnostic-codes';

export const requestValidationRule: ValidationRule = Object.freeze({
  id: 'requests',
  validate(document: ApiDocument, context: ValidationContext): void {
    const firstRequestByBlock = new Map<number, RequestNode>();
    let previous: RequestNode | undefined;

    for (const diagnostic of document.diagnostics) {
      if (
        diagnostic.code === 'parser.unexpected-token' &&
        isLikelyUrlWithoutMethod(diagnostic.message)
      ) {
        context.report({
          code: VALIDATION_DIAGNOSTIC_CODES.missingMethod,
          message: 'Request declaration is missing an HTTP method.',
          severity: 'error',
          range: diagnostic.range,
        });
      }
    }

    for (const [index, request] of context.requests.entries()) {
      const method = String(request.method ?? '').trim();
      if (method.length === 0) {
        context.report({
          code: VALIDATION_DIAGNOSTIC_CODES.missingMethod,
          message: 'Request declaration is missing an HTTP method.',
          severity: 'error',
          range: request.range,
        });
      } else if (!HTTP_METHOD_SET.has(method)) {
        context.report({
          code: VALIDATION_DIAGNOSTIC_CODES.invalidRequestStructure,
          message: `Request declaration has an unsupported HTTP method "${method}".`,
          severity: 'error',
          range: request.range,
        });
      }

      if (request.url.trim().length === 0) {
        context.report({
          code: VALIDATION_DIAGNOSTIC_CODES.missingUrl,
          message: `Request ${method || 'declaration'} is missing a URL.`,
          severity: 'error',
          range: requestMethodRange(request, method),
        });
      }

      if (
        request.range.end.offset < request.range.start.offset ||
        request.url.includes('\n') ||
        request.url.includes('\r')
      ) {
        context.report({
          code: VALIDATION_DIAGNOSTIC_CODES.invalidRequestStructure,
          message: 'Request declaration has an invalid structure.',
          severity: 'error',
          range: request.range,
        });
      }

      const block = requestBlock(request, index);
      const firstInBlock = firstRequestByBlock.get(block);
      if (firstInBlock === undefined) {
        firstRequestByBlock.set(block, request);
      } else {
        context.report({
          code: VALIDATION_DIAGNOSTIC_CODES.multipleRequestDeclarations,
          message: 'A request block may contain only one request declaration.',
          severity: 'error',
          range: request.range,
          relatedInformation: [{
            message: 'The first request in this block is declared here.',
            location: firstInBlock.location,
          }],
        });
      }

      if (
        previous !== undefined &&
        request.range.start.offset < previous.range.start.offset
      ) {
        context.report({
          code: VALIDATION_DIAGNOSTIC_CODES.malformedOrdering,
          message: 'Request declarations are not in source order.',
          severity: 'error',
          range: request.range,
          relatedInformation: [{
            message: 'The preceding request is declared here.',
            location: previous.location,
          }],
        });
      }
      validateRequestElementOrder(request, context);
      previous = request;
    }
  },
});

function requestBlock(request: RequestNode, fallback: number): number {
  const value = request.metadata.requestBlock;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function requestMethodRange(request: RequestNode, method: string) {
  const start = request.range.start;
  return {
    start,
    end: {
      line: start.line,
      column: start.column + method.length,
      offset: start.offset + method.length,
    },
  };
}

function isLikelyUrlWithoutMethod(message: string): boolean {
  return (
    message.startsWith('Unexpected token "/') ||
    message.startsWith('Unexpected token "{{')
  );
}

function validateRequestElementOrder(
  request: RequestNode,
  context: ValidationContext,
): void {
  if (request.body === undefined) {
    return;
  }
  for (const node of [...request.headers, ...request.directives]) {
    if (node.range.start.offset > request.body.range.start.offset) {
      context.report({
        code: VALIDATION_DIAGNOSTIC_CODES.malformedOrdering,
        message: `${node.type} declarations must appear before the request body.`,
        severity: 'error',
        range: node.range,
        relatedInformation: [{
          message: 'The request body starts here.',
          location: request.body.location,
        }],
      });
    }
  }
}
