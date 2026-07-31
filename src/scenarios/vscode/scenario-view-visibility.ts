/**
 * Progressive disclosure for the Scenarios explorer view.
 * Visibility is driven by a VS Code context key; this module holds pure policy.
 */

/** Context key toggled via `setContext` to show/hide `apiHero.explorer`. */
export const SCENARIOS_VISIBLE_CONTEXT_KEY = 'apiHero.scenariosVisible';

/**
 * WorkspaceState flag: Scenarios were revealed for this workspace and must stay
 * visible even if all scenario files are later deleted.
 */
export const SCENARIOS_VIEW_REVEALED_STATE_KEY = 'apiHero.scenariosViewRevealed';

export interface ScenariosViewVisibilityInput {
  /** At least one Scenario document loaded successfully (not merely a file on disk). */
  readonly hasLoadedScenarios: boolean;
  readonly wasRevealed: boolean;
}

export interface ScenariosViewVisibilityResult {
  /** Whether `apiHero.scenariosVisible` should be true. */
  readonly visible: boolean;
  /** Persist {@link SCENARIOS_VIEW_REVEALED_STATE_KEY} when newly revealed by loaded scenarios. */
  readonly shouldPersistReveal: boolean;
}

/**
 * Scenarios stay hidden until the workspace has successfully loaded scenarios or
 * was previously revealed. Once shown, they remain visible for that workspace.
 *
 * Policy inputs are only successful loads and sticky reveal. Migration status,
 * corrupt/unreadable files, and focus commands are not inputs — callers must
 * not pass those signals here.
 */
export function resolveScenariosViewVisibility(
  input: ScenariosViewVisibilityInput,
): ScenariosViewVisibilityResult {
  const visible = input.hasLoadedScenarios || input.wasRevealed;
  return {
    visible,
    shouldPersistReveal: visible && !input.wasRevealed,
  };
}

/**
 * Whether `setContext(apiHero.scenariosVisible, next)` should run.
 * Skips no-op updates (create→reveal then refreshTree sync, repeated refreshes).
 */
export function shouldApplyScenariosVisibleContext(
  previous: boolean | undefined,
  next: boolean,
): boolean {
  return previous !== next;
}
