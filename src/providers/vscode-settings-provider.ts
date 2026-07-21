import { workspace } from 'vscode';

import type {
  Disposable,
  ExtensionSettings,
  LogLevel,
  SettingsProvider,
} from '../configuration';
import {
  CONFIGURATION_KEYS,
  CONFIGURATION_SECTION,
  DEFAULT_CONFIGURATION,
  normalizeHistoryMaxEntries,
  normalizeMaxResponseBytes,
} from '../constants';

/** Reads centralized extension settings from VS Code configuration. */
export class VsCodeSettingsProvider implements SettingsProvider {
  /** Gets a typed snapshot of the current extension settings. */
  public getSettings(): ExtensionSettings {
    const configuration = workspace.getConfiguration(CONFIGURATION_SECTION);

    return {
      logLevel: configuration.get<LogLevel>(
        CONFIGURATION_KEYS.logLevel,
        DEFAULT_CONFIGURATION.logLevel,
      ),
      requestTimeout: configuration.get<number>(
        CONFIGURATION_KEYS.requestTimeout,
        DEFAULT_CONFIGURATION.requestTimeout,
      ),
      maxResponseBytes: normalizeMaxResponseBytes(
        configuration.get(
          CONFIGURATION_KEYS.maxResponseBytes,
          DEFAULT_CONFIGURATION.maxResponseBytes,
        ),
      ),
      historyMaxEntries: normalizeHistoryMaxEntries(
        configuration.get(
          CONFIGURATION_KEYS.historyMaxEntries,
          DEFAULT_CONFIGURATION.historyMaxEntries,
        ),
      ),
      languageFeatures: {
        hover: configuration.get<boolean>(
          CONFIGURATION_KEYS.languageFeatures.hover,
          DEFAULT_CONFIGURATION.languageFeatures.hover,
        ),
        outline: configuration.get<boolean>(
          CONFIGURATION_KEYS.languageFeatures.outline,
          DEFAULT_CONFIGURATION.languageFeatures.outline,
        ),
        diagnostics: configuration.get<boolean>(
          CONFIGURATION_KEYS.languageFeatures.diagnostics,
          DEFAULT_CONFIGURATION.languageFeatures.diagnostics,
        ),
      },
    };
  }

  /** Notifies a listener when API Hero configuration changes. */
  public onDidChange(
    listener: (settings: ExtensionSettings) => void,
  ): Disposable {
    return workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIGURATION_SECTION)) {
        listener(this.getSettings());
      }
    });
  }
}
