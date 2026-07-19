import {
  DIRECTIVES,
  HTTP_METHODS,
  LANGUAGE_DIAGNOSTIC_CODES,
  SINGLETON_DIRECTIVES,
} from '../constants';
import type {
  FoldRegion,
  LanguageDiagnostic,
  LineAnalysis,
  RequestLine,
} from './types';

const SEPARATOR_PATTERN = /^\s*###(?:\s|$)/;
const COMMENT_PATTERN = /^\s*(?:#(?!##)|\/\/)/;
const REQUEST_PATTERN = /^\s*([A-Za-z]+)(?:\s+(.*?))?\s*$/;
const DIRECTIVE_PATTERN = /^\s*(@[A-Za-z][\w-]*)(?:\s+(.*?))?\s*$/;
const HEADER_PATTERN = /^\s*[A-Za-z][A-Za-z0-9-]*\s*:/;
const URL_LIKE_PATTERN = /^(?:https?:\/\/|wss?:\/\/|\/|\.{1,2}\/|\{\{)/i;

const methodSet = new Set<string>(HTTP_METHODS);
const directiveSet = new Set<string>(DIRECTIVES);
const singletonDirectiveSet = new Set<string>(SINGLETON_DIRECTIVES);

interface RequestCandidate {
  readonly line: number;
  readonly method: string;
  readonly url: string;
}

/**
 * Performs the legacy lightweight, line-oriented analysis.
 *
 * @deprecated Retained only for public API compatibility and legacy tests.
 * Runtime providers use `RuntimeParserAdapter` and the canonical `ApiDocument`.
 */
export function analyzeApiLines(lines: readonly string[]): LineAnalysis {
  const requests = findRequests(lines);

  return {
    requests: addRequestMetadata(lines, requests),
    diagnostics: findDiagnostics(lines),
    folds: findFoldRegions(lines, requests),
  };
}

function findRequests(lines: readonly string[]): readonly RequestCandidate[] {
  const requests: RequestCandidate[] = [];

  lines.forEach((line, lineNumber) => {
    if (COMMENT_PATTERN.test(line) || SEPARATOR_PATTERN.test(line)) {
      return;
    }

    const match = REQUEST_PATTERN.exec(line);
    const method = match?.[1]?.toUpperCase();
    if (match === null || method === undefined || !methodSet.has(method)) {
      return;
    }

    requests.push({
      line: lineNumber,
      method,
      url: match[2]?.trim() ?? '',
    });
  });

  return requests;
}

function addRequestMetadata(
  lines: readonly string[],
  candidates: readonly RequestCandidate[],
): readonly RequestLine[] {
  return candidates.map((candidate, index) => {
    const previousRequestLine = candidates[index - 1]?.line ?? -1;
    const nextRequestLine = candidates[index + 1]?.line ?? lines.length;
    const separatorBefore = findPreviousSeparator(lines, candidate.line);
    const separatorAfter = findNextSeparator(lines, candidate.line);
    const startLine = Math.max(separatorBefore + 1, previousRequestLine + 1);
    const endLine = Math.min(separatorAfter - 1, nextRequestLine - 1);
    const precedingName = findName(lines, startLine, candidate.line - 1, true);
    const followingName = findName(lines, candidate.line + 1, endLine, false);

    return {
      ...candidate,
      name: precedingName ?? followingName,
      blockStartLine: startLine,
      blockEndLine: trimTrailingBlankLines(lines, candidate.line, endLine),
    };
  });
}

function findName(
  lines: readonly string[],
  startLine: number,
  endLine: number,
  useLast: boolean,
): string | undefined {
  let name: string | undefined;

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const match = DIRECTIVE_PATTERN.exec(lines[lineNumber] ?? '');
    if (match?.[1] === '@name' && match[2] !== undefined) {
      name = match[2].trim();
      if (!useLast) {
        return name;
      }
    }
  }

  return name;
}

function findDiagnostics(lines: readonly string[]): readonly LanguageDiagnostic[] {
  const diagnostics: LanguageDiagnostic[] = [];
  let directivesInBlock = new Map<string, number>();

  lines.forEach((line, lineNumber) => {
    if (SEPARATOR_PATTERN.test(line)) {
      directivesInBlock = new Map<string, number>();
      return;
    }

    if (line.trim() === '' || COMMENT_PATTERN.test(line)) {
      return;
    }

    if (line.trimStart().startsWith('@')) {
      validateDirective(line, lineNumber, directivesInBlock, diagnostics);
      return;
    }

    const requestMatch = REQUEST_PATTERN.exec(line);
    const token = requestMatch?.[1];
    if (requestMatch === null || token === undefined) {
      return;
    }

    const normalizedMethod = token.toUpperCase();
    const value = requestMatch[2]?.trim() ?? '';
    if (methodSet.has(normalizedMethod)) {
      if (value === '') {
        const methodStart = line.indexOf(token);
        diagnostics.push(createDiagnostic(
          LANGUAGE_DIAGNOSTIC_CODES.missingUrl,
          'A request URL is required after the HTTP method.',
          'error',
          lineNumber,
          methodStart,
          methodStart + token.length,
        ));
      }
      directivesInBlock = new Map<string, number>();
    } else if (
      token === token.toUpperCase()
      && /^[A-Z]+$/.test(token)
      && URL_LIKE_PATTERN.test(value)
    ) {
      diagnostics.push(createDiagnostic(
        LANGUAGE_DIAGNOSTIC_CODES.unknownMethod,
        `Unknown HTTP method "${token}".`,
        'warning',
        lineNumber,
        line.indexOf(token),
        line.indexOf(token) + token.length,
      ));
    }
  });

  return diagnostics;
}

function validateDirective(
  line: string,
  lineNumber: number,
  seen: Map<string, number>,
  diagnostics: LanguageDiagnostic[],
): void {
  const match = DIRECTIVE_PATTERN.exec(line);
  const directive = match?.[1];
  const value = match?.[2]?.trim() ?? '';
  const invalidTimeout = directive === '@timeout' && !/^\d+$/.test(value);

  if (
    directive === undefined
    || !directiveSet.has(directive)
    || value === ''
    || invalidTimeout
  ) {
    diagnostics.push(createDiagnostic(
      LANGUAGE_DIAGNOSTIC_CODES.invalidDirective,
      invalidTimeout
        ? 'The @timeout value must be a non-negative integer.'
        : 'Invalid directive syntax or missing directive value.',
      'error',
      lineNumber,
      line.search(/\S|$/),
      line.length,
    ));
    return;
  }

  if (singletonDirectiveSet.has(directive) && seen.has(directive)) {
    diagnostics.push(createDiagnostic(
      LANGUAGE_DIAGNOSTIC_CODES.duplicateDirective,
      `Duplicate ${directive} directive in this request block.`,
      'warning',
      lineNumber,
      line.indexOf(directive),
      line.indexOf(directive) + directive.length,
    ));
  } else {
    seen.set(directive, lineNumber);
  }
}

function findFoldRegions(
  lines: readonly string[],
  requests: readonly RequestCandidate[],
): readonly FoldRegion[] {
  const folds: FoldRegion[] = [];

  requests.forEach((request, index) => {
    const nextRequest = requests[index + 1]?.line ?? lines.length;
    const nextSeparator = findNextSeparator(lines, request.line);
    const endLine = trimTrailingBlankLines(
      lines,
      request.line,
      Math.min(nextRequest - 1, nextSeparator - 1),
    );
    if (endLine > request.line) {
      folds.push({ startLine: request.line, endLine, kind: 'request' });
    }
  });

  addDirectiveFolds(lines, folds);
  addJsonFolds(lines, folds);
  return folds;
}

function addDirectiveFolds(lines: readonly string[], folds: FoldRegion[]): void {
  let groupStart: number | undefined;

  for (let lineNumber = 0; lineNumber <= lines.length; lineNumber += 1) {
    const isDirective = DIRECTIVE_PATTERN.test(lines[lineNumber] ?? '');
    if (isDirective && groupStart === undefined) {
      groupStart = lineNumber;
    } else if (!isDirective && groupStart !== undefined) {
      if (lineNumber - groupStart > 1) {
        folds.push({
          startLine: groupStart,
          endLine: lineNumber - 1,
          kind: 'directives',
        });
      }
      groupStart = undefined;
    }
  }
}

function addJsonFolds(lines: readonly string[], folds: FoldRegion[]): void {
  const stack: Array<{ character: string; line: number }> = [];

  lines.forEach((line, lineNumber) => {
    if (SEPARATOR_PATTERN.test(line) || isRequestLine(line)) {
      stack.length = 0;
      return;
    }

    if (
      COMMENT_PATTERN.test(line)
      || DIRECTIVE_PATTERN.test(line)
      || HEADER_PATTERN.test(line)
    ) {
      return;
    }

    let inString = false;
    let escaped = false;
    for (const character of line) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\' && inString) {
        escaped = true;
      } else if (character === '"') {
        inString = !inString;
      } else if (!inString && (character === '{' || character === '[')) {
        stack.push({ character, line: lineNumber });
      } else if (!inString && (character === '}' || character === ']')) {
        const expected = character === '}' ? '{' : '[';
        const opening = stack.at(-1);
        if (opening?.character === expected) {
          stack.pop();
          if (opening.line < lineNumber) {
            folds.push({
              startLine: opening.line,
              endLine: lineNumber,
              kind: 'json',
            });
          }
        }
      }
    }
  });
}

