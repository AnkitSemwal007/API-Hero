import type { VariableDefinition, VariableScope } from '../models';
import { deepFreeze } from '../shared';
import { VARIABLE_SCOPE_UI } from './variable-scope-ui';
import {
  DefaultVariableResolver,
  MASKED_VARIABLE_VALUE,
  type VariableResolver,
} from './variable-resolver';

const REFERENCE = /\{\{(\$?[A-Za-z_][A-Za-z0-9_.-]*)\}\}/gu;
const NAME_CHARS = /^[A-Za-z0-9_.$-]*$/u;

/** Framework-neutral completion model for a single effective variable. */
export interface VariableCompletionItem {
  readonly name: string;
  readonly scope: VariableScope;
  readonly sourceLabel: string;
  readonly icon: string;
  readonly sensitive: boolean;
  readonly description?: string;
  /** Present only when the value is not sensitive. */
  readonly valuePreview?: string;
}

/** Cursor context inside a field/line that may contain `{{…}}`. */
export interface VariableCompletionContext {
  readonly isActive: boolean;
  readonly prefix: string;
  readonly replaceStart: number;
  readonly replaceEnd: number;
  readonly insertMode: 'wrap' | 'name-only';
}

/** Hover / documentation payload for a variable name. */
export interface VariableHoverInfo {
  readonly name: string;
  readonly scope: VariableScope;
  readonly sourceLabel: string;
  readonly sensitive: boolean;
  readonly valueDisplay: string;
  readonly documentation: string;
}

/**
 * Single source of truth for variable IntelliSense models.
 * Caches the effective completion list; filters in memory on query.
 */
export class VariableCompletionService {
  private readonly resolver: VariableResolver;
  private definitionsFingerprint = '';
  private cachedItems: readonly VariableCompletionItem[] = Object.freeze([]);
  private byName = new Map<string, VariableCompletionItem>();

  public constructor(resolver: VariableResolver = new DefaultVariableResolver()) {
    this.resolver = resolver;
  }

  /**
   * Rebuilds the cached completion catalog when definition content changes.
   * Safe to call on every snapshot push; no-ops when the fingerprint matches.
   */
  public setDefinitions(definitions: readonly VariableDefinition[]): void {
    const fingerprint = fingerprintDefinitions(definitions);
    if (fingerprint === this.definitionsFingerprint) {
      return;
    }
    this.definitionsFingerprint = fingerprint;
    const analysis = this.resolver.analyze({ definitions });
    const items: VariableCompletionItem[] = [...analysis.values.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((value) => {
        const ui = VARIABLE_SCOPE_UI[value.scope];
        const icon = value.sensitive ? `${ui.icon}🔒` : ui.icon;
        return deepFreeze({
          name: value.name,
          scope: value.scope,
          sourceLabel: ui.sourceLabel,
          icon,
          sensitive: value.sensitive,
          description: value.sensitive
            ? `${ui.sourceLabel} · sensitive`
            : `${ui.sourceLabel}`,
          ...(value.sensitive
            ? {}
            : { valuePreview: value.value }),
        });
      });
    this.cachedItems = Object.freeze(items);
    this.byName = new Map(items.map((item) => [item.name, item]));
  }

  /** Returns cached items filtered by fuzzy query (empty query → all). */
  public getCompletions(query: string): readonly VariableCompletionItem[] {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return this.cachedItems;
    }
    return Object.freeze(
      this.cachedItems.filter((item) => fuzzyMatches(trimmed, item.name)),
    );
  }

  /**
   * Detects an open `{{` region at the cursor.
   * A lone `{` is never active; `}}` closes the nearest open region.
   */
  public analyzeInput(text: string, cursor: number): VariableCompletionContext {
    const safeCursor = clamp(cursor, 0, text.length);
    const before = text.slice(0, safeCursor);
    const openIdx = before.lastIndexOf('{{');
    const closeIdx = before.lastIndexOf('}}');
    if (openIdx < 0 || openIdx < closeIdx) {
      return deepFreeze({
        isActive: false,
        prefix: '',
        replaceStart: safeCursor,
        replaceEnd: safeCursor,
        insertMode: 'wrap' as const,
      });
    }

    const afterOpen = before.slice(openIdx + 2);
    const prefix = takeNamePrefix(afterOpen);
    const replaceStart = openIdx + 2;
    const afterCursor = text.slice(safeCursor);
    const trailingName = takeNamePrefix(afterCursor);
    let replaceEnd = safeCursor + trailingName.length;
    const closeAfter = text.indexOf('}}', replaceStart);
    if (closeAfter >= 0 && closeAfter < replaceEnd) {
      replaceEnd = closeAfter;
    }
    if (replaceEnd < replaceStart + prefix.length) {
      replaceEnd = replaceStart + prefix.length;
    }

    return deepFreeze({
      isActive: true,
      prefix,
      replaceStart,
      replaceEnd,
      insertMode: 'name-only' as const,
    });
  }

