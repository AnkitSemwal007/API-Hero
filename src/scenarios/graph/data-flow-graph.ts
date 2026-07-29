import type {
  Scenario,
  StepId,
  StepUnion,
  ScenarioVariable,
} from '../models';
import type { ControlFlowGraph, ControlFlowEdge } from './control-flow-graph';
import { StepType } from '../models';

export type VariableRef =
  | { readonly kind: 'scenario'; readonly name: string }
  | { readonly kind: 'output'; readonly stepId: StepId; readonly outputName: string };

export interface ScenarioDataFlowGraph {
  readonly nodes: readonly StepId[];
  readonly producedByStep: ReadonlyMap<StepId, readonly VariableRef[]>;
  readonly consumedByStep: ReadonlyMap<StepId, readonly VariableRef[]>;
  /** Producers (steps) for each variable ref key. */
  readonly producersByVarRef: ReadonlyMap<string, readonly StepId[]>;
}

export type DataFlowValidationErrorCode =
  | 'UNKNOWN_SCENARIO_VARIABLE'
  | 'UNKNOWN_OUTPUT_REFERENCE'
  | 'CONSUMED_NOT_DOMINATED';

export interface DataFlowValidationError {
  readonly code: DataFlowValidationErrorCode;
  readonly message: string;
  readonly stepId: StepId;
  readonly variableRefKey: string;
}

export interface DataFlowGraphBuildResult {
  readonly graph: ScenarioDataFlowGraph | undefined;
  readonly errors: readonly DataFlowValidationError[];
}

const REFERENCE = /\{\{(\$?[A-Za-z_][A-Za-z0-9_.-]*)\}\}/gu;

function variableRefKey(ref: VariableRef): string {
  return ref.kind === 'scenario'
    ? `scenario:${ref.name}`
    : `output:${ref.stepId}:${ref.outputName}`;
}

function intersection<T>(sets: readonly Set<T>[]): Set<T> {
  if (sets.length === 0) return new Set();
  const [first, ...rest] = sets;
  const result = new Set(first);
  for (const s of rest) {
    for (const item of [...result]) {
      if (!s.has(item)) result.delete(item);
    }
  }
  return result;
}

function computeDominators(options: {
  readonly nodes: readonly StepId[];
  readonly entryStepId: StepId;
  readonly edges: readonly ControlFlowEdge[];
}): ReadonlyMap<StepId, ReadonlySet<StepId>> {
  const { nodes, entryStepId, edges } = options;
  const preds = new Map<StepId, StepId[]>();
  for (const node of nodes) preds.set(node, []);
  for (const edge of edges) preds.get(edge.toStepId)!.push(edge.fromStepId);

  const all = new Set(nodes);
  const dom = new Map<StepId, Set<StepId>>();
  for (const node of nodes) {
    dom.set(node, node === entryStepId ? new Set([node]) : new Set(all));
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node === entryStepId) continue;
      const predecessorList = preds.get(node) ?? [];
      if (predecessorList.length === 0) {
        const next = new Set<StepId>([node]);
        const current = dom.get(node)!;
        if (current.size !== next.size || ![...current].every((v) => next.has(v))) {
          dom.set(node, next);
          changed = true;
        }
        continue;
      }

      const predDoms = predecessorList.map((p) => dom.get(p)!);
      const newSet = intersection(predDoms);
      newSet.add(node);

      const current = dom.get(node)!;
      const equal =
        current.size === newSet.size &&
        [...current].every((v) => newSet.has(v));
      if (!equal) {
        dom.set(node, newSet);
        changed = true;
      }
    }
  }

  const frozen = new Map<StepId, ReadonlySet<StepId>>();
  for (const [k, v] of dom.entries()) {
    frozen.set(k, v);
  }
  return frozen;
}

