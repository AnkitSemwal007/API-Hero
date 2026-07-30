/**
 * Pure helpers for detecting unbound scenario request steps (UX bind-before-run).
 */

import { StepType, type RequestStep, type Scenario } from '../models';
import {
  resolveScenarioRequestRef,
  type ScenarioRequestCatalogEntry,
} from '../request-depend-ref';

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
 * - concrete `requestFilePath` from a prior pick, or
 * - `requestRef` resolves in the current Collection catalog (runtime resolve).
 * Unbound when `pending:*` ids, missing path with no resolvable ref, or unknown ref.
 */
export function isUnboundRequestStep(
  step: RequestStep,
  catalog: readonly ScenarioRequestCatalogEntry[] = [],
): boolean {
  const requestId = String(step.requestId ?? '');
  if (requestId.startsWith('pending:')) return true;

  const filePath = (step.requestFilePath ?? '').trim();
  if (filePath.length > 0) return false;

  const requestRef = (step.requestRef ?? '').trim();
  if (requestRef.length === 0) return true;

  if (catalog.length === 0) return true;

  const resolved = resolveScenarioRequestRef(requestRef, catalog);
  return !resolved.ok;
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

export function formatUnboundRequestGuidance(
  unbound: readonly UnboundRequestStepInfo[],
): string {
  const names = unbound.map((s) => s.name).join(', ');
  const n = unbound.length;
  return (
    `Bind ${n} request step(s) before this workflow can run: ${names}. ` +
    'Open the Scenario Editor, select each step, and use Choose Request… to link a Collection request.'
  );
}
