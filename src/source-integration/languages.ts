export const SOURCE_LANGUAGE_IDS: ReadonlySet<string> = new Set([
  'typescript',
  'javascript',
  'typescriptreact',
  'javascriptreact',
]);

const TYPESCRIPT_LANGUAGE_IDS: ReadonlySet<string> = new Set([
  'typescript',
  'typescriptreact',
]);

export function isSourceLanguageId(languageId: string): boolean {
  return SOURCE_LANGUAGE_IDS.has(languageId);
}

export function isTypeScriptLanguageId(languageId: string): boolean {
  return TYPESCRIPT_LANGUAGE_IDS.has(languageId);
}
