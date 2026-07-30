/**
 * Pure starter-template factories for Scenario UX create flow.
 * Returns schema-valid {@link Scenario} documents (no VS Code imports).
 */

import {
  ScenarioSchemaVersion,
  ScenarioVariableScope,
  StepType,
  createConnectionId,
  createScenarioId,
  createStepId,
  type Connection,
  type Scenario,
  type StepUnion,
} from '../models';

export type ScenarioTemplateId =
  | 'login-authenticated'
  | 'health-check'
  | 'crud-workflow'
  | 'blank'
  | 'user-registration'
  | 'auth-refresh'
  | 'smoke-test';

export interface ScenarioTemplateCatalogItem {
  readonly id: ScenarioTemplateId;
  readonly label: string;
  /** Outcome-focused description shown in the create QuickPick. */
  readonly description: string;
  /** When true, the template is secondary (e.g. Start Blank). */
  readonly secondary?: boolean;
  readonly tags: readonly string[];
}

const CATALOG: readonly ScenarioTemplateCatalogItem[] = [
  {
    id: 'login-authenticated',
    label: 'Login + Authenticated Request',
    description:
      'Authenticate once and reuse the token. Rebind request steps to your Collection requests.',
    tags: ['auth', 'token'],
  },
  {
    id: 'health-check',
    label: 'Health Check Branch',
    description:
      'Branch on health check success or failure. Rebind request steps to your Collection requests.',
    tags: ['health', 'branch'],
  },
  {
    id: 'crud-workflow',
    label: 'CRUD Workflow',
    description:
      'Run a full create-read-update-delete story. Rebind request steps to your Collection requests.',
    tags: ['crud'],
  },
  {
    id: 'user-registration',
    label: 'User Registration',
    description:
      'Register a user, confirm, then fetch the profile. Rebind request steps to your Collection requests.',
    tags: ['registration'],
  },
  {
    id: 'auth-refresh',
    label: 'Auth Refresh Path',
    description:
      'On auth failure, refresh credentials and retry the call. Rebind request steps to your Collection requests.',
    tags: ['auth', 'refresh'],
  },
  {
    id: 'smoke-test',
    label: 'Smoke Test Chain',
    description:
      'Run a short chain of health-style requests. Rebind request steps to your Collection requests.',
    tags: ['smoke'],
  },
  {
    id: 'blank',
    label: 'Start Blank',
    description:
      'Empty canvas with one entry step — add and bind Collection requests next.',
    secondary: true,
    tags: [],
  },
];

export function listScenarioTemplates(): readonly ScenarioTemplateCatalogItem[] {
  return CATALOG;
}

