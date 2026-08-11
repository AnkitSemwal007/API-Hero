/**
 * Pure helpers: build a Scenario request catalog from discovery snapshot,
 * and resolve requestRef steps onto concrete file paths.
 * No vscode imports.
 */

import type { WorkspaceCollections } from '../collections';
import {
  resolveScenarioRequestRef,
  type ScenarioRequestCatalogEntry,
} from './request-depend-ref';
import { StepType, type RequestStep, type Scenario } from './models';

/**
 * Flatten Collection discovery snapshot into catalog entries used by
 * requestRef resolution and unbound-step detection.
 */
export function buildRequestCatalogFromSnapshot(
  snapshot: WorkspaceCollections | undefined,
): readonly ScenarioRequestCatalogEntry[] {
  if (snapshot === undefined) return [];
  const entries: ScenarioRequestCatalogEntry[] = [];
  for (const collection of Object.values(snapshot.collections)) {
    const foldersById = collection.folders;
    for (const request of Object.values(collection.requests)) {
      const folderPath =
        request.folderId === undefined
          ? ''
          : (foldersById[request.folderId]?.relativePath ?? '');
      entries.push({
        requestId: request.id,
        name: request.display.label,
        folderPath,
        filePath: request.filePath,
        requestOffset: request.range.start.offset,
      });
    }
  }
  return entries;
}

/**
 * Resolve requestRef on Request steps to concrete requestId / filePath / offset.
 * Already-bound steps (concrete path, non-pending id) are left unchanged.
 * Throws when a requestRef cannot be resolved.
 */
export function resolveScenarioRequestSteps(
  scenario: Scenario,
  catalog: readonly ScenarioRequestCatalogEntry[],
): Scenario {
  const steps = scenario.steps.map((step) => {
    if (step.type !== StepType.Request) return step;
    const requestStep = step as RequestStep;
    const filePath = (requestStep.requestFilePath ?? '').trim();
    const requestId = String(requestStep.requestId ?? '');
    // Already bound via Choose Request… — do not re-resolve by display name
    // (ambiguous/renamed catalog entries would undo a successful pick).
    if (filePath.length > 0 && !requestId.startsWith('pending:')) {
      return step;
    }
    if (
      requestStep.requestRef === undefined ||
      requestStep.requestRef.trim().length === 0
    ) {
      return step;
    }
    const resolved = resolveScenarioRequestRef(requestStep.requestRef, catalog);
    if (!resolved.ok) {
      throw new Error(resolved.message);
    }
    return {
      ...requestStep,
      requestId: resolved.requestId,
      requestFilePath: resolved.filePath,
      requestOffset: resolved.requestOffset,
    };
  });
  return { ...scenario, steps };
}
