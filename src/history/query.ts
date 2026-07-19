import {
  HistoryExecutionStatus,
  type HistoryEntry,
  type HistoryExecutionStatus as HistoryStatus,
  type HistoryStatistics,
} from './models';

/** Recency buckets used by the History explorer. */
export const HistoryTimeGroup = {
  Today: 'today',
  Yesterday: 'yesterday',
  Last7Days: 'last-7-days',
  Older: 'older',
} as const;

export type HistoryTimeGroup =
  (typeof HistoryTimeGroup)[keyof typeof HistoryTimeGroup];

export interface HistoryFilter {
  readonly status?: HistoryStatus | readonly HistoryStatus[];
  readonly method?: string;
  /** Case-insensitive substring match across method, URL, name, env, status. */
  readonly query?: string;
}

export interface HistorySortOptions {
  readonly direction?: 'asc' | 'desc';
}

export interface HistoryGroup {
  readonly id: HistoryTimeGroup;
  readonly label: string;
  readonly entries: readonly HistoryEntry[];
}

const GROUP_LABELS: Readonly<Record<HistoryTimeGroup, string>> = {
  [HistoryTimeGroup.Today]: 'Today',
  [HistoryTimeGroup.Yesterday]: 'Yesterday',
  [HistoryTimeGroup.Last7Days]: 'Last 7 Days',
  [HistoryTimeGroup.Older]: 'Older',
};

/** Filters entries by status, method, and free-text query. */
export function filterHistoryEntries(
  entries: readonly HistoryEntry[],
  filter: HistoryFilter = {},
): readonly HistoryEntry[] {
  const statuses = normalizeStatuses(filter.status);
  const method =
    filter.method === undefined
      ? undefined
      : filter.method.trim().toUpperCase();
  const query =
    filter.query === undefined || filter.query.trim().length === 0
      ? undefined
      : filter.query.trim().toLowerCase();

  return Object.freeze(
    entries.filter((entry) => {
      if (statuses !== undefined && !statuses.has(entry.summary.status)) {
        return false;
      }
      if (method !== undefined && entry.summary.method.toUpperCase() !== method) {
        return false;
      }
      if (query !== undefined && !matchesQuery(entry, query)) {
        return false;
      }
      return true;
    }),
  );
}

/** Sorts by summary timestamp. Default newest-first. */
export function sortHistoryEntries(
  entries: readonly HistoryEntry[],
  options: HistorySortOptions = {},
): readonly HistoryEntry[] {
  const direction = options.direction ?? 'desc';
  const sorted = [...entries].sort((left, right) => {
    const delta =
      Date.parse(left.summary.timestamp) - Date.parse(right.summary.timestamp);
    return direction === 'asc' ? delta : -delta;
  });
  return Object.freeze(sorted);
}

/**
 * Groups newest-first entries into Today / Yesterday / Last 7 Days / Older.
 * Empty groups are omitted.
 */
export function groupHistoryEntries(
  entries: readonly HistoryEntry[],
  now: Date = new Date(),
): readonly HistoryGroup[] {
  const buckets: Record<HistoryTimeGroup, HistoryEntry[]> = {
    [HistoryTimeGroup.Today]: [],
    [HistoryTimeGroup.Yesterday]: [],
    [HistoryTimeGroup.Last7Days]: [],
    [HistoryTimeGroup.Older]: [],
  };

  for (const entry of entries) {
    buckets[classifyTimeGroup(entry.summary.timestamp, now)].push(entry);
  }

  const order: readonly HistoryTimeGroup[] = [
    HistoryTimeGroup.Today,
    HistoryTimeGroup.Yesterday,
    HistoryTimeGroup.Last7Days,
    HistoryTimeGroup.Older,
  ];

  return Object.freeze(
    order
      .filter((id) => buckets[id].length > 0)
      .map((id) =>
        Object.freeze({
          id,
          label: GROUP_LABELS[id],
          entries: Object.freeze([...buckets[id]]),
        }),
      ),
  );
}

/** Computes aggregate statistics. */
export function computeHistoryStatistics(
  entries: readonly HistoryEntry[],
): HistoryStatistics {
  let success = 0;
  let failure = 0;
  let cancelled = 0;
  for (const entry of entries) {
    switch (entry.summary.status) {
      case HistoryExecutionStatus.Success:
        success += 1;
        break;
      case HistoryExecutionStatus.Failure:
        failure += 1;
        break;
      case HistoryExecutionStatus.Cancelled:
        cancelled += 1;
        break;
      default:
        break;
    }
  }
  return Object.freeze({
    total: entries.length,
    success,
    failure,
    cancelled,
  });
}

export function classifyTimeGroup(
  timestamp: string,
  now: Date = new Date(),
): HistoryTimeGroup {
  const instant = Date.parse(timestamp);
  if (!Number.isFinite(instant)) {
    return HistoryTimeGroup.Older;
  }

  const startOfToday = startOfLocalDay(now);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfLast7 = new Date(startOfToday);
  startOfLast7.setDate(startOfLast7.getDate() - 6);

  if (instant >= startOfToday.getTime()) {
    return HistoryTimeGroup.Today;
  }
  if (instant >= startOfYesterday.getTime()) {
    return HistoryTimeGroup.Yesterday;
  }
  if (instant >= startOfLast7.getTime()) {
    return HistoryTimeGroup.Last7Days;
  }
  return HistoryTimeGroup.Older;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function normalizeStatuses(
  status: HistoryFilter['status'],
): ReadonlySet<HistoryStatus> | undefined {
  if (status === undefined) {
    return undefined;
  }
  if (typeof status === 'string') {
    return new Set([status]);
  }
  return new Set(status);
}

function matchesQuery(entry: HistoryEntry, query: string): boolean {
  const haystack = [
    entry.summary.method,
    entry.summary.url,
    entry.summary.status,
    entry.summary.statusText ?? '',
    entry.summary.statusCode?.toString() ?? '',
    entry.metadata.requestName ?? '',
    entry.metadata.environmentName ?? '',
    entry.metadata.collectionName ?? '',
    entry.metadata.errorCode ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}
