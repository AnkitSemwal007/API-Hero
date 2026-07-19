import type { ExtensionContext } from 'vscode';

import type { AssertionEvaluationObserver } from '../../orchestration';
import { AssertionProblemsService } from './assertion-problems';

export interface RegisterAssertionsResult {
  readonly observer: AssertionEvaluationObserver;
  readonly problems: AssertionProblemsService;
}

/**
 * Composes assertion VS Code adapters. Call from `extension.ts` only.
 */
export function registerAssertions(
  context: ExtensionContext,
): RegisterAssertionsResult {
  const problems = new AssertionProblemsService();
  context.subscriptions.push(problems);
  return {
    problems,
    observer: {
      onEvaluated: (input) => problems.onEvaluated(input),
    },
  };
}

export { AssertionProblemsService } from './assertion-problems';
