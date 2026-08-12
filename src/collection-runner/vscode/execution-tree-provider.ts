import {
  EventEmitter,
  ThemeColor,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  type Disposable,
  type Event,
  type TreeDataProvider,
} from 'vscode';

import { COMMAND_IDS } from '../../constants';
import { listFailurePolicies } from '../failure-policies';
import { formatAttemptLabel } from '../progress-labels';
import type { CollectionRunSessionSnapshot } from '../run-session-models';
import { RunSessionStatus } from '../run-session-models';

const POLICY_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    listFailurePolicies().map((policy) => [policy.kind, policy.label]),
  ),
);

const TimeGroupId = {
  Today: 'today',
  Yesterday: 'yesterday',
  Last7Days: 'last-7-days',
  Older: 'older',
} as const;

type TimeGroupId = (typeof TimeGroupId)[keyof typeof TimeGroupId];

const TIME_GROUP_LABELS: Readonly<Record<TimeGroupId, string>> = {
  [TimeGroupId.Today]: 'Today',
  [TimeGroupId.Yesterday]: 'Yesterday',
  [TimeGroupId.Last7Days]: 'Last 7 Days',
  [TimeGroupId.Older]: 'Older',
};

export type ExecutionTreeNode =
  | {
      readonly kind: 'section';
      readonly id: 'running' | 'recent';
      readonly label: string;
    }
  | {
      readonly kind: 'dayGroup';
      readonly id: string;
      readonly groupId: TimeGroupId;
      readonly label: string;
      readonly sessions: readonly CollectionRunSessionSnapshot[];
    }
  | {
      readonly kind: 'activeRun';
      readonly id: string;
      readonly session: CollectionRunSessionSnapshot;
    }
  | {
      readonly kind: 'recentRun';
      readonly id: string;
      readonly session: CollectionRunSessionSnapshot;
    };

/**
 * Activity Bar Execution tree: Running + Recent (day-grouped) sessions.
 */
export class ExecutionTreeDataProvider
  implements TreeDataProvider<ExecutionTreeNode>, Disposable
{
  private readonly changeEmitter = new EventEmitter<
    ExecutionTreeNode | undefined | null | void
  >();

  public readonly onDidChangeTreeData: Event<
    ExecutionTreeNode | undefined | null | void
  > = this.changeEmitter.event;

  private active: readonly CollectionRunSessionSnapshot[] = [];
  private recent: readonly CollectionRunSessionSnapshot[] = [];

  public setSessions(
    active: readonly CollectionRunSessionSnapshot[],
    recent: readonly CollectionRunSessionSnapshot[],
  ): void {
    this.active = active;
    this.recent = recent;
    this.changeEmitter.fire(undefined);
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }

  public getTreeItem(element: ExecutionTreeNode): TreeItem {
    if (element.kind === 'section') {
      const item = new TreeItem(
        element.label,
        TreeItemCollapsibleState.Expanded,
      );
      item.id = `section:${element.id}`;
      item.contextValue = 'executionSection';
      item.iconPath =
        element.id === 'running'
          ? new ThemeIcon('debug-start')
          : new ThemeIcon('history');
      return item;
    }

    if (element.kind === 'dayGroup') {
      const item = new TreeItem(
        element.label,
        TreeItemCollapsibleState.Expanded,
      );
      item.id = element.id;
      item.contextValue = 'executionDayGroup';
      const count = element.sessions.length;
      item.description = count === 1 ? '1 run' : `${count} runs`;
      item.iconPath = new ThemeIcon('calendar');
      return item;
    }

    if (element.kind === 'activeRun') {
      return treeItemForActive(element.session);
    }

    return treeItemForRecent(element.session);
  }

  public getChildren(element?: ExecutionTreeNode): ExecutionTreeNode[] {
    if (element === undefined) {
      return [
        {
          kind: 'section',
          id: 'running',
          label:
            this.active.length === 0
              ? 'Running'
              : `Running (${this.active.length})`,
        },
        {
          kind: 'section',
          id: 'recent',
          label: 'Recent',
        },
      ];
    }

    if (element.kind === 'section' && element.id === 'running') {
      return this.active.map((session) => ({
        kind: 'activeRun' as const,
        id: `active:${session.runId}`,
        session,
      }));
    }

    if (element.kind === 'section' && element.id === 'recent') {
      return groupRecentByDay(this.recent).map((group) => ({
        kind: 'dayGroup' as const,
        id: `day:${group.id}`,
        groupId: group.id,
        label: group.label,
        sessions: group.sessions,
      }));
    }

    if (element.kind === 'dayGroup') {
      return element.sessions.map((session) => ({
        kind: 'recentRun' as const,
        id: `recent:${session.runId}`,
        session,
      }));
    }

    return [];
  }
}

