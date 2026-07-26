/**
 * Reads each planned request's owning `.api` source (once per file) and
 * produces one {@link RequestDependencyAnalysis} per request, aligned to
 * `plan.requests` order. Framework-free — callers provide the file-read port.
 */

import type { PlannedRequest, RunPlan } from '../collection-runner';
import { parseApiDocument } from '../parser';
import { analyzeProducesConsumesForDocument } from './produces-consumes';
import type { RequestDependencyAnalysis } from './models';

export interface AnalyzeRunPlanDependenciesPorts {
  readonly readText: (filePath: string) => Promise<string>;
}

/** Analyzes every request in `plan`, caching file reads by `filePath`. */
export async function analyzeRunPlanDependencies(
  plan: RunPlan,
  ports: AnalyzeRunPlanDependenciesPorts,
): Promise<readonly RequestDependencyAnalysis[]> {
  const textByFile = new Map<string, string>();
  const analyses: RequestDependencyAnalysis[] = [];

  for (const request of plan.requests) {
    let text = textByFile.get(request.filePath);
    if (text === undefined) {
      text = await readTextSafe(ports, request.filePath);
      textByFile.set(request.filePath, text);
    }
    analyses.push(analyzeOne(request, text));
  }

  return analyses;
}

async function readTextSafe(
  ports: AnalyzeRunPlanDependenciesPorts,
  filePath: string,
): Promise<string> {
  try {
    return await ports.readText(filePath);
  } catch {
    return '';
  }
}

function analyzeOne(
  request: PlannedRequest,
  text: string,
): RequestDependencyAnalysis {
  if (text.length === 0) {
    return {
      requestId: request.requestId,
      produces: [],
      consumes: [],
      dependsOnNames: [],
    };
  }
  try {
    const document = parseApiDocument(text, { sourceId: request.filePath }).ast;
    return analyzeProducesConsumesForDocument(
      document,
      text,
      request.offset,
      request.requestId,
    );
  } catch {
    return {
      requestId: request.requestId,
      produces: [],
      consumes: [],
      dependsOnNames: [],
    };
  }
}