export function buildScenarioFromTemplate(
  templateId: ScenarioTemplateId,
  name: string,
): Scenario {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error('Scenario name must be non-empty.');
  }
  switch (templateId) {
    case 'login-authenticated':
      return buildLoginAuthenticated(trimmed);
    case 'health-check':
      return buildHealthCheck(trimmed);
    case 'crud-workflow':
      return buildCrudWorkflow(trimmed);
    case 'blank':
      return buildBlank(trimmed);
    case 'user-registration':
      return buildUserRegistration(trimmed);
    case 'auth-refresh':
      return buildAuthRefresh(trimmed);
    case 'smoke-test':
      return buildSmokeTest(trimmed);
    default: {
      const _exhaustive: never = templateId;
      throw new Error(`Unknown scenario template: ${String(_exhaustive)}`);
    }
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function baseScenario(
  name: string,
  description: string,
  steps: readonly StepUnion[],
  connections: readonly Connection[],
  tags: readonly string[],
  variables: Scenario['variables'] = [],
): Scenario {
  const stamp = nowIso();
  return {
    id: createScenarioId(),
    schemaVersion: ScenarioSchemaVersion,
    name,
    description,
    variables,
    steps,
    connections,
    executionSettings: { failurePolicy: 'stop-on-first-error' },
    metadata: {
      createdAt: stamp,
      updatedAt: stamp,
      ...(tags.length > 0 ? { tags } : {}),
    },
  };
}

function delayStep(
  name: string,
  x: number,
  y: number,
  description?: string,
): StepUnion {
  return {
    id: createStepId(),
    type: StepType.Delay,
    name,
    durationMs: 0,
    position: { x, y },
    ...(description === undefined ? {} : { description }),
  };
}

function requestStep(options: {
  readonly name: string;
  readonly requestRef: string;
  readonly x: number;
  readonly y: number;
  readonly description?: string;
  readonly inputMappings?: readonly {
    readonly variable: string;
    readonly requestVariable: string;
  }[];
  readonly outputs?: readonly {
    readonly name: string;
    readonly source: string;
    readonly targetVariable?: string;
  }[];
}): StepUnion {
  return {
    id: createStepId(),
    type: StepType.Request,
    name: options.name,
    requestId: `pending:${options.requestRef}`,
    requestFilePath: '',
    requestOffset: 0,
    requestRef: options.requestRef,
    inputMappings: options.inputMappings ?? [],
    position: { x: options.x, y: options.y },
    ...(options.description === undefined
      ? {}
      : { description: options.description }),
    ...(options.outputs === undefined ? {} : { outputs: options.outputs }),
  };
}

function variableStep(
  name: string,
  assignments: readonly { readonly name: string; readonly value: string }[],
  x: number,
  y: number,
  description?: string,
): StepUnion {
  return {
    id: createStepId(),
    type: StepType.Variable,
    name,
    assignments,
    position: { x, y },
    ...(description === undefined ? {} : { description }),
  };
}

function connect(from: StepUnion, to: StepUnion): Connection {
  return {
    id: createConnectionId(),
    fromStepId: from.id,
    toStepId: to.id,
  };
}

function conditionWithBranches(options: {
  readonly name: string;
  readonly expression: string;
  readonly x: number;
  readonly y: number;
  readonly trueTarget: StepUnion;
  readonly falseTarget: StepUnion;
  readonly description?: string;
}): { readonly step: StepUnion; readonly connections: readonly Connection[] } {
  const trueConnId = createConnectionId();
  const falseConnId = createConnectionId();
  const step: StepUnion = {
    id: createStepId(),
    type: StepType.Condition,
    name: options.name,
    expression: options.expression,
    trueBranch: trueConnId,
    falseBranch: falseConnId,
    position: { x: options.x, y: options.y },
    ...(options.description === undefined
      ? {}
      : { description: options.description }),
  };
  return {
    step,
    connections: [
      {
        id: trueConnId,
        fromStepId: step.id,
        toStepId: options.trueTarget.id,
      },
      {
        id: falseConnId,
        fromStepId: step.id,
        toStepId: options.falseTarget.id,
      },
    ],
  };
}

function buildBlank(name: string): Scenario {
  const entry = delayStep(
    'When this workflow runs',
    40,
    80,
    'Entry point — add request, condition, or variable steps next.',
  );
  return baseScenario(
    name,
    'Empty canvas with one entry step — add and bind Collection requests next.',
    [entry],
    [],
    [],
  );
}

function buildLoginAuthenticated(name: string): Scenario {
  const start = delayStep('Start', 40, 80);
  const login = requestStep({
    name: 'Login',
    requestRef: 'Login',
    x: 220,
    y: 80,
    description: 'Call your login request and capture the token.',
    outputs: [
      {
        name: 'token',
        source: 'body.token',
        targetVariable: 'token',
      },
    ],
  });
  const mapToken = variableStep(
    'Map Token',
    [{ name: 'token', value: '{{Login.token}}' }],
    400,
    80,
    'Publish the login token for later requests.',
  );
  const authenticated = requestStep({
    name: 'Get Profile',
    requestRef: 'Get Profile',
    x: 580,
    y: 80,
    description: 'Authenticated call that reuses the mapped token.',
    inputMappings: [{ variable: 'token', requestVariable: 'token' }],
  });
  const done = delayStep('Done', 760, 80, 'Workflow complete.');
  const connections = [
    connect(start, login),
    connect(login, mapToken),
    connect(mapToken, authenticated),
    connect(authenticated, done),
  ];
  return baseScenario(
    name,
    'Authenticate once and reuse the token. Rebind request steps to your Collection requests.',
    [start, login, mapToken, authenticated, done],
    connections,
    ['auth', 'token'],
    [
      {
        id: createStepId(),
        name: 'token',
        scope: ScenarioVariableScope.Scenario,
        sensitive: true,
      },
    ],
  );
}

function buildHealthCheck(name: string): Scenario {
  const start = delayStep('Start', 40, 120);
  const health = requestStep({
    name: 'Health',
    requestRef: 'Health',
    x: 220,
    y: 120,
    description: 'Call the health endpoint.',
  });
  const ok = delayStep('Ok', 580, 40, 'Health check succeeded.');
  const fail = delayStep('Fail', 580, 200, 'Health check failed.');
  const branch = conditionWithBranches({
    name: 'Healthy?',
    expression: 'statusCode == 200',
    x: 400,
    y: 120,
    trueTarget: ok,
    falseTarget: fail,
    description: 'Branch on HTTP success.',
  });
  return baseScenario(
    name,
    'Branch on health check success or failure. Rebind request steps to your Collection requests.',
    [start, health, branch.step, ok, fail],
    [connect(start, health), connect(health, branch.step), ...branch.connections],
    ['health', 'branch'],
  );
}

function buildCrudWorkflow(name: string): Scenario {
  const start = delayStep('Start', 40, 80);
  const create = requestStep({
    name: 'Create',
    requestRef: 'Create',
    x: 200,
    y: 80,
    description: 'Create a resource.',
  });
  const read = requestStep({
    name: 'Read',
    requestRef: 'Read',
    x: 360,
    y: 80,
    description: 'Read the created resource.',
  });
  const update = requestStep({
    name: 'Update',
    requestRef: 'Update',
    x: 520,
    y: 80,
    description: 'Update the resource.',
  });
  const del = requestStep({
    name: 'Delete',
    requestRef: 'Delete',
    x: 680,
    y: 80,
    description: 'Delete the resource.',
  });
  return baseScenario(
    name,
    'Run a full create-read-update-delete story. Rebind request steps to your Collection requests.',
    [start, create, read, update, del],
    [
      connect(start, create),
      connect(create, read),
      connect(read, update),
      connect(update, del),
    ],
    ['crud'],
  );
}

function buildUserRegistration(name: string): Scenario {
  const start = delayStep('Start', 40, 80);
  const register = requestStep({
    name: 'Register',
    requestRef: 'Register',
    x: 200,
    y: 80,
    description: 'Create the user account.',
  });
  const confirm = requestStep({
    name: 'Confirm Email',
    requestRef: 'Confirm Email',
    x: 380,
    y: 80,
    description: 'Confirm registration (email or code).',
  });
  const profile = requestStep({
    name: 'Get Profile',
    requestRef: 'Get Profile',
    x: 560,
    y: 80,
    description: 'Fetch the new user profile.',
  });
  return baseScenario(
    name,
    'Register a user, confirm, then fetch the profile. Rebind request steps to your Collection requests.',
    [start, register, confirm, profile],
    [
      connect(start, register),
      connect(register, confirm),
      connect(confirm, profile),
    ],
    ['registration'],
  );
}

function buildAuthRefresh(name: string): Scenario {
  const start = delayStep('Start', 40, 120);
  const callApi = requestStep({
    name: 'Protected Call',
    requestRef: 'Protected Call',
    x: 200,
    y: 120,
    description: 'Call a protected endpoint with the current session.',
  });
  const refresh = requestStep({
    name: 'Refresh Token',
    requestRef: 'Refresh Token',
    x: 520,
    y: 200,
    description: 'Refresh credentials after auth failure.',
  });
  const retry = requestStep({
    name: 'Retry Protected Call',
    requestRef: 'Protected Call',
    x: 700,
    y: 200,
    description: 'Retry the original call after refresh.',
  });
  const ok = delayStep('Ok', 520, 40, 'Call succeeded without refresh.');
  const branch = conditionWithBranches({
    name: 'Auth Failed?',
    expression: 'statusCode == 401',
    x: 360,
    y: 120,
    trueTarget: refresh,
    falseTarget: ok,
    description: 'If unauthorized, refresh then retry.',
  });
  return baseScenario(
    name,
    'On auth failure, refresh credentials and retry the call. Rebind request steps to your Collection requests.',
    [start, callApi, branch.step, ok, refresh, retry],
    [
      connect(start, callApi),
      connect(callApi, branch.step),
      ...branch.connections,
      connect(refresh, retry),
    ],
    ['auth', 'refresh'],
  );
}

function buildSmokeTest(name: string): Scenario {
  const start = delayStep('Start', 40, 80);
  const health = requestStep({
    name: 'Health',
    requestRef: 'Health',
    x: 200,
    y: 80,
  });
  const ready = requestStep({
    name: 'Ready',
    requestRef: 'Ready',
    x: 360,
    y: 80,
  });
  const version = requestStep({
    name: 'Version',
    requestRef: 'Version',
    x: 520,
    y: 80,
  });
  return baseScenario(
    name,
    'Run a short chain of health-style requests. Rebind request steps to your Collection requests.',
    [start, health, ready, version],
    [
      connect(start, health),
      connect(health, ready),
      connect(ready, version),
    ],
    ['smoke'],
  );
}
