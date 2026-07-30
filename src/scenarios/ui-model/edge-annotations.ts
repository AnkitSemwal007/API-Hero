/**
 * Pure edge-label annotations for scenario canvas overlays (not persisted).
 */

import { StepType, type Scenario } from '../models';

export interface ScenarioEdgeAnnotation {
  readonly connectionId: string;
  readonly label: string;
}

/**
 * Derives view-only edge labels: True/False for condition branches,
 * and simple data-handoff hints after variable/request output steps.
 * (Avoid Success/Failure — true branches are not always “success”, e.g. 401 refresh.)
 */
export function buildScenarioEdgeAnnotations(
  scenario: Scenario,
): readonly ScenarioEdgeAnnotation[] {
  const byId = new Map(scenario.steps.map((s) => [s.id, s] as const));
  const annotations: ScenarioEdgeAnnotation[] = [];

  for (const step of scenario.steps) {
    if (step.type !== StepType.Condition) continue;
    const trueConn = scenario.connections.find((c) => c.id === step.trueBranch);
    const falseConn = scenario.connections.find(
      (c) => c.id === step.falseBranch,
    );
    if (trueConn !== undefined) {
      annotations.push({ connectionId: trueConn.id, label: 'True' });
    }
    if (falseConn !== undefined) {
      annotations.push({ connectionId: falseConn.id, label: 'False' });
    }
  }

  for (const connection of scenario.connections) {
    if (annotations.some((a) => a.connectionId === connection.id)) continue;
    const from = byId.get(connection.fromStepId);
    const to = byId.get(connection.toStepId);
    if (from === undefined || to === undefined) continue;
    if (to.type !== StepType.Request) continue;
    if (from.type === StepType.Variable) {
      const first = from.assignments[0]?.name;
      if (first !== undefined && first.length > 0) {
        annotations.push({
          connectionId: connection.id,
          label: `${first} → next`,
        });
      }
    } else if (
      from.type === StepType.Request &&
      from.outputs !== undefined &&
      from.outputs.length > 0
    ) {
      const name =
        from.outputs[0]?.targetVariable ?? from.outputs[0]?.name ?? 'data';
      annotations.push({
        connectionId: connection.id,
        label: `${name} → next`,
      });
    }
  }

  return annotations;
}