  public buildInsertText(
    item: VariableCompletionItem,
    context: VariableCompletionContext,
  ): string {
    if (context.insertMode === 'wrap' || !context.isActive) {
      return `{{${item.name}}}`;
    }
    return item.name;
  }

  public getHoverInfo(name: string): VariableHoverInfo | undefined {
    const item = this.byName.get(name);
    if (item === undefined) {
      return undefined;
    }
    const valueDisplay = item.sensitive
      ? MASKED_VARIABLE_VALUE
      : (item.valuePreview ?? '');
    const documentation = [
      item.name,
      `Effective source: ${item.icon} ${item.sourceLabel}`,
      'Current Value',
      valueDisplay || '(empty)',
      'Sensitive',
      item.sensitive ? 'Yes' : 'No',
    ].join('\n\n');
    return deepFreeze({
      name: item.name,
      scope: item.scope,
      sourceLabel: item.sourceLabel,
      sensitive: item.sensitive,
      valueDisplay,
      documentation,
    });
  }

  /** Best fuzzy match for an unknown name, when one exists. */
  public suggestCorrection(unknownName: string): string | undefined {
    const query = unknownName.trim();
    if (query.length === 0 || this.byName.has(query)) {
      return undefined;
    }
    let best: { readonly name: string; readonly score: number } | undefined;
    for (const item of this.cachedItems) {
      const score = fuzzyScore(query, item.name);
      if (score === undefined) {
        continue;
      }
      if (
        best === undefined ||
        score > best.score ||
        (score === best.score && item.name.localeCompare(best.name) < 0)
      ) {
        best = { name: item.name, score };
      }
    }
    return best?.name;
  }

  /**
   * Resolves `{{refs}}` in text for UI preview. Sensitive values are masked.
   * Returns undefined when the text has no variable references.
   */
  public resolvePreview(
    text: string,
  ): { readonly resolved: string; readonly hasSensitive: boolean } | undefined {
    let matched = false;
    let hasSensitive = false;
    const resolved = text.replace(REFERENCE, (_match, name: string) => {
      matched = true;
      const item = this.byName.get(name);
      if (item === undefined) {
        return `{{${name}}}`;
      }
      if (item.sensitive) {
        hasSensitive = true;
        return MASKED_VARIABLE_VALUE;
      }
      return item.valuePreview ?? '';
    });
    if (!matched) {
      return undefined;
    }
    return deepFreeze({ resolved, hasSensitive });
  }

  /** Test/introspection helper — current cache size. */
  public getCachedCount(): number {
    return this.cachedItems.length;
  }
}

function fingerprintDefinitions(
  definitions: readonly VariableDefinition[],
): string {
  return definitions
    .map((definition) =>
      [
        definition.scope,
        definition.name,
        definition.sensitive ? '1' : '0',
        definition.value,
      ].join('\u0001'))
    .join('\u0000');
}

/** Characters of `query` appear in order inside `candidate` (case-insensitive). */
export function fuzzyMatches(query: string, candidate: string): boolean {
  return fuzzyScore(query, candidate) !== undefined;
}

/**
 * Higher is better. Rewards contiguous runs and earlier matches.
 * Returns undefined when the query is not a subsequence of the candidate.
 */
export function fuzzyScore(query: string, candidate: string): number | undefined {
  if (query.length === 0) {
    return 0;
  }
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let firstIndex = -1;
  for (let i = 0; i < c.length && qi < q.length; i += 1) {
    if (c[i] !== q[qi]) {
      consecutive = 0;
      continue;
    }
    if (firstIndex < 0) {
      firstIndex = i;
    }
    consecutive += 1;
    score += 1 + consecutive * 2;
    qi += 1;
  }
  if (qi !== q.length) {
    return undefined;
  }
  score += Math.max(0, 40 - firstIndex);
  score += Math.max(0, 20 - (c.length - q.length));
  return score;
}

function takeNamePrefix(value: string): string {
  let length = 0;
  while (length < value.length) {
    const slice = value.slice(0, length + 1);
    if (!NAME_CHARS.test(slice)) {
      break;
    }
    length += 1;
  }
  return value.slice(0, length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
