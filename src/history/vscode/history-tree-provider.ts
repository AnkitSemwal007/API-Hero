import {
  EventEmitter,
  ThemeColor,
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
  type HistoryFilter,
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
  private filter: HistoryFilter = {};

  public setEntries(entries: readonly HistoryEntry[]): void {
    this.entries = entries;
    this.changeEmitter.fire(undefined);
  }

  /** Applies status / method / query facets from {@link filterHistoryEntries}. */
  public setFilter(filter: HistoryFilter): void {
    this.filter = normalizeFilter(filter);
    this.changeEmitter.fire(undefined);
  }

  public getFilter(): HistoryFilter {
    return this.filter;
  }

  /** @deprecated Prefer {@link setFilter}; retained for free-text-only callers. */
  public setFilterQuery(query: string | undefined): void {
    this.setFilter({
      ...this.filter,
      ...(query === undefined || query.trim().length === 0
        ? { query: undefined }
        : { query: query.trim() }),
    });
  }

  public getFilterQuery(): string | undefined {
    return this.filter.query;
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
    const method = entry.summary.method.trim().toUpperCase() || 'HTTP';
    const name = entry.metadata.requestName?.trim();
    const label =
      name !== undefined && name.length > 0
        ? `${method}  ${name}`
        : `${method}  ${shortUrl(entry.summary.url)}`;
    const item = new TreeItem(label, TreeItemCollapsibleState.None);
    item.id = element.id;
    item.contextValue = 'historyEntry';
    item.description = describeEntry(entry);
    item.tooltip = buildTooltip(entry);
    item.iconPath = iconForEntry(entry);
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
    return filterHistoryEntries(this.entries, this.filter);
  }
}

/** Human-readable active filter for TreeView.message / status. */
export function describeHistoryFilter(filter: HistoryFilter): string | undefined {
  const parts: string[] = [];
  if (filter.status !== undefined) {
    const statuses = Array.isArray(filter.status)
      ? filter.status
      : [filter.status];
    if (statuses.length > 0) {
      parts.push(`status: ${statuses.join(', ')}`);
    }
  }
  if (filter.method !== undefined && filter.method.trim().length > 0) {
    parts.push(`method: ${filter.method.trim().toUpperCase()}`);
  }
  if (filter.query !== undefined && filter.query.trim().length > 0) {
    parts.push(`text: ${filter.query.trim()}`);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return `Filtered · ${parts.join(' · ')}`;
}

function normalizeFilter(filter: HistoryFilter): HistoryFilter {
  const status = filter.status;
  const method =
    filter.method === undefined || filter.method.trim().length === 0
      ? undefined
      : filter.method.trim().toUpperCase();
  const query =
    filter.query === undefined || filter.query.trim().length === 0
      ? undefined
      : filter.query.trim();
  return {
    ...(status === undefined ? {} : { status }),
    ...(method === undefined ? {} : { method }),
    ...(query === undefined ? {} : { query }),
  };
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

/**
 * Status ThemeIcon with theme colors; method is always in the TreeItem label.
 */
function iconForEntry(entry: HistoryEntry): ThemeIcon {
  switch (entry.summary.status) {
    case 'success':
      return new ThemeIcon(
        'pass',
        new ThemeColor('testing.iconPassed'),
      );
    case 'cancelled':
      return new ThemeIcon(
        'circle-slash',
        new ThemeColor('disabledForeground'),
      );
    case 'failure':
    default:
      return new ThemeIcon(
        'error',
        new ThemeColor('testing.iconFailed'),
      );
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