function treeItemForActive(session: CollectionRunSessionSnapshot): TreeItem {
  const item = new TreeItem(
    session.collectionName,
    TreeItemCollapsibleState.None,
  );
  item.id = `active:${session.runId}`;
  item.contextValue = 'executionActiveRun';
  item.iconPath = new ThemeIcon('sync~spin');
  const current =
    session.current?.label !== undefined && session.current.label.length > 0
      ? session.current.label
      : 'Starting...';
  const displayed =
    session.lastProgress?.phase === 'request-started'
      ? Math.min(session.completed + 1, session.total)
      : session.completed;
  const policy =
    POLICY_LABELS[session.failurePolicy] ?? session.failurePolicy;
  const attemptLabel = formatAttemptLabel(session.lastProgress?.attempt);
  const currentWithAttempt =
    attemptLabel === undefined ? current : `${current} (${attemptLabel})`;
  item.description = `${displayed} / ${session.total} - ${currentWithAttempt}`;
  item.tooltip = [
    session.collectionName,
    `Progress: ${displayed} / ${session.total}`,
    `Current: ${current}`,
    ...(attemptLabel === undefined ? [] : [`Attempt: ${attemptLabel}`]),
    `Elapsed: ${formatDuration(session.elapsedMs)}`,
    `Policy: ${policy}`,
    `Run ID: ${session.runId}`,
  ].join('\n');
  item.accessibilityInformation = {
    label: `${session.collectionName}, running, ${displayed} of ${session.total} requests, current ${currentWithAttempt}, elapsed ${formatDuration(session.elapsedMs)}, ${policy}`,
  };
  item.command = {
    command: COMMAND_IDS.openLiveRunReport,
    title: 'Open Live Run Report',
    arguments: [session.runId],
  };
  return item;
}

function treeItemForRecent(session: CollectionRunSessionSnapshot): TreeItem {
  const item = new TreeItem(
    session.collectionName,
    TreeItemCollapsibleState.None,
  );
  item.id = `recent:${session.runId}`;
  item.contextValue = 'executionRecentRun';
  item.iconPath = iconForSession(session);
  item.description = describeRecent(session);
  item.tooltip = [
    session.collectionName,
    `Status: ${session.status}`,
    describeRecent(session),
    `Run ID: ${session.runId}`,
  ].join('\n');
  item.accessibilityInformation = {
    label: `${session.collectionName}, ${session.status}, ${describeRecent(session)}`,
  };
  item.command = {
    command: COMMAND_IDS.openRecentRunReport,
    title: 'Open Run Report',
    arguments: [session.runId],
  };
  return item;
}

function describeRecent(session: CollectionRunSessionSnapshot): string {
  const stats = session.summary?.statistics;
  if (stats !== undefined) {
    return `${stats.passed} passed, ${stats.failed} failed - ${formatDuration(stats.durationMs)}`;
  }
  if (session.errorMessage !== undefined && session.errorMessage.length > 0) {
    return session.errorMessage;
  }
  return `${session.status} - ${formatDuration(session.elapsedMs)}`;
}

function iconForSession(session: CollectionRunSessionSnapshot): ThemeIcon {
  switch (session.status) {
    case RunSessionStatus.Completed:
      return new ThemeIcon('pass', new ThemeColor('testing.iconPassed'));
    case RunSessionStatus.Cancelled:
      return new ThemeIcon(
        'circle-slash',
        new ThemeColor('disabledForeground'),
      );
    case RunSessionStatus.Stopped:
      return new ThemeIcon(
        'debug-stop',
        new ThemeColor('testing.iconFailed'),
      );
    case RunSessionStatus.Failed:
    default:
      return new ThemeIcon('error', new ThemeColor('testing.iconFailed'));
  }
}

interface DayGroup {
  readonly id: TimeGroupId;
  readonly label: string;
  readonly sessions: readonly CollectionRunSessionSnapshot[];
}

function groupRecentByDay(
  sessions: readonly CollectionRunSessionSnapshot[],
  now: Date = new Date(),
): readonly DayGroup[] {
  const buckets: Record<TimeGroupId, CollectionRunSessionSnapshot[]> = {
    [TimeGroupId.Today]: [],
    [TimeGroupId.Yesterday]: [],
    [TimeGroupId.Last7Days]: [],
    [TimeGroupId.Older]: [],
  };

  for (const session of sessions) {
    const stamp = session.completedAt ?? session.startedAt;
    buckets[classifyTimeGroup(stamp, now)].push(session);
  }

  const order: readonly TimeGroupId[] = [
    TimeGroupId.Today,
    TimeGroupId.Yesterday,
    TimeGroupId.Last7Days,
    TimeGroupId.Older,
  ];

  return order
    .filter((id) => buckets[id].length > 0)
    .map((id) => ({
      id,
      label: TIME_GROUP_LABELS[id],
      sessions: buckets[id],
    }));
}

function classifyTimeGroup(timestamp: string, now: Date): TimeGroupId {
  const instant = Date.parse(timestamp);
  if (!Number.isFinite(instant)) {
    return TimeGroupId.Older;
  }
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfLast7 = new Date(startOfToday);
  startOfLast7.setDate(startOfLast7.getDate() - 6);

  if (instant >= startOfToday.getTime()) {
    return TimeGroupId.Today;
  }
  if (instant >= startOfYesterday.getTime()) {
    return TimeGroupId.Yesterday;
  }
  if (instant >= startOfLast7.getTime()) {
    return TimeGroupId.Last7Days;
  }
  return TimeGroupId.Older;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '-';
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}
