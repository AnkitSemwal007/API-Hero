/**
 * Workspace-state helpers for scenario last-run status (not persisted in .scenario.json).
 */

export const SCENARIO_LAST_RUNS_STATE_KEY = 'apiHero.scenarioLastRuns';

/** WorkspaceState key: user dismissed the Collection Runner vs Scenario banner. */
export const SCENARIO_DIFF_BANNER_DISMISSED_KEY =
  'apiHero.scenarioDiffBannerDismissed';

/** Terminal statuses persisted in workspaceState (never persist in-flight runs). */
export type ScenarioLastRunStatus = 'completed' | 'failed' | 'cancelled';

export interface ScenarioLastRunRecord {
  readonly status: ScenarioLastRunStatus;
  readonly at: string;
}

export type ScenarioLastRunsMap = Readonly<
  Record<string, ScenarioLastRunRecord>
>;

export function readScenarioLastRuns(
  raw: unknown,
): ScenarioLastRunsMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, ScenarioLastRunRecord> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) continue;
    const record = value as Record<string, unknown>;
    const status = record.status;
    const at = record.at;
    // Drop legacy/in-flight "running" so a crash mid-run cannot leave a stuck spinner.
    if (
      (status === 'completed' ||
        status === 'failed' ||
        status === 'cancelled') &&
      typeof at === 'string' &&
      at.length > 0
    ) {
      out[id] = { status, at };
    }
  }
  return out;
}

export function formatLastRunDetail(
  record: ScenarioLastRunRecord | undefined,
  nowMs: number = Date.now(),
): string | undefined {
  if (record === undefined) return undefined;
  const statusLabel =
    record.status.charAt(0).toUpperCase() + record.status.slice(1);
  const ago = formatRelativeTime(record.at, nowMs);
  return `Last run: ${statusLabel}${ago === undefined ? '' : ` · ${ago}`}`;
}

function formatRelativeTime(iso: string, nowMs: number): string | undefined {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return undefined;
  const deltaSec = Math.max(0, Math.round((nowMs - then) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.round(deltaMin / 60);
  if (deltaHr < 48) return `${deltaHr}h ago`;
  const deltaDay = Math.round(deltaHr / 24);
  return `${deltaDay}d ago`;
}
