/** Stable command identifiers contributed by API Hero. */
export const COMMAND_IDS = {
  runRequest: 'apiHero.runRequest',
  runRequestWithAssertions: 'apiHero.runRequestWithAssertions',
  copyAsCurl: 'apiHero.copyAsCurl',
  importCurl: 'apiHero.importCurl',
  runFile: 'apiHero.runFile',
  login: 'apiHero.login',
  logout: 'apiHero.logout',
  switchEnvironment: 'apiHero.switchEnvironment',
  manageEnvironments: 'apiHero.manageEnvironments',
  manageAuthProfiles: 'apiHero.manageAuthProfiles',
  selectAuthentication: 'apiHero.selectAuthentication',
  initializeProjectStore: 'apiHero.initializeProjectStore',
  resetWorkspace: 'apiHero.resetWorkspace',
  refreshCollections: 'apiHero.refreshCollections',

  filterCollections: 'apiHero.filterCollections',
  revealActiveRequest: 'apiHero.revealActiveRequest',
  openCollectionRequest: 'apiHero.openCollectionRequest',
  focusCollections: 'apiHero.focusCollections',
  runCollection: 'apiHero.runCollection',
  runCollectionTests: 'apiHero.runCollectionTests',
  runFolder: 'apiHero.runFolder',
  runSelectedRequests: 'apiHero.runSelectedRequests',
  focusHistory: 'apiHero.focusHistory',
  focusExecution: 'apiHero.focusExecution',
  cancelCollectionRun: 'apiHero.cancelCollectionRun',
  openLiveRunReport: 'apiHero.openLiveRunReport',
  openRecentRunReport: 'apiHero.openRecentRunReport',
  revealExecutionCollection: 'apiHero.revealExecutionCollection',
  copyCollectionRunId: 'apiHero.copyCollectionRunId',
  openHistoryEntry: 'apiHero.openHistoryEntry',
  rerunHistoryEntry: 'apiHero.rerunHistoryEntry',
  deleteHistoryEntry: 'apiHero.deleteHistoryEntry',
  clearHistory: 'apiHero.clearHistory',
  searchHistory: 'apiHero.searchHistory',
  refreshHistory: 'apiHero.refreshHistory',
  revealHistoryRequest: 'apiHero.revealHistoryRequest',
  copyHistorySummary: 'apiHero.copyHistorySummary',
  importOpenApi: 'apiHero.importOpenApi',
  importPostman: 'apiHero.importPostman',
  importInsomnia: 'apiHero.importInsomnia',
  createCollection: 'apiHero.createCollection',
  renameCollection: 'apiHero.renameCollection',
  deleteCollection: 'apiHero.deleteCollection',
  duplicateCollection: 'apiHero.duplicateCollection',
  exportCollection: 'apiHero.exportCollection',
  importCollection: 'apiHero.importCollection',
  createFolder: 'apiHero.createFolder',
  renameFolder: 'apiHero.renameFolder',
  deleteFolder: 'apiHero.deleteFolder',
  duplicateFolder: 'apiHero.duplicateFolder',
  createRequest: 'apiHero.createRequest',
  renameRequest: 'apiHero.renameRequest',
  duplicateRequest: 'apiHero.duplicateRequest',
  deleteRequest: 'apiHero.deleteRequest',
  moveRequest: 'apiHero.moveRequest',
  openWorkspace: 'apiHero.openWorkspace',
  openRequestEditor: 'apiHero.openRequestEditor',
  openOverview: 'apiHero.openOverview',
  openSettings: 'apiHero.openSettings',
  /** Stable IA alias: focuses History (same as focusHistory), not a separate view. */
  recentRequests: 'apiHero.recentRequests',
  refreshScenarios: 'apiHero.refreshScenarios',
  openScenarioEditor: 'apiHero.openScenarioEditor',
  runScenario: 'apiHero.runScenario',
  createScenario: 'apiHero.createScenario',
  focusScenarios: 'apiHero.focusScenarios',
  /**
   * Internal command (not contributed in package.json) used by auth missing-secret
   * code actions to prompt and store a secret field.
   */
  setAuthSecret: 'apiHero.setAuthSecret',
  testAuthentication: 'apiHero.testAuthentication',
  saveAsAuthentication: 'apiHero.saveAsAuthentication',
  useResponseAsAuthentication: 'apiHero.useResponseAsAuthentication',
  runAuthenticationLogin: 'apiHero.runAuthenticationLogin',
  setCollectionDefaultAuthentication: 'apiHero.setCollectionDefaultAuthentication',
  compareWithPreviousRun: 'apiHero.compareWithPreviousRun',
  compareCollectionRuns: 'apiHero.compareCollectionRuns',
  generateTypeScript: 'apiHero.generateTypeScript',
} as const;

/** A command identifier contributed by API Hero. */
export type CommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];

/**
 * Legacy `apiRunner.*` aliases for every {@link COMMAND_IDS} entry so existing
 * user keybindings and scripts keep working after the namespace migration.
 */