function parseTemplateRefs(
  value: string,
  options: {
    readonly stepByName: ReadonlyMap<string, StepUnion>;
    readonly scenarioVarsByName: ReadonlyMap<string, ScenarioVariable>;
  },
): readonly VariableRef[] {
  const refs: VariableRef[] = [];
  for (const match of value.matchAll(REFERENCE)) {
    const raw = match[1] ?? '';
    if (raw.startsWith('scenario.')) {
      const name = raw.slice('scenario.'.length);
      if (name.trim().length > 0 && options.scenarioVarsByName.has(name)) {
        refs.push({ kind: 'scenario', name });
      }
      continue;
    }
    const dot = raw.indexOf('.');
    if (dot >= 0) {
      const stepName = raw.slice(0, dot);
      const outputName = raw.slice(dot + 1);
      const step = options.stepByName.get(stepName);
      if (step !== undefined) {
        // Output ref is validated against step.outputs later.
        refs.push({ kind: 'output', stepId: step.id, outputName });
        continue;
      }
    }
    // Convenience: allow `{{varName}}` to mean `{{scenario.varName}}`.
    if (options.scenarioVarsByName.has(raw)) {
      refs.push({ kind: 'scenario', name: raw });
    }
  }
  return refs;
}

function collectProducedScenarioVariables(step: StepUnion): readonly VariableRef[] {
  if (step.type === StepType.Variable) {
    return step.assignments.map((a) => ({ kind: 'scenario', name: a.name }));
  }
  return [];
}

function collectProducedOutputs(step: StepUnion): readonly VariableRef[] {
  const outputs = step.outputs ?? [];
  return outputs.map((o) => ({ kind: 'output', stepId: step.id, outputName: o.name }));
}

function collectOutputTargets(step: StepUnion): readonly VariableRef[] {
  const outputs = step.outputs ?? [];
  const targets: VariableRef[] = [];
  for (const out of outputs) {
    if (out.targetVariable !== undefined) {
      targets.push({ kind: 'scenario', name: out.targetVariable });
    }
  }
  return targets;
}

function createScenarioVarByName(scenario: Scenario): ReadonlyMap<string, ScenarioVariable> {
  return new Map(scenario.variables.map((v) => [v.name, v]));
}

function createStepByName(scenario: Scenario): ReadonlyMap<string, StepUnion> {
  return new Map(scenario.steps.map((s) => [s.name, s]));
}

function collectConsumedByStep(
  step: StepUnion,
  scenario: Scenario,
  options: { readonly stepByName: ReadonlyMap<string, StepUnion>; readonly scenarioVarsByName: ReadonlyMap<string, ScenarioVariable> },
): readonly VariableRef[] {
  switch (step.type) {
    case StepType.Request: {
      return step.inputMappings.map((m) => ({ kind: 'scenario', name: m.variable }));
    }
    case StepType.Variable: {
      const refs = [];
      for (const assignment of step.assignments) {
        refs.push(...parseTemplateRefs(assignment.value, options));
      }
      return refs;
    }
    case StepType.Condition: {
      const refs: VariableRef[] = [];
      if (step.condition !== undefined) {
        refs.push(...parseTemplateRefs(step.condition.left, options));
        refs.push(...parseTemplateRefs(step.condition.right, options));
      }
      if (step.expression !== undefined) {
        refs.push(...parseTemplateRefs(step.expression, options));
      }
      return refs;
    }
    case StepType.Delay:
    case StepType.Group:
      return [];
    default:
      return [];
  }
}

/**
 * Build a scenario data-flow graph and validate dominance constraints.
 *
 * Dominance validation is performed against the given {@link ControlFlowGraph}.
 */
