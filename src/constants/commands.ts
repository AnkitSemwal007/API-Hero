/** Stable command identifiers contributed by API Runner. */
export const COMMAND_IDS = {
  runRequest: 'apiRunner.runRequest',
  runRequestWithAssertions: 'apiRunner.runRequestWithAssertions',
  runFile: 'apiRunner.runFile',
  login: 'apiRunner.login',
  logout: 'apiRunner.logout',
  switchEnvironment: 'apiRunner.switchEnvironment',
  selectAuthentication: 'apiRunner.selectAuthentication',
  refreshCollections: 'apiRunner.refreshCollections',
  revealActiveRequest: 'apiRunner.revealActiveRequest',
  openCollectionRequest: 'apiRunner.openCollectionRequest',
  focusCollections: 'apiRunner.focusCollections',
  runCollection: 'apiRunner.runCollection',
  runCollectionTests: 'apiRunner.runCollectionTests',
  runFolder: 'apiRunner.runFolder',
  runSelectedRequests: 'apiRunner.runSelectedRequests',
  focusHistory: 'apiRunner.focusHistory',
  openHistoryEntry: 'apiRunner.openHistoryEntry',
  rerunHistoryEntry: 'apiRunner.rerunHistoryEntry',
  deleteHistoryEntry: 'apiRunner.deleteHistoryEntry',
  clearHistory: 'apiRunner.clearHistory',
  searchHistory: 'apiRunner.searchHistory',
  refreshHistory: 'apiRunner.refreshHistory',
  revealHistoryRequest: 'apiRunner.revealHistoryRequest',
  importOpenApi: 'apiRunner.importOpenApi',
} as const;

/** A command identifier contributed by API Runner. */
export type CommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];
