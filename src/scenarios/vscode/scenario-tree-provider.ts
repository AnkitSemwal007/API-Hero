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

export interface ScenarioTreeNode {
  readonly kind: 'scenario';
  readonly id: string;
  readonly name: string;
  readonly filePath: string;
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
    return {
      id: element.id,
      label: element.name,
      description: element.filePath,
      collapsibleState: TreeItemCollapsibleState.None,
      contextValue: 'scenario',
      iconPath: new ThemeIcon('debug-breakpoint-log'),
      command: {
        command: COMMAND_IDS.openScenarioEditor,
        title: 'Open Scenario',
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
