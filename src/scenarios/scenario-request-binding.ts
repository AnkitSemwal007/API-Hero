/**
 * Pure helpers for detecting unbound scenario request steps (UX bind-before-run).
 */

import { StepType, type RequestStep, type Scenario } from './models';
import {
  resolveScenarioRequestRef,
  type ScenarioRequestCatalogEntry,
} from './request-depend-ref';

export interface UnboundRequestStepInfo {
  readonly stepId: string;
  readonly name: string;
  readonly requestRef?: string;
}

/**
 * True when a request step still needs Choose Request… (or a catalog match)
 * before a successful run.
 *
 * Bound when:
 * - concrete `requestFilePath` from a prior pick (non-`pending:*` id), or
 * - `requestRef` resolves in the current Collection catalog (runtime resolve),
 *   including template `pending:*` ids that still carry a resolvable ref.
 * Unbound when missing path with no resolvable ref, unknown/ambiguous ref,
 * or `pending:*` with no catalog match.
 */
export function isUnboundRequestStep(
  step: RequestStep,
  catalog: readonly ScenarioRequestCatalogEntry[] = [],
): boolean {
  const requestId = String(step.requestId ?? '');
  const filePath = (step.requestFilePath ?? '').trim();
  if (filePath.length > 0 && !requestId.startsWith('pending:')) {
    return false;
  }

  const requestRef = (step.requestRef ?? '').trim();
  if (requestRef.length > 0 && catalog.length > 0) {
    const resolved = resolveScenarioRequestRef(requestRef, catalog);
    if (resolved.ok) {
      return false;
    }
  }

  if (requestId.startsWith('pending:')) {
    return true;
  }
  if (filePath.length > 0) {
    return false;
  }
  if (requestRef.length === 0) {
    return true;
  }
  if (catalog.length === 0) {
    return true;
  }
  return true;
}

export function findUnboundRequestSteps(
  scenario: Scenario,
  catalog: readonly ScenarioRequestCatalogEntry[] = [],
): readonly UnboundRequestStepInfo[] {
  const out: UnboundRequestStepInfo[] = [];
  for (const step of scenario.steps) {
    if (step.type !== StepType.Request) continue;
    const requestStep = step as RequestStep;
    if (!isUnboundRequestStep(requestStep, catalog)) continue;
    out.push({
      stepId: requestStep.id,
      name: requestStep.name,
      ...(requestStep.requestRef === undefined
        ? {}
        : { requestRef: requestStep.requestRef }),
    });
  }
  return out;
}

export type UnboundGuidanceAudience = 'ui' | 'mcp' | 'cli';

export function formatUnboundRequestGuidance(
  unbound: readonly UnboundRequestStepInfo[],
  audience: UnboundGuidanceAudience = 'ui',
): string {
  const names = unbound.map((s) => s.name).join(', ');
  const n = unbound.length;
  const prefix = `Bind ${n} request step(s) before this workflow can run: ${names}. `;
  if (audience === 'mcp' || audience === 'cli') {
    return (
      prefix +
      'Ensure each request step has a concrete Collection binding ' +
      '(non-pending requestId + requestFilePath) or a requestRef that uniquely ' +
      'matches a Collection request name / Folder/Name.'
    );
  }
  return (
    prefix +
    'Open the Scenario Editor, select each step, and use Choose Request… to link a Collection request.'
  );
}
