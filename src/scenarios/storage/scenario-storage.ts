import type { Scenario } from '../models';
import { serializeScenario } from '../serialization/scenario-serializer';
import { parseScenarioDocument } from '../schema';

import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';

/** Sidecar directory for scenario documents (plan MVP path). */
export const SCENARIOS_DIRECTORY_NAME = '.api-hero/scenarios';

export type ScenarioLoadResult =
  | { readonly ok: true; readonly scenario: Scenario }
  | { readonly ok: false; readonly error: ScenarioStorageError };

export type ScenarioSaveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ScenarioStorageError };

export type ScenarioDiscoverResult =
  | { readonly ok: true; readonly scenarios: readonly Scenario[]; readonly files: readonly string[] }
  | {
      readonly ok: false;
      readonly error: ScenarioStorageError;
      readonly files: readonly string[];
    };

export interface ScenarioStorageError {
  readonly code:
    | 'FILE_NOT_FOUND'
    | 'READ_FAILED'
    | 'PARSE_FAILED'
    | 'INVALID_SCHEMA_VERSION'
    | 'INVALID_DOCUMENT'
    | 'WRITE_FAILED';
  readonly filePath: string;
  readonly message: string;
  readonly cause?: unknown;
}

export interface ScenarioStorageOptions {
  readonly now?: () => number;
}

function error(
  filePath: string,
  code: ScenarioStorageError['code'],
  message: string,
  cause?: unknown,
): ScenarioStorageError {
  return { filePath, code, message, cause };
}

/** Resolves the workspace-relative scenarios sidecar root. */
export function scenariosRootPath(workspaceFolderPath: string): string {
  return path.join(workspaceFolderPath, ...SCENARIOS_DIRECTORY_NAME.split('/'));
}

async function discoverScenarioFiles(rootPath: string): Promise<readonly string[]> {
  const out: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.scenario.json')) {
        out.push(full);
      }
    }
  }

  await visit(rootPath);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export class ScenarioStorageService {
  public constructor(private readonly options: ScenarioStorageOptions = {}) {}

  public async load(filePath: string): Promise<ScenarioLoadResult> {
    let bytes: string;
    try {
      bytes = await fs.readFile(filePath, 'utf8');
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Unable to read file.';
      const code: ScenarioStorageError['code'] =
        cause instanceof Error && (cause as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'FILE_NOT_FOUND'
          : 'READ_FAILED';
      return { ok: false, error: error(filePath, code, message, cause) };
    }

    const parsed = parseScenarioDocument(bytes);
    if (!parsed.ok) {
      const message = parsed.errors.join(' ');
      const code: ScenarioStorageError['code'] = message.includes('schemaVersion')
        ? 'INVALID_SCHEMA_VERSION'
        : message.includes('failed to parse')
          ? 'PARSE_FAILED'
          : 'INVALID_DOCUMENT';
      return { ok: false, error: error(filePath, code, message) };
    }

    return { ok: true, scenario: parsed.scenario };
  }

  public async save(scenario: Scenario, filePath: string): Promise<ScenarioSaveResult> {
    void this.options;
    const content = serializeScenario(scenario);
    const dir = path.dirname(filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
      return { ok: true };
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Unable to write file.';
      return {
        ok: false,
        error: error(filePath, 'WRITE_FAILED', message, cause),
      };
    }
  }

  public async discover(rootPath: string): Promise<ScenarioDiscoverResult> {
    let files: readonly string[];
    try {
      files = await discoverScenarioFiles(rootPath);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Unable to discover scenario files.';
      return {
        ok: false,
        files: [],
        error: error(rootPath, 'READ_FAILED', message, cause),
      };
    }

    const scenarios: Scenario[] = [];
    for (const file of files) {
      const loaded = await this.load(file);
      if (loaded.ok) {
        scenarios.push(loaded.scenario);
      }
    }
    return { ok: true, scenarios, files };
  }
}
