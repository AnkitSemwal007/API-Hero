import { cloneDetached, deepFreeze } from '../shared';

/**
 * Opaque stable identifier for one scenario definition.
 * Use {@link createScenarioId} for generation.
 */
export type ScenarioId = string;

/**
 * Opaque stable identifier for one step inside a scenario.
 * Use {@link createStepId} for generation.
 */
export type StepId = string;

/**
 * Opaque stable identifier for one connection between steps.
 * Use {@link createConnectionId} for generation.
 */
export type ConnectionId = string;

/**
 * Opaque stable identifier for one scenario run instance.
 * Use {@link createScenarioRunId} for generation.
 */
export type ScenarioRunId = string;

/**
 * Current scenario schema version stored in serialized `.scenario.json`
 * documents.
 */
export const ScenarioSchemaVersion = '1.0.0' as const;
export type ScenarioSchemaVersion = typeof ScenarioSchemaVersion;

/** Scenario step type discriminator. */
export const StepType = {
  Request: 'request',
  Delay: 'delay',
  Condition: 'condition',
  Variable: 'variable',
  Group: 'group',
} as const;
export type StepType = (typeof StepType)[keyof typeof StepType];

/** Step capabilities used by the step registry for future UI/validation. */
export const StepCapability = {
  Retry: 'retry',
  Outputs: 'outputs',
  Branches: 'branches',
  Cancellation: 'cancellation',
  Validation: 'validation',
} as const;
export type StepCapability =
  (typeof StepCapability)[keyof typeof StepCapability];

/** Domain scope for scenario variables (metadata + resolution ownership). */
export const ScenarioVariableScope = {
  Scenario: 'scenario',
  Environment: 'environment',
  Workspace: 'workspace',
  Collection: 'collection',
  Secret: 'secret',
  Output: 'output',
} as const;
export type ScenarioVariableScope =
  (typeof ScenarioVariableScope)[keyof typeof ScenarioVariableScope];

/**
 * Scenario-level variable metadata.
 * Values can be overwritten during execution by variable steps or output
 * targets.
 */
export interface ScenarioVariable {
  /** Stable identifier for UI / variable metadata. */
  readonly id: string;
  /** Variable name used by `{{scenario.varName}}` references. */
  readonly name: string;
  readonly scope: ScenarioVariableScope;
  /** Default value when the variable is not overwritten during execution. */
  readonly defaultValue?: string;
  /** Marks values as secret for report redaction. */
  readonly sensitive: boolean;
}

/** One output produced by a step. */
export interface StepOutput {
  /** Output name referenced by `{{stepName.outputName}}`. */
  readonly name: string;
  /**
   * Extraction source (e.g. `body.<json-path>`, `header <name>`, `status`),
   * or an expression to be interpreted by later runtime versions.
   */
  readonly source: string;
  /**
   * Optional scenario variable target.
   * When present, the engine also writes the extracted output to this
   * variable in addition to the output map.
   */
  readonly targetVariable?: string;
}

/** Retry policy for one step execution attempt loop. */
export interface RetryPolicy {
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly continueOnFailure: boolean;
  readonly stopOnFailure: boolean;
}

export type ConditionOperator =
  | '=='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'contains'
  | 'not-contains';

/** One boolean predicate used by condition steps. */
export interface ConditionExpression {
  /** Variable reference (templated) or literal string. */
  readonly left: string;
  readonly operator: ConditionOperator;
  /** Variable reference (templated) or literal string. */
  readonly right: string;
}

/** One directed connection edge between two steps. */
export interface Connection {
  readonly id: ConnectionId;
  readonly fromStepId: StepId;
  readonly toStepId: StepId;
  /**
   * Optional connection predicate for conditional edges.
   * When using {@link ConditionStep}, this can be omitted.
   */
  readonly condition?: ConditionExpression;
}

/**
 * Base step metadata.
 * Steps are referenced by `id` in the control-flow graph.
 */
export interface Step {
  readonly id: StepId;
  readonly type: StepType;
  readonly name: string;
  readonly description?: string;
  /**
   * Optional visual position (for canvas editors).
   * Coordinates are stored exactly as authored.
   */
  readonly position?: { readonly x: number; readonly y: number };
  readonly retryPolicy?: RetryPolicy;
  readonly outputs?: readonly StepOutput[];
}

/** Mapping from scenario variable names to request template variables. */
export interface RequestStepInputMapping {
  /** Scenario-level variable name to read from execution context. */
  readonly variable: string;
  /** Request variable name used in the `.api` source templates. */
  readonly requestVariable: string;
}

/** Request execution step. */
export interface RequestStep extends Step {
  readonly type: typeof StepType.Request;
  readonly requestId: string;
  /** Absolute path/URI of the `.api` file containing the request block. */
  readonly requestFilePath: string;
  /** UTF-16 offset into the `.api` file used by `runAtSourceLocation`. */
  readonly requestOffset: number;
  /**
   * Human-readable request reference (ADR 0002): bare `Login`,
   * qualified `Folder/Login`, or root-qualified `./Login`.
   * When present, VS Code resolves it against the request catalog before run.
   */
  readonly requestRef?: string;
  /**
   * Maps resolved scenario variables to request template variables inside
   * the `.api` source.
   */
  readonly inputMappings: readonly RequestStepInputMapping[];
}