function isRequestLine(line: string): boolean {
  const method = REQUEST_PATTERN.exec(line)?.[1]?.toUpperCase();
  return method !== undefined && methodSet.has(method);
}

function findPreviousSeparator(lines: readonly string[], fromLine: number): number {
  for (let lineNumber = fromLine - 1; lineNumber >= 0; lineNumber -= 1) {
    if (SEPARATOR_PATTERN.test(lines[lineNumber] ?? '')) {
      return lineNumber;
    }
  }
  return -1;
}

function findNextSeparator(lines: readonly string[], fromLine: number): number {
  for (let lineNumber = fromLine + 1; lineNumber < lines.length; lineNumber += 1) {
    if (SEPARATOR_PATTERN.test(lines[lineNumber] ?? '')) {
      return lineNumber;
    }
  }
  return lines.length;
}

function trimTrailingBlankLines(
  lines: readonly string[],
  minimumLine: number,
  endLine: number,
): number {
  let result = endLine;
  while (result > minimumLine && (lines[result] ?? '').trim() === '') {
    result -= 1;
  }
  return result;
}

function createDiagnostic(
  code: string,
  message: string,
  severity: 'error' | 'warning',
  line: number,
  startCharacter: number,
  endCharacter: number,
): LanguageDiagnostic {
  return {
    code,
    message,
    severity,
    span: {
      line,
      startCharacter: Math.max(0, startCharacter),
      endCharacter: Math.max(startCharacter + 1, endCharacter),
    },
  };
}
