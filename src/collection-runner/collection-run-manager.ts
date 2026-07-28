/**
 * Single source of truth for collection-run session UI state.
 * Tracks active runs, progress snapshots, cancel handles, and a recent ring.
 * Framework-free - no vscode imports.
 */

import type { CollectionRunProgressPort } from './collection-runner';
import {
  type RequestRunResult,
  type RunIdentifier,
  type RunProgressEvent,
  type RunSummary,
} from './models';
import {
  RunSessionStatus,
  sessionStatusFromRunStatus,
  type BeginCollectionRunSessionOptions,
  type BeginCollectionRunSessionResult,
  type CollectionRunSessionSnapshot,
} from './run-session-models';

const DEFAULT_RECENT_LIMIT = 20;

interface MutableSession {
  snapshot: CollectionRunSessionSnapshot;
  readonly abortController: AbortController;
}

export interface CollectionRunManagerOptions {
  readonly recentLimit?: number;
  readonly now?: () => number;
}

export interface CollectionRunManagerDisposable {
  dispose(): void;
}

/** Thrown when {@link CollectionRunManager.begin} is called while another run is active. */
export class CollectionRunAlreadyActiveError extends Error {
  public override readonly name = 'CollectionRunAlreadyActiveError';

  public constructor(public readonly activeRunId: RunIdentifier) {
    super(
      `A collection run is already active (runId=${activeRunId}). Cancel it before starting another.`,
    );
  }
}

