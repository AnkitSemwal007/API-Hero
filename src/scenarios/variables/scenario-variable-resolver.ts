import type {
  VariableAnalysis,
  VariableResolver,
  VariableResolutionContext,
} from '../../variables';
import type { VariableDefinition } from '../../models';

import type {
  Scenario,
  ScenarioVariable,
  StepId,
  StepOutput,
} from '../models';
import type { ScenarioId } from '../models';

export interface ScenarioVariableResolutionContext {
  /**
   * Live mutable values updated during scenario execution.
   * Missing entries indicate the value has not yet been resolved/assigned.
   */
  readonly variables: Map<string, string>;
  /**
   * Live output values produced by completed steps.
   * Keyed by `stepId -> outputName -> value`.
   */
  readonly outputs: Map<StepId, Map<string, string>>;
}

export interface ScenarioVariableResolverOptions {
  readonly scenario: Scenario;
  readonly externalVariableResolver: VariableResolver;
  readonly externalVariableDefinitions: readonly VariableDefinition[];
}

export interface ScenarioVariableResolver {
  readonly scenarioId: ScenarioId;
  /**
   * Resolves one scenario variable name to a string value.
   * Throws when the variable is unknown or cannot be resolved.
   */
  resolveScenarioVariable(name: string, context: ScenarioVariableResolutionContext): string;
  /**
   * Resolves a string template by substituting scenario vars and step outputs.
   * Throws when referenced scenario vars/outputs cannot be resolved.
   */
  resolveStringTemplate(template: string, context: ScenarioVariableResolutionContext): string;
}

const REFERENCE = /\{\{(\$?[A-Za-z_][A-Za-z0-9_.-]*)\}\}/gu;

function isScenarioTemplate(refName: string): refName is `scenario.${string}` {
  return refName.startsWith('scenario.');
}

function resolveSingleTemplateReference(
  refName: string,
  options: {
    readonly stepByName: ReadonlyMap<string, { readonly id: StepId; readonly outputs: readonly StepOutput[] }>;
    readonly scenarioVarByName: ReadonlyMap<string, ScenarioVariable>;
    readonly resolveScenarioVariable: (name: string) => string;
    readonly resolveExternalValue: (name: string) => string | undefined;
    readonly outputs: Map<StepId, Map<string, string>>;
  },
): string {
  if (isScenarioTemplate(refName)) {
    const varName = refName.slice('scenario.'.length);
    if (varName.length === 0) {
      throw new Error('Invalid scenario variable reference syntax.');
    }
    return options.resolveScenarioVariable(varName);
  }

  const dot = refName.indexOf('.');
  if (dot >= 0) {
    const stepName = refName.slice(0, dot);
    const outputName = refName.slice(dot + 1);
    if (outputName.length > 0) {
      const step = options.stepByName.get(stepName);
      if (step !== undefined) {
        const stepOutputs = options.outputs.get(step.id);
        const value = stepOutputs?.get(outputName);
        if (value === undefined) {
          throw new Error(`Missing output "${outputName}" from step "${stepName}".`);
        }
        return value;
      }
    }
  }

  // Convenience: allow `{{varName}}` to mean `{{scenario.varName}}` when declared.
  if (options.scenarioVarByName.has(refName)) {
    return options.resolveScenarioVariable(refName);
  }

  const external = options.resolveExternalValue(refName);
  if (external !== undefined) {
    return external;
  }

  // Leave unknown placeholders as empty string so a scenario can still run
  // with external values injected later (or fail at request execution time).
  return '';
}

function createStepOutputLookup(scenario: Scenario): ReadonlyMap<string, { readonly id: StepId; readonly outputs: readonly StepOutput[] }> {
  const stepByName = new Map<string, { readonly id: StepId; readonly outputs: readonly StepOutput[] }>();
  for (const step of scenario.steps) {
    stepByName.set(step.name, { id: step.id, outputs: step.outputs ?? [] });
  }
  return stepByName;
}

/**
 * Default implementation for {@link ScenarioVariableResolver}.
 * Framework-free core; external variable delegation uses repo-provided
 * {@link VariableResolver}.
 */
export function createScenarioVariableResolver(options: ScenarioVariableResolverOptions): ScenarioVariableResolver {
  const { scenario, externalVariableResolver, externalVariableDefinitions } = options;
  const scenarioVarByName = new Map<string, ScenarioVariable>(
    scenario.variables.map((v) => [v.name, v]),
  );
  const stepByName = createStepOutputLookup(scenario);

  const externalAnalysis: VariableAnalysis = externalVariableResolver.analyze({
    definitions: externalVariableDefinitions,
  } as VariableResolutionContext);

  const resolving = new Set<string>();
  const cache = new Map<string, string>();

  const resolveExternalValue = (name: string): string | undefined => {
    const value = externalAnalysis.values.get(name);
    return value?.value;
  };

  const resolveScenarioVariable = (name: string, context: ScenarioVariableResolutionContext): string => {
    const existing = context.variables.get(name);
    if (existing !== undefined) return existing;

    if (cache.has(name)) return cache.get(name)!;
    const definition = scenarioVarByName.get(name);
    if (definition === undefined) {
      throw new Error(`Unknown scenario variable "${name}".`);
    }
    if (definition.defaultValue === undefined) {
      throw new Error(`Scenario variable "${name}" has no defaultValue and is not assigned yet.`);
    }
    if (resolving.has(name)) {
      throw new Error(`Scenario variable cycle detected at "${name}".`);
    }

    resolving.add(name);
    try {
      const value = resolveStringTemplate(definition.defaultValue, context);
      cache.set(name, value);
      return value;
    } finally {
      resolving.delete(name);
    }
  };

  const resolveStringTemplate = (template: string, context: ScenarioVariableResolutionContext): string => {
    let result = '';
    let lastIndex = 0;
    for (const match of template.matchAll(REFERENCE)) {
      const start = match.index ?? 0;
      const refName = match[1] ?? '';
      result += template.slice(lastIndex, start);
      const value = resolveSingleTemplateReference(refName, {
        stepByName,
        scenarioVarByName,
        resolveScenarioVariable: (name) => resolveScenarioVariable(name, context),
        resolveExternalValue,
        outputs: context.outputs,
      });
      result += value;
      lastIndex = start + match[0]!.length;
    }
    result += template.slice(lastIndex);
    return result;
  };

  // Self-referential exports.
  return {
    scenarioId: scenario.id,
    resolveScenarioVariable: (name, context) => resolveScenarioVariable(name, context),
    resolveStringTemplate: (template, context) => resolveStringTemplate(template, context),
  };
}

