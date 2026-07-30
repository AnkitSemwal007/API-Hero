import {
  EventEmitter,
  ThemeIcon,
  type Event,
  type TreeDataProvider,
  type TreeItem,
  TreeItemCollapsibleState,
  type Disposable,
} from 'vscode';

import { COMMAND_IDS } from '../../constants';
import {
  formatLastRunDetail,
  type ScenarioLastRunRecord,
  type ScenarioLastRunStatus,
} from './scenario-last-runs';

export interface ScenarioTreeNode {
  readonly kind: 'scenario';
  readonly id: string;
  readonly name: string;
  readonly filePath: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly lastRunStatus?: ScenarioLastRunStatus;
  readonly lastRunAt?: string;
}

/**
 * Flat Scenario Explorer tree listing `.scenario.json` sidecars.
 */
export class ScenarioTreeDataProvider
  implements TreeDataProvider<ScenarioTreeNode>, Disposable
{
  private readonly onDidChangeTreeDataEmitter = new EventEmitter<
    ScenarioTreeNode | undefined | null | void
  >();
  public readonly onDidChangeTreeData: Event<
    ScenarioTreeNode | undefined | null | void
  > = this.onDidChangeTreeDataEmitter.event;

  private nodes: readonly ScenarioTreeNode[] = [];

  public setScenarios(nodes: readonly ScenarioTreeNode[]): void {
    this.nodes = [...nodes].sort((a, b) => a.name.localeCompare(b.name));
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getTreeItem(element: ScenarioTreeNode): TreeItem {
    const lastRun: ScenarioLastRunRecord | undefined =
      element.lastRunStatus !== undefined && element.lastRunAt !== undefined
        ? { status: element.lastRunStatus, at: element.lastRunAt }
        : undefined;
    const detail = formatLastRunDetail(lastRun);
    const tooltipLines = [
      element.name,
      element.description,
      element.tags !== undefined && element.tags.length > 0
        ? `Tags: ${element.tags.join(', ')}`
        : undefined,
      detail,
      element.filePath,
    ].filter((line): line is string => typeof line === 'string' && line.length > 0);

    return {
      id: element.id,
      label: element.name,
      description: detail,
      tooltip: tooltipLines.join('\n'),
      collapsibleState: TreeItemCollapsibleState.None,
      contextValue: 'scenario',
      iconPath: iconForStatus(element.lastRunStatus),
      command: {
        command: COMMAND_IDS.openScenarioEditor,
        title: 'Open Scenario Editor',
        arguments: [element],
      },
    };
  }

  public getChildren(element?: ScenarioTreeNode): ScenarioTreeNode[] {
    if (element !== undefined) return [];
    return [...this.nodes];
  }

  public dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }
}

function iconForStatus(
  status: ScenarioLastRunStatus | undefined,
): ThemeIcon {
  switch (status) {
    case 'completed':
      return new ThemeIcon('pass');
    case 'failed':
      return new ThemeIcon('error');
    case 'cancelled':
      return new ThemeIcon('circle-slash');
    default:
      return new ThemeIcon('debug-breakpoint-log');
  }
}