export class CollectionRunManager implements CollectionRunProgressPort {
  private readonly activeSessions: MutableSession[] = [];
  private readonly recent: CollectionRunSessionSnapshot[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly recentLimit: number;
  private readonly now: () => number;

  public constructor(options: CollectionRunManagerOptions = {}) {
    this.recentLimit = Math.max(1, options.recentLimit ?? DEFAULT_RECENT_LIMIT);
    this.now = options.now ?? Date.now;
  }

  public get activeCount(): number {
    return this.activeSessions.length;
  }

  public begin(
    options: BeginCollectionRunSessionOptions,
  ): BeginCollectionRunSessionResult {
    const { plan } = options;
    const existingIndex = this.activeSessions.findIndex(
      (entry) => entry.snapshot.runId === plan.runId,
    );
    if (existingIndex < 0 && this.activeSessions.length > 0) {
      const activeRunId = this.activeSessions[0]!.snapshot.runId;
      throw new CollectionRunAlreadyActiveError(activeRunId);
    }
    const abortController = options.abortController ?? new AbortController();
    const nowMs = options.nowMs ?? this.now();
    const startedAt = new Date(nowMs).toISOString();
    const snapshot: CollectionRunSessionSnapshot = {
      runId: plan.runId,
      status: RunSessionStatus.Running,
      plan,
      collectionId: plan.collectionId,
      collectionName: plan.collectionName,
      mode: plan.mode,
      failurePolicy: plan.failurePolicy,
      total: plan.requests.length,
      completed: 0,
      remaining: plan.requests.length,
      elapsedMs: 0,
      startedAt,
      results: [],
    };
    if (existingIndex >= 0) {
      this.activeSessions.splice(existingIndex, 1);
    }
    this.activeSessions.push({ snapshot, abortController });
    this.notify();
    return {
      runId: plan.runId,
      signal: abortController.signal,
      abortController,
      snapshot,
    };
  }

  public onProgress(event: RunProgressEvent): void {
    const entry = this.findActive(event.runId);
    if (entry === undefined) {
      return;
    }
    const results = appendProgressResult(entry.snapshot.results, event);
    entry.snapshot = {
      ...entry.snapshot,
      completed: event.completed,
      remaining: event.remaining,
      total: event.total,
      elapsedMs: event.elapsedMs,
      ...(event.current === undefined
        ? { current: undefined }
        : { current: event.current }),
      lastProgress: event,
      results,
    };
    this.notify();
  }

  public complete(summary: RunSummary): void {
    const entry = this.findActive(summary.runId);
    const base =
      entry?.snapshot ??
      ({
        runId: summary.runId,
        status: RunSessionStatus.Running,
        plan: summary.plan,
        collectionId: summary.plan.collectionId,
        collectionName: summary.plan.collectionName,
        mode: summary.plan.mode,
        failurePolicy: summary.plan.failurePolicy,
        total: summary.plan.requests.length,
        completed:
          summary.statistics.passed +
          summary.statistics.failed +
          summary.statistics.skipped +
          summary.statistics.cancelled,
        remaining: 0,
        elapsedMs: summary.statistics.durationMs,
        startedAt: summary.plan.createdAt,
        results: summary.results,
      } satisfies CollectionRunSessionSnapshot);
    const terminal: CollectionRunSessionSnapshot = {
      ...base,
      status: sessionStatusFromRunStatus(summary.status),
      completed:
        summary.statistics.passed +
        summary.statistics.failed +
        summary.statistics.skipped +
        summary.statistics.cancelled,
      remaining: 0,
      elapsedMs: summary.statistics.durationMs,
      completedAt: summary.completedAt,
      current: undefined,
      results: summary.results,
      summary,
      lastProgress: base.lastProgress,
    };
    this.removeActive(summary.runId);
    this.pushRecent(terminal);
    this.notify();
  }

  public fail(runId: RunIdentifier, errorMessage?: string): boolean {
    const entry = this.findActive(runId);
    if (entry === undefined) {
      return false;
    }
    const completedAt = new Date(this.now()).toISOString();
    const terminal: CollectionRunSessionSnapshot = {
      ...entry.snapshot,
      status: RunSessionStatus.Failed,
      remaining: 0,
      completedAt,
      current: undefined,
      ...(errorMessage === undefined || errorMessage.trim().length === 0
        ? {}
        : { errorMessage: errorMessage.trim() }),
    };
    this.removeActive(runId);
    this.pushRecent(terminal);
    this.notify();
    return true;
  }

  public cancel(runId: RunIdentifier): boolean {
    const entry = this.findActive(runId);
    if (entry === undefined) {
      return false;
    }
    if (!entry.abortController.signal.aborted) {
      entry.abortController.abort('cancelled');
    }
    return true;
  }

  public listActive(): readonly CollectionRunSessionSnapshot[] {
    return this.activeSessions.map((entry) => entry.snapshot);
  }

  public listRecent(): readonly CollectionRunSessionSnapshot[] {
    return this.recent.slice();
  }

  public get(runId: RunIdentifier): CollectionRunSessionSnapshot | undefined {
    return (
      this.findActive(runId)?.snapshot ??
      this.recent.find((item) => item.runId === runId)
    );
  }

  public onDidChange(
    listener: () => void,
  ): CollectionRunManagerDisposable {
    this.listeners.add(listener);
    return {
      dispose: (): void => {
        this.listeners.delete(listener);
      },
    };
  }

  private findActive(runId: RunIdentifier): MutableSession | undefined {
    return this.activeSessions.find(
      (entry) => entry.snapshot.runId === runId,
    );
  }

  private removeActive(runId: RunIdentifier): void {
    const index = this.activeSessions.findIndex(
      (entry) => entry.snapshot.runId === runId,
    );
    if (index >= 0) {
      this.activeSessions.splice(index, 1);
    }
  }

  private pushRecent(snapshot: CollectionRunSessionSnapshot): void {
    const without = this.recent.filter((item) => item.runId !== snapshot.runId);
    without.unshift(snapshot);
    this.recent.length = 0;
    this.recent.push(...without.slice(0, this.recentLimit));
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function appendProgressResult(
  existing: readonly RequestRunResult[],
  event: RunProgressEvent,
): readonly RequestRunResult[] {
  if (event.lastResult === undefined) {
    return existing;
  }
  const already = existing.some(
    (result) =>
      result.requestId === event.lastResult!.requestId &&
      result.ordinal === event.lastResult!.ordinal,
  );
  if (already) {
    return existing;
  }
  return [...existing, event.lastResult];
}
