import {
  EventEmitter,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  type Event,
  type TreeDataProvider,
} from 'vscode';

import { COMMAND_IDS } from '../../constants';
import {
  filterHistoryEntries,
  groupHistoryEntries,
  type HistoryEntry,
  type HistoryGroup,
  type HistoryTimeGroup,
} from '../index';

export type HistoryTreeNode =
  | {
      readonly kind: 'group';
      readonly id: string;
      readonly groupId: HistoryTimeGroup;
      readonly label: string;
      readonly entries: readonly HistoryEntry[];
    }
  | {
      readonly kind: 'entry';
      readonly id: string;
      readonly entry: HistoryEntry;
    };

/**
 * Activity Bar History tree: time groups → individual entries.
 * Holds only the lightweight summaries already loaded by the service.
 */
export class HistoryTreeDataProvider
  implements TreeDataProvider<HistoryTreeNode>
{
  private readonly changeEmitter = new EventEmitter<
    HistoryTreeNode | undefined | null | void
  >();

  public readonly onDidChangeTreeData: Event<
    HistoryTreeNode | undefined | null | void
  > = this.changeEmitter.event;

  private entries: readonly HistoryEntry[] = [];
  private filterQuery: string | undefined;

  public setEntries(entries: readonly HistoryEntry[]): void {
    this.entries = entries;
    this.changeEmitter.fire(undefined);
  }

  public setFilterQuery(query: string | undefined): void {
    this.filterQuery =
      query === undefined || query.trim().length === 0
        ? undefined
        : query.trim();
    this.changeEmitter.fire(undefined);
  }

  public getFilterQuery(): string | undefined {
    return this.filterQuery;
  }

  public getTreeItem(element: HistoryTreeNode): TreeItem {
    if (element.kind === 'group') {
      const item = new TreeItem(
        element.label,
        TreeItemCollapsibleState.Expanded,
      );
      item.id = element.id;
      item.contextValue = 'historyGroup';
      item.description = `${element.entries.length}`;
      item.iconPath = new ThemeIcon('history');
      return item;
    }

    const { entry } = element;
    const label = entry.metadata.requestName?.trim().length
      ? entry.metadata.requestName
      : `${entry.summary.method} ${shortUrl(entry.summary.url)}`;
    const item = new TreeItem(label, TreeItemCollapsibleState.None);
    item.id = element.id;
    item.contextValue = 'historyEntry';
    item.description = describeEntry(entry);
    item.tooltip = buildTooltip(entry);
    item.iconPath = iconForStatus(entry.summary.status);
    item.command = {
      command: COMMAND_IDS.openHistoryEntry,
      title: 'Open History Entry',
      arguments: [entry.id],
    };
    return item;
  }

  public getChildren(element?: HistoryTreeNode): HistoryTreeNode[] {
    const visible = this.visibleEntries();
    if (element === undefined) {
      return groupHistoryEntries(visible).map((group) => groupNode(group));
    }
    if (element.kind === 'group') {
      return element.entries.map((entry) => entryNode(entry));
    }
    return [];
  }

  private visibleEntries(): readonly HistoryEntry[] {
    if (this.filterQuery === undefined) {
      return this.entries;
    }
    return filterHistoryEntries(this.entries, { query: this.filterQuery });
  }
}

function groupNode(group: HistoryGroup): HistoryTreeNode {
  return {
    kind: 'group',
    id: `group:${group.id}`,
    groupId: group.id,
    label: group.label,
    entries: group.entries,
  };
}

function entryNode(entry: HistoryEntry): HistoryTreeNode {
  return {
    kind: 'entry',
    id: `entry:${entry.id}`,
    entry,
  };
}

function describeEntry(entry: HistoryEntry): string {
  const status =
    entry.summary.statusCode !== undefined
      ? String(entry.summary.statusCode)
      : entry.summary.status;
  return `${status} · ${formatDuration(entry.summary.durationMs)} · ${formatTime(
    entry.summary.timestamp,
  )}`;
}

function buildTooltip(entry: HistoryEntry): string {
  const lines = [
    `${entry.summary.method} ${entry.summary.url}`,
    `Status: ${entry.summary.status}`,
  ];
  if (entry.summary.statusCode !== undefined) {
    lines.push(
      `HTTP: ${entry.summary.statusCode} ${entry.summary.statusText ?? ''}`.trim(),
    );
  }
  lines.push(`Duration: ${formatDuration(entry.summary.durationMs)}`);
  lines.push(`When: ${entry.summary.timestamp}`);
  if (entry.metadata.environmentName !== undefined) {
    lines.push(`Environment: ${entry.metadata.environmentName}`);
  }
  if (entry.metadata.collectionName !== undefined) {
    lines.push(`Collection: ${entry.metadata.collectionName}`);
  }
  if (entry.metadata.errorCode !== undefined) {
    lines.push(`Error: ${entry.metadata.errorCode}`);
  }
  return lines.join('\n');
}

function iconForStatus(status: HistoryEntry['summary']['status']): ThemeIcon {
  switch (status) {
    case 'success':
      return new ThemeIcon('pass');
    case 'cancelled':
      return new ThemeIcon('circle-slash');
    case 'failure':
    default:
      return new ThemeIcon('error');
  }
}

function shortUrl(url: string): string {
  return url.length > 64 ? `${url.slice(0, 61)}…` : url;
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '—';
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function formatTime(timestamp: string): string {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) {
    return timestamp;
  }
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