export const LEGACY_COMMAND_IDS = {
  runRequest: 'apiRunner.runRequest',
  runRequestWithAssertions: 'apiRunner.runRequestWithAssertions',
  copyAsCurl: 'apiRunner.copyAsCurl',
  importCurl: 'apiRunner.importCurl',
  runFile: 'apiRunner.runFile',
  login: 'apiRunner.login',
  logout: 'apiRunner.logout',
  switchEnvironment: 'apiRunner.switchEnvironment',
  manageEnvironments: 'apiRunner.manageEnvironments',
  manageAuthProfiles: 'apiRunner.manageAuthProfiles',
  selectAuthentication: 'apiRunner.selectAuthentication',
  initializeProjectStore: 'apiRunner.initializeProjectStore',
  resetWorkspace: 'apiRunner.resetWorkspace',
  refreshCollections: 'apiRunner.refreshCollections',

  filterCollections: 'apiRunner.filterCollections',
  revealActiveRequest: 'apiRunner.revealActiveRequest',
  openCollectionRequest: 'apiRunner.openCollectionRequest',
  focusCollections: 'apiRunner.focusCollections',
  runCollection: 'apiRunner.runCollection',
  runCollectionTests: 'apiRunner.runCollectionTests',
  runFolder: 'apiRunner.runFolder',
  runSelectedRequests: 'apiRunner.runSelectedRequests',
  focusHistory: 'apiRunner.focusHistory',
  focusExecution: 'apiRunner.focusExecution',
  cancelCollectionRun: 'apiRunner.cancelCollectionRun',
  openLiveRunReport: 'apiRunner.openLiveRunReport',
  openRecentRunReport: 'apiRunner.openRecentRunReport',
  revealExecutionCollection: 'apiRunner.revealExecutionCollection',
  copyCollectionRunId: 'apiRunner.copyCollectionRunId',
  openHistoryEntry: 'apiRunner.openHistoryEntry',
  rerunHistoryEntry: 'apiRunner.rerunHistoryEntry',
  deleteHistoryEntry: 'apiRunner.deleteHistoryEntry',
  clearHistory: 'apiRunner.clearHistory',
  searchHistory: 'apiRunner.searchHistory',
  refreshHistory: 'apiRunner.refreshHistory',
  revealHistoryRequest: 'apiRunner.revealHistoryRequest',
  copyHistorySummary: 'apiRunner.copyHistorySummary',
  importOpenApi: 'apiRunner.importOpenApi',
  importPostman: 'apiRunner.importPostman',
  importInsomnia: 'apiRunner.importInsomnia',
  createCollection: 'apiRunner.createCollection',
  renameCollection: 'apiRunner.renameCollection',
  deleteCollection: 'apiRunner.deleteCollection',
  duplicateCollection: 'apiRunner.duplicateCollection',
  exportCollection: 'apiRunner.exportCollection',
  importCollection: 'apiRunner.importCollection',
  createFolder: 'apiRunner.createFolder',
  renameFolder: 'apiRunner.renameFolder',
  deleteFolder: 'apiRunner.deleteFolder',
  duplicateFolder: 'apiRunner.duplicateFolder',
  createRequest: 'apiRunner.createRequest',
  renameRequest: 'apiRunner.renameRequest',
  duplicateRequest: 'apiRunner.duplicateRequest',
  deleteRequest: 'apiRunner.deleteRequest',
  moveRequest: 'apiRunner.moveRequest',
  openWorkspace: 'apiRunner.openWorkspace',
  openRequestEditor: 'apiRunner.openRequestEditor',
  openOverview: 'apiRunner.openOverview',
  openSettings: 'apiRunner.openSettings',
  recentRequests: 'apiRunner.recentRequests',
  refreshScenarios: 'apiRunner.refreshScenarios',
  openScenarioEditor: 'apiRunner.openScenarioEditor',
  runScenario: 'apiRunner.runScenario',
  createScenario: 'apiRunner.createScenario',
  focusScenarios: 'apiRunner.focusScenarios',
  setAuthSecret: 'apiRunner.setAuthSecret',
  testAuthentication: 'apiRunner.testAuthentication',
  saveAsAuthentication: 'apiRunner.saveAsAuthentication',
  useResponseAsAuthentication: 'apiRunner.useResponseAsAuthentication',
  runAuthenticationLogin: 'apiRunner.runAuthenticationLogin',
  setCollectionDefaultAuthentication: 'apiRunner.setCollectionDefaultAuthentication',
  compareWithPreviousRun: 'apiRunner.compareWithPreviousRun',
  compareCollectionRuns: 'apiRunner.compareCollectionRuns',
  generateTypeScript: 'apiRunner.generateTypeScript',
} as const;

/** A legacy `apiRunner.*` command alias. */
export type LegacyCommandId =
  (typeof LEGACY_COMMAND_IDS)[keyof typeof LEGACY_COMMAND_IDS];

const CANONICAL_COMMAND_PREFIX = 'apiHero.';
const LEGACY_COMMAND_PREFIX = 'apiRunner.';

/**
 * Maps a canonical `apiHero.*` command id to its `apiRunner.*` alias, or
 * `undefined` when the id is not under the canonical namespace.
 */
export function toLegacyCommandId(canonicalId: string): string | undefined {
  if (!canonicalId.startsWith(CANONICAL_COMMAND_PREFIX)) {
    return undefined;
  }
  return `${LEGACY_COMMAND_PREFIX}${canonicalId.slice(CANONICAL_COMMAND_PREFIX.length)}`;
}
