/**
 * Explanatory resolution chain for Request Editor Auth tab.
 * Mirrors {@link selectAuthenticationReference} precedence — does not change it.
 */

export type AuthenticationResolutionSource =
  | 'request'
  | 'collection'
  | 'workspace'
  | 'none';

export interface AuthenticationResolutionStep {
  readonly source: AuthenticationResolutionSource;
  /** User-facing label for the step. */
  readonly label: string;
  /** Profile id at this layer, if any. */
  readonly authenticationId?: string;
  /** True when this layer supplied the selected id. */
  readonly selected: boolean;
}

export interface ExplainAuthenticationResolutionInput {
  /** Request `@auth` / unresolved reference (trimmed empty → absent). */
  readonly requestOverrideId?: string;
  readonly collectionDefaultId?: string;
  /** Workspace / session default profile id. */
  readonly workspaceDefaultId?: string;
}

export interface ExplainAuthenticationResolutionResult {
  readonly steps: readonly AuthenticationResolutionStep[];
  readonly selectedId?: string;
  readonly source: AuthenticationResolutionSource;
}

/**
 * Builds a secret-free explanation of which Authentication applies.
 * Precedence matches `selectAuthenticationReference`: request → collection → workspace.
 */
export function explainAuthenticationResolution(
  input: ExplainAuthenticationResolutionInput,
): ExplainAuthenticationResolutionResult {
  const request = normalizeId(input.requestOverrideId);
  const collection = normalizeId(input.collectionDefaultId);
  const workspace = normalizeId(input.workspaceDefaultId);

  let selectedId: string | undefined;
  let source: AuthenticationResolutionSource = 'none';
  if (request !== undefined) {
    selectedId = request;
    source = 'request';
  } else if (collection !== undefined) {
    selectedId = collection;
    source = 'collection';
  } else if (workspace !== undefined) {
    selectedId = workspace;
    source = 'workspace';
  }

  const steps: AuthenticationResolutionStep[] = [
    {
      source: 'request',
      label: 'Request Override',
      ...(request !== undefined ? { authenticationId: request } : {}),
      selected: source === 'request',
    },
    {
      source: 'collection',
      label: 'Collection Default',
      ...(collection !== undefined ? { authenticationId: collection } : {}),
      selected: source === 'collection',
    },
    {
      source: 'workspace',
      label: 'Workspace/Session Default',
      ...(workspace !== undefined ? { authenticationId: workspace } : {}),
      selected: source === 'workspace',
    },
  ];

  return {
    steps,
    ...(selectedId !== undefined ? { selectedId } : {}),
    source,
  };
}

function normalizeId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}
