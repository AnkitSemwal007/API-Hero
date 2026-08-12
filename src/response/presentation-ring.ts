/**
 * In-session ring of already-redacted {@link ResponsePresentation} models
 * keyed by request identity. Used for Previous vs Current response diff —
 * not a durable execution history and never stores raw RuntimeResponse.
 */

import type { ResponsePresentation } from './presentation';

export const DEFAULT_PRESENTATION_RING_CAPACITY = 8;

export interface PresentationRingOptions {
  /** Max presentations retained per request key (minimum 2). Default 8. */
  readonly capacity?: number;
}

/**
 * Per-requestKey FIFO ring of presentation snapshots.
 * Push order is chronological; the newest entry is last.
 */
export class PresentationRing {
  private readonly capacity: number;
  private readonly byKey = new Map<string, ResponsePresentation[]>();

  public constructor(options: PresentationRingOptions = {}) {
    this.capacity = Math.max(2, options.capacity ?? DEFAULT_PRESENTATION_RING_CAPACITY);
  }

  /** Appends a presentation, evicting the oldest when over capacity. */
  public push(requestKey: string, presentation: ResponsePresentation): void {
    const key = requestKey.trim();
    if (key.length === 0) {
      return;
    }
    const existing = this.byKey.get(key) ?? [];
    const next = [...existing, presentation];
    if (next.length > this.capacity) {
      next.splice(0, next.length - this.capacity);
    }
    this.byKey.set(key, next);
  }

  /** Newest presentation for the key, if any. */
  public latest(requestKey: string): ResponsePresentation | undefined {
    const entries = this.list(requestKey);
    return entries.length === 0 ? undefined : entries[entries.length - 1];
  }

  /**
   * Second-newest presentation (Previous) when at least two entries exist.
   */
  public previous(requestKey: string): ResponsePresentation | undefined {
    const entries = this.list(requestKey);
    return entries.length < 2 ? undefined : entries[entries.length - 2];
  }

  public hasPrevious(requestKey: string): boolean {
    return this.list(requestKey).length >= 2;
  }

  /** Chronological list (oldest → newest), empty when unknown. */
  public list(requestKey: string): readonly ResponsePresentation[] {
    const key = requestKey.trim();
    if (key.length === 0) {
      return [];
    }
    return this.byKey.get(key) ?? [];
  }

  public clear(requestKey?: string): void {
    if (requestKey === undefined) {
      this.byKey.clear();
      return;
    }
    this.byKey.delete(requestKey.trim());
  }
}
