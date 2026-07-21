/** Log severities accepted by API Hero configuration. */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/** Strongly typed extension settings consumed by core services. */
export interface ExtensionSettings {
  readonly logLevel: LogLevel;
  readonly requestTimeout: number;
  /** Maximum buffered response body size in bytes. `0` means unlimited. */
  readonly maxResponseBytes: number;
  /** Maximum retained request history entries (newest kept). */
  readonly historyMaxEntries: number;
  readonly languageFeatures: LanguageFeatureSettings;
}

/** Feature switches for API document language services. */
export interface LanguageFeatureSettings {
  readonly hover: boolean;
  readonly outline: boolean;
  readonly diagnostics: boolean;
}

/** Provides typed settings without exposing a configuration framework. */
export interface SettingsProvider {
  getSettings(): ExtensionSettings;
  onDidChange(listener: (settings: ExtensionSettings) => void): Disposable;
}

/** Framework-neutral handle for releasing a registered resource. */
export interface Disposable {
  dispose(): void;
}