/** Delay step waits for a duration while respecting cancellation. */
export interface DelayStep extends Step {
  readonly type: typeof StepType.Delay;
  readonly durationMs: number;
}

/** Condition step chooses between two outgoing connections. */
export interface ConditionStep extends Step {
  readonly type: typeof StepType.Condition;
  /**
   * Structured predicate (simple left/operator/right form).
   * Required when {@link expression} is omitted.
   */
  readonly condition?: ConditionExpression;
  /**
   * JSON-friendly boolean expression string supporting statusCode,
   * headers["name"], {{name}}, && / || / !, and comparisons.
   * Preferred when present.
   */
  readonly expression?: string;
  /** Connection id used for the `true` branch. */
  readonly trueBranch: ConnectionId;
  /** Connection id used for the `false` branch. */
  readonly falseBranch: ConnectionId;
}

/** One variable assignment in a variable step. */
export interface VariableStepAssignment {
  readonly name: string;
  /** String containing templated references. */
  readonly value: string;
}

/** Variable step writes scenario variables in execution context. */
export interface VariableStep extends Step {
  readonly type: typeof StepType.Variable;
  readonly assignments: readonly VariableStepAssignment[];
}

/** Group step is visual-only; execution is pass-through. */
export interface GroupStep extends Step {
  readonly type: typeof StepType.Group;
  /** Step ids visually grouped together (graph semantics are unchanged). */
  readonly stepIds: readonly StepId[];
}

/** Union of all supported step types. */
export type StepUnion =
  | RequestStep
  | DelayStep
  | ConditionStep
  | VariableStep
  | GroupStep;

/** Scenario definition persisted in `.scenario.json` files. */
export interface Scenario {
  readonly id: ScenarioId;
  readonly schemaVersion: string;
  readonly name: string;
  readonly description?: string;
  readonly variables: readonly ScenarioVariable[];
  readonly steps: readonly StepUnion[];
  readonly connections: readonly Connection[];
  readonly executionSettings: {
    readonly failurePolicy: string;
    readonly timeoutMs?: number;
  };
  readonly metadata: {
    readonly createdAt: string;
    readonly updatedAt: string;
    /** Optional gallery/filter tags; preserved on parse + serialize. */
    readonly tags?: readonly string[];
  };
}

export const StepRunStatus = {
  Pending: 'pending',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Skipped: 'skipped',
  Cancelled: 'cancelled',
  Retrying: 'retrying',
} as const;
export type StepRunStatus =
  (typeof StepRunStatus)[keyof typeof StepRunStatus];

export const ScenarioRunStatus = {
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type ScenarioRunStatus =
  (typeof ScenarioRunStatus)[keyof typeof ScenarioRunStatus];

/**
 * Execution result for one step.
 * Values are detached and safe for reporting.
 */
export interface StepRunResult {
  readonly stepId: StepId;
  readonly stepName: string;
  readonly status: StepRunStatus;
  readonly startTime: number;
  readonly endTime: number;
  readonly durationMs: number;
  /**
   * Attempt index starting at 1 for the first execution attempt.
   * For skipped/cancelled steps, this may be 0.
   */
  readonly attempt: number;
  readonly outputs?: readonly { readonly name: string; readonly value: string }[];
  readonly error?: { readonly message: string; readonly cause?: unknown };
  readonly requestResult?: unknown;
}

/** Timeline entry for UI/debug. */
export interface TimelineEntry {
  readonly timestamp: number;
  readonly stepId: StepId;
  readonly stepName: string;
  readonly event:
    | 'started'
    | 'completed'
    | 'failed'
    | 'retried'
    | 'skipped';
  readonly message?: string;
}

/** One completed scenario run. */
export interface ScenarioRunResult {
  readonly runId: ScenarioRunId;
  readonly scenarioId: ScenarioId;
  readonly scenarioName: string;
  readonly status: ScenarioRunStatus;
  readonly startTime: number;
  readonly endTime: number;
  readonly durationMs: number;
  readonly stepResults: readonly StepRunResult[];
  readonly variables: ReadonlyMap<string, string>;
  readonly timeline: readonly TimelineEntry[];
}

/**
 * Deep-freeze a detached scenario instance to prevent runtime mutation and
 * ensure deterministic serialization inputs.
 */
export function freezeScenario(scenario: Scenario): Scenario {
  return deepFreeze(cloneDetached(scenario));
}

/** Creates one new opaque scenario id. */
export function createScenarioId(): ScenarioId {
  return crypto.randomUUID();
}

/** Creates one new opaque step id. */
export function createStepId(): StepId {
  return crypto.randomUUID();
}

/** Creates one new opaque connection id. */
export function createConnectionId(): ConnectionId {
  return crypto.randomUUID();
}

/** Creates one new opaque scenario run id. */
export function createScenarioRunId(): ScenarioRunId {
  return crypto.randomUUID();
}

