/**
 * Minimal same-folder reorder so producers precede consumers.
 * Framework-free. Does not detect cycles — callers must check first.
 */

export interface OrderConstraint {
  /** Producer — must appear before `afterId`. */
  readonly beforeId: string;
  /** Consumer. */
  readonly afterId: string;
}

export interface MinimalReorderResult {
  readonly order: readonly string[];
  readonly changed: boolean;
}

/**
 * Returns a new order of the same ids, or unchanged if already valid /
 * unsatisfiable without cycle handling (caller detects cycles).
 *
 * Preserves relative order of unrelated items. For each violated constraint,
 * compares moving the producer just before the consumer vs moving the consumer
 * just after the producer; picks the lower absolute index-delta score, with
 * ties preferring producer-before-consumer.
 */
export function minimalReorderForConstraints(
  order: readonly string[],
  constraints: readonly OrderConstraint[],
): MinimalReorderResult {
  const applicable = constraints.filter((constraint) => {
    if (constraint.beforeId === constraint.afterId) {
      return false;
    }
    return (
      order.includes(constraint.beforeId) && order.includes(constraint.afterId)
    );
  });

  if (applicable.length === 0) {
    return { order: [...order], changed: false };
  }

  let current = [...order];
  const original = order;
  const maxIterations = Math.max(1, order.length * order.length);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const violated = applicable.filter((constraint) => {
      const beforeIndex = current.indexOf(constraint.beforeId);
      const afterIndex = current.indexOf(constraint.afterId);
      return beforeIndex > afterIndex;
    });
    if (violated.length === 0) {
      break;
    }

    let best: { readonly next: string[]; readonly score: number } | undefined;
    for (const constraint of violated) {
      const moveProducer = moveItemBefore(
        current,
        constraint.beforeId,
        constraint.afterId,
      );
      const moveConsumer = moveItemAfter(
        current,
        constraint.afterId,
        constraint.beforeId,
      );
      const producerScore = movedItemDelta(
        current,
        moveProducer,
        constraint.beforeId,
      );
      const consumerScore = movedItemDelta(
        current,
        moveConsumer,
        constraint.afterId,
      );

      // Tie → prefer move producer before consumer.
      const candidate =
        producerScore <= consumerScore
          ? { next: moveProducer, score: producerScore }
          : { next: moveConsumer, score: consumerScore };

      if (best === undefined || candidate.score < best.score) {
        best = candidate;
      }
    }

    if (best === undefined || arraysEqual(best.next, current)) {
      break;
    }
    current = best.next;
  }

  const changed = !arraysEqual(current, original);
  return { order: current, changed };
}

function moveItemBefore(
  order: readonly string[],
  moveId: string,
  beforeId: string,
): string[] {
  const without = order.filter((id) => id !== moveId);
  const targetIndex = without.indexOf(beforeId);
  if (targetIndex < 0) {
    return [...order];
  }
  const next = [...without];
  next.splice(targetIndex, 0, moveId);
  return next;
}

function moveItemAfter(
  order: readonly string[],
  moveId: string,
  afterId: string,
): string[] {
  const without = order.filter((id) => id !== moveId);
  const targetIndex = without.indexOf(afterId);
  if (targetIndex < 0) {
    return [...order];
  }
  const next = [...without];
  next.splice(targetIndex + 1, 0, moveId);
  return next;
}

function movedItemDelta(
  before: readonly string[],
  after: readonly string[],
  movedId: string,
): number {
  const from = before.indexOf(movedId);
  const to = after.indexOf(movedId);
  if (from < 0 || to < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(from - to);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