export function buildDataFlowGraph(
  scenario: Scenario,
  controlFlow: ControlFlowGraph,
): DataFlowGraphBuildResult {
  const nodes = scenario.steps.map((s) => s.id);
  const scenarioVarsByName = createScenarioVarByName(scenario);
  const stepByName = createStepByName(scenario);

  const producedByStep = new Map<StepId, VariableRef[]>();
  const consumedByStep = new Map<StepId, VariableRef[]>();
  const producersByVarRef = new Map<string, StepId[]>();

  const ensureOutputExists = (step: StepUnion, outputName: string): boolean => {
    const outputs = step.outputs ?? [];
    return outputs.some((o) => o.name === outputName);
  };

  const errors: DataFlowValidationError[] = [];

  // 1) Produced refs.
  for (const step of scenario.steps) {
    const produced: VariableRef[] = [];
    produced.push(...collectProducedOutputs(step));
    produced.push(...collectProducedScenarioVariables(step));
    produced.push(...collectOutputTargets(step));
    producedByStep.set(step.id, produced);
    for (const ref of produced) {
      const key = variableRefKey(ref);
      if (!producersByVarRef.has(key)) producersByVarRef.set(key, []);
      producersByVarRef.get(key)!.push(step.id);
    }
  }

  // 2) Consumed refs.
  for (const step of scenario.steps) {
    const consumed = collectConsumedByStep(step, scenario, { stepByName, scenarioVarsByName });
    const validated: VariableRef[] = [];
    for (const ref of consumed) {
      if (ref.kind === 'scenario') {
        if (!scenarioVarsByName.has(ref.name)) {
          errors.push({
            code: 'UNKNOWN_SCENARIO_VARIABLE',
            message: `Scenario variable "${ref.name}" referenced by step "${step.name}" is not declared.`,
            stepId: step.id,
            variableRefKey: variableRefKey(ref),
          });
          continue;
        }
      } else {
        const stepProducer = scenario.steps.find((s) => s.id === ref.stepId);
        if (stepProducer === undefined || !ensureOutputExists(stepProducer, ref.outputName)) {
          errors.push({
            code: 'UNKNOWN_OUTPUT_REFERENCE',
            message: `Output "${step.name}" references missing output "${ref.outputName}" on step "${stepProducer?.name ?? 'unknown'}".`,
            stepId: step.id,
            variableRefKey: variableRefKey(ref),
          });
          continue;
        }
      }
      validated.push(ref);
    }
    consumedByStep.set(step.id, validated);
  }

  if (errors.length > 0) {
    return { graph: undefined, errors };
  }

  if (controlFlow.entryStepId === undefined) {
    return {
      graph: undefined,
      errors: [
        {
          code: 'CONSUMED_NOT_DOMINATED',
          message: 'Cannot validate dominance without a unique control-flow entry node.',
          stepId: nodes[0] ?? '',
          variableRefKey: '',
        },
      ],
    };
  }

  const dominators = computeDominators({
    nodes,
    entryStepId: controlFlow.entryStepId,
    edges: controlFlow.edges,
  });

  const dominates = (producer: StepId, consumer: StepId): boolean => {
    const dom = dominators.get(consumer);
    return dom !== undefined && dom.has(producer);
  };

  // 3) Dominator validation for every consumed variable ref that isn't satisfied
  //    by declared scenario defaults.
  for (const consumer of scenario.steps) {
    const consumed = consumedByStep.get(consumer.id) ?? [];
    for (const ref of consumed) {
      if (ref.kind === 'scenario') {
        const definition = scenarioVarsByName.get(ref.name)!;
        if (definition.defaultValue !== undefined) {
          // Declared defaults are available before any step runs.
          continue;
        }
      }

      const key = variableRefKey(ref);
      const producers = producersByVarRef.get(key) ?? [];
      if (producers.length === 0) {
        errors.push({
          code: 'CONSUMED_NOT_DOMINATED',
          message: `Variable ref "${key}" is consumed by step "${consumer.name}" but no step produces it.`,
          stepId: consumer.id,
          variableRefKey: key,
        });
        continue;
      }

      const hasDominatingProducer = producers.some((p) => dominates(p, consumer.id));
      if (!hasDominatingProducer) {
        errors.push({
          code: 'CONSUMED_NOT_DOMINATED',
          message: `Consumed variable ref "${key}" is not guaranteed to be produced before step "${consumer.name}".`,
          stepId: consumer.id,
          variableRefKey: key,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { graph: undefined, errors };
  }

  return {
    graph: {
      nodes,
      producedByStep: producedByStep,
      consumedByStep: consumedByStep,
      producersByVarRef: producersByVarRef,
    },
    errors: [],
  };
}

