/**
 * Message contracts between the request editor webview and the host.
 * Framework-free so parsers and HTML helpers stay unit-testable.
 */

import type { VariableScope } from '../../models';
import { HTTP_METHODS, type HttpMethod } from '../../types';
import type {
  RequestSourceBody,
  RequestSourceDocument,
  RequestSourceExtractionRule,
  RequestSourceHeader,
  RequestSourceQueryParam,
  RequestSourceVariable,
} from '../../request-source';

/** Placeholder posted to the webview instead of cleartext sensitive values. */
export const SENSITIVE_VARIABLE_MASK = '••••••••';

/** Catalog entry for webview variable IntelliSense (never includes secrets). */
export interface RequestEditorVariableCompletion {
  readonly name: string;
  readonly scope: VariableScope;
  readonly sourceLabel: string;
  readonly icon: string;
  readonly sensitive: boolean;
  readonly description?: string;
  readonly valuePreview?: string;
}

export interface RequestEditorAuthProfileOption {
  readonly id: string;
  readonly label: string;
}

export type RequestEditorMode = 'form' | 'multi' | 'empty';

export interface RequestEditorState {
  readonly mode: RequestEditorMode;
  readonly documentVersion: number;
  readonly sourceText: string;
  readonly requestCount: number;
  readonly authProfiles: readonly RequestEditorAuthProfileOption[];
  readonly model?: RequestSourceDocument;
  readonly variablePreview?: Readonly<Record<string, string>>;
  readonly variableCompletions?: readonly RequestEditorVariableCompletion[];
  /** Display name of the active environment, when one is selected. */
  readonly activeEnvironmentLabel?: string;
  readonly fileName?: string;
}

export type RequestEditorInboundMessage =
  | { readonly type: 'ready' }
  | {
      readonly type: 'updateModel';
      readonly documentVersion: number;
      readonly model: RequestSourceDocument;
    }
  | { readonly type: 'run' }
  | { readonly type: 'openTextEditor' }
  | { readonly type: 'switchEnvironment' }
  | { readonly type: 'selectAuthentication' }
  | { readonly type: 'manageAuthProfiles' }
  | { readonly type: 'manageEnvironments' };

export type RequestEditorOutboundMessage =
  | { readonly type: 'init'; readonly state: RequestEditorState }
  | { readonly type: 'state'; readonly state: RequestEditorState }
  | {
      readonly type: 'ack';
      readonly documentVersion: number;
      readonly sourceText?: string;
    }
  | { readonly type: 'resubmit'; readonly documentVersion: number }
  | { readonly type: 'error'; readonly message: string };

/** Host → webview: version bump after a successful form→text apply (no DOM wipe). */
export function createRequestEditorAck(
  documentVersion: number,
  sourceText?: string,
): Extract<RequestEditorOutboundMessage, { type: 'ack' }> {
  return sourceText === undefined
    ? { type: 'ack', documentVersion }
    : { type: 'ack', documentVersion, sourceText };
}

/** Host → webview: ask for an immediate updateModel with the current buffer version. */
export function createRequestEditorResubmit(
  documentVersion: number,
): Extract<RequestEditorOutboundMessage, { type: 'resubmit' }> {
  return { type: 'resubmit', documentVersion };
}

/** Validates webview → extension messages. */
export function parseRequestEditorMessage(
  value: unknown,
): RequestEditorInboundMessage | undefined {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type === 'ready' ||
    record.type === 'run' ||
    record.type === 'openTextEditor' ||
    record.type === 'switchEnvironment' ||
    record.type === 'selectAuthentication' ||
    record.type === 'manageAuthProfiles' ||
    record.type === 'manageEnvironments'
  ) {
    return { type: record.type };
  }
  if (record.type !== 'updateModel') {
    return undefined;
  }
  if (
    typeof record.documentVersion !== 'number' ||
    !Number.isSafeInteger(record.documentVersion)
  ) {
    return undefined;
  }
  const model = parseRequestSourceDocument(record.model);
  if (model === undefined) {
    return undefined;
  }
  return {
    type: 'updateModel',
    documentVersion: record.documentVersion,
    model,
  };
}

/** Validates a RequestSourceDocument-shaped payload; rejects invalid nests. */
export function parseRequestSourceDocument(
  value: unknown,
): RequestSourceDocument | undefined {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || typeof record.url !== 'string') {
    return undefined;
  }
  if (typeof record.method !== 'string') {
    return undefined;
  }
  const methodUpper = record.method.trim().toUpperCase();
  if (!HTTP_METHODS.includes(methodUpper as HttpMethod)) {
    return undefined;
  }

  const headers = parseHeaders(record.headers);
  if (headers === undefined) {
    return undefined;
  }
  const queryParams = parseQueryParams(record.queryParams);
  if (queryParams === undefined) {
    return undefined;
  }
  const variables = parseVariables(record.variables);
  if (variables === undefined) {
    return undefined;
  }
  const extractionRules = parseExtractionRules(record.extractionRules);
  if (extractionRules === undefined) {
    return undefined;
  }
  const body = parseBody(record.body);
  if (body === undefined) {
    return undefined;
  }

  if (
    record.description !== undefined &&
    typeof record.description !== 'string'
  ) {
    return undefined;
  }
  if (
    record.authProfileId !== undefined &&
    typeof record.authProfileId !== 'string'
  ) {
    return undefined;
  }
  if (
    record.timeoutMs !== undefined &&
    (typeof record.timeoutMs !== 'number' ||
      !Number.isSafeInteger(record.timeoutMs) ||
      record.timeoutMs < 0)
  ) {
    return undefined;
  }
  if (
    record.expectLines !== undefined &&
    !isStringArray(record.expectLines)
  ) {
    return undefined;
  }
  if (record.comments !== undefined && !isStringArray(record.comments)) {
    return undefined;
  }

  const model: RequestSourceDocument = {
    name: record.name,
    method: methodUpper as HttpMethod,
    url: record.url,
    ...(typeof record.description === 'string'
      ? { description: record.description }
      : {}),
    ...(typeof record.authProfileId === 'string'
      ? { authProfileId: record.authProfileId }
      : {}),
    ...(typeof record.timeoutMs === 'number'
      ? { timeoutMs: record.timeoutMs }
      : {}),
    ...(headers !== null ? { headers } : {}),
    ...(queryParams !== null ? { queryParams } : {}),
    ...(body !== null ? { body } : {}),
    ...(isStringArray(record.expectLines)
      ? { expectLines: record.expectLines }
      : {}),
    ...(variables !== null ? { variables } : {}),
    ...(extractionRules !== null ? { extractionRules } : {}),
    ...(isStringArray(record.comments) ? { comments: record.comments } : {}),
  };
  return model;
}

/**
 * Replaces sensitive variable values with a mask before posting to the webview.
 */
export function maskSensitiveVariablesForWebview(
  document: RequestSourceDocument,
): RequestSourceDocument {
  const variables = document.variables;
  if (variables === undefined || !variables.some((entry) => entry.sensitive)) {
    return document;
  }
  return {
    ...document,
    variables: variables.map((entry) =>
      entry.sensitive === true
        ? { ...entry, value: SENSITIVE_VARIABLE_MASK, sensitive: true }
        : entry,
    ),
  };
}

/**
 * Redacts `@sensitive-variable` values in raw `.api` source before webview post.
 */
export function redactSensitiveVariablesInSource(sourceText: string): string {
  return sourceText.replace(
    /^([ \t]*@sensitive-variable[ \t]+)([^=\r\n]+)=([^\r\n]*)$/gmu,
    (_match, prefix: string, name: string) =>
      `${prefix}${name.trimEnd()}=${SENSITIVE_VARIABLE_MASK}`,
  );
}

/**
 * On save: if a sensitive value is still the mask (or matches baseline), keep
 * the original cleartext from the last parsed document; otherwise treat the
 * edited value as the new secret (still sensitive).
 *
 * Matching prefers name, then the same index in the baseline sensitive list so
 * renaming a masked row does not persist the mask glyph as cleartext.
 */
export function restoreSensitiveVariablesFromBaseline(
  incoming: RequestSourceDocument,
  baseline: RequestSourceDocument,
): RequestSourceDocument {
  const baselineVariables = baseline.variables ?? [];
  const baselineSensitiveByName = new Map(
    baselineVariables
      .filter((entry) => entry.sensitive === true)
      .map((entry) => [entry.name, entry.value] as const),
  );
  const baselineSensitiveOrdered = baselineVariables.filter(
    (entry) => entry.sensitive === true,
  );
  if (baselineSensitiveOrdered.length === 0 || incoming.variables === undefined) {
    return incoming;
  }

  let sensitiveIndex = 0;
  return {
    ...incoming,
    variables: incoming.variables.map((entry) => {
      if (entry.sensitive !== true) {
        return entry;
      }
      const index = sensitiveIndex;
      sensitiveIndex += 1;
      const byName = baselineSensitiveByName.get(entry.name);
      if (
        byName !== undefined &&
        (entry.value === SENSITIVE_VARIABLE_MASK || entry.value === byName)
      ) {
        return { name: entry.name, value: byName, sensitive: true };
      }
      if (entry.value === SENSITIVE_VARIABLE_MASK) {
        const byIndex = baselineSensitiveOrdered[index];
        if (byIndex !== undefined) {
          return { name: entry.name, value: byIndex.value, sensitive: true };
        }
        // Never persist the mask glyph — drop unmatched masked values.
        return { name: entry.name, value: '', sensitive: true };
      }
      return { name: entry.name, value: entry.value, sensitive: true };
    }),
  };
}

function parseHeaders(
  value: unknown,
): readonly RequestSourceHeader[] | null | undefined {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const headers: RequestSourceHeader[] = [];
  for (const entry of value) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry)
    ) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.value !== 'string') {
      return undefined;
    }
    if (
      record.enabled !== undefined &&
      typeof record.enabled !== 'boolean'
    ) {
      return undefined;
    }
    headers.push({
      name: record.name,
      value: record.value,
      ...(typeof record.enabled === 'boolean'
        ? { enabled: record.enabled }
        : {}),
    });
  }
  return headers;
}

function parseQueryParams(
  value: unknown,
): readonly RequestSourceQueryParam[] | null | undefined {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const params: RequestSourceQueryParam[] = [];
  for (const entry of value) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry)
    ) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.value !== 'string') {
      return undefined;
    }
    if (
      record.enabled !== undefined &&
      typeof record.enabled !== 'boolean'
    ) {
      return undefined;
    }
    params.push({
      name: record.name,
      value: record.value,
      ...(typeof record.enabled === 'boolean'
        ? { enabled: record.enabled }
        : {}),
    });
  }
  return params;
}

function parseVariables(
  value: unknown,
): readonly RequestSourceVariable[] | null | undefined {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const variables: RequestSourceVariable[] = [];
  for (const entry of value) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry)
    ) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.value !== 'string') {
      return undefined;
    }
    if (
      record.sensitive !== undefined &&
      typeof record.sensitive !== 'boolean'
    ) {
      return undefined;
    }
    variables.push({
      name: record.name,
      value: record.value,
      ...(record.sensitive === true ? { sensitive: true } : {}),
    });
  }
  return variables;
}

const EXTRACTION_SCOPES = new Set([
  'run',
  'document',
  'collection',
  'environment',
  'workspace',
]);

function parseExtractionRules(
  value: unknown,
): readonly RequestSourceExtractionRule[] | null | undefined {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const rules: RequestSourceExtractionRule[] = [];
  for (const entry of value) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry)
    ) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.from !== 'string') {
      return undefined;
    }
    if (
      record.scope !== undefined &&
      (typeof record.scope !== 'string' || !EXTRACTION_SCOPES.has(record.scope))
    ) {
      return undefined;
    }
    if (
      record.sensitive !== undefined &&
      typeof record.sensitive !== 'boolean'
    ) {
      return undefined;
    }
    if (
      record.optional !== undefined &&
      typeof record.optional !== 'boolean'
    ) {
      return undefined;
    }
    if (record.when !== undefined && typeof record.when !== 'string') {
      return undefined;
    }
    if (
      record.enabled !== undefined &&
      typeof record.enabled !== 'boolean'
    ) {
      return undefined;
    }
    rules.push({
      name: record.name,
      from: record.from,
      ...(typeof record.scope === 'string'
        ? {
            scope: record.scope as
              | 'run'
              | 'document'
              | 'collection'
              | 'environment'
              | 'workspace',
          }
        : {}),
      ...(record.sensitive === true ? { sensitive: true as const } : {}),
      ...(record.optional === true ? { optional: true as const } : {}),
      ...(typeof record.when === 'string' ? { when: record.when } : {}),
      ...(record.enabled === false ? { enabled: false as const } : {}),
    });
  }
  return rules;
}

function parseBody(
  value: unknown,
): RequestSourceBody | null | undefined {
  if (value === undefined) {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.type !== 'string') {
    return undefined;
  }
  switch (record.type) {
    case 'none':
      return { type: 'none' };
    case 'json':
    case 'text':
      if (typeof record.text !== 'string') {
        return undefined;
      }
      return { type: record.type, text: record.text };
    case 'raw': {
      if (typeof record.text !== 'string') {
        return undefined;
      }
      if (
        record.contentType !== undefined &&
        typeof record.contentType !== 'string'
      ) {
        return undefined;
      }
      return {
        type: 'raw',
        text: record.text,
        ...(typeof record.contentType === 'string'
          ? { contentType: record.contentType }
          : {}),
      };
    }
    case 'form': {
      const fields = parseNameValueFields(record.fields);
      if (fields === undefined) {
        return undefined;
      }
      return { type: 'form', fields: fields ?? [] };
    }
    case 'multipart': {
      if (
        record.boundary !== undefined &&
        typeof record.boundary !== 'string'
      ) {
        return undefined;
      }
      const fields = parseNameValueFields(record.fields);
      if (fields === undefined) {
        return undefined;
      }
      return {
        type: 'multipart',
        ...(typeof record.boundary === 'string'
          ? { boundary: record.boundary }
          : {}),
        ...(fields !== null ? { fields } : {}),
      };
    }
    case 'binary': {
      if (record.note !== undefined && typeof record.note !== 'string') {
        return undefined;
      }
      return {
        type: 'binary',
        ...(typeof record.note === 'string' ? { note: record.note } : {}),
      };
    }
    default:
      return undefined;
  }
}

function parseNameValueFields(
  value: unknown,
): readonly { readonly name: string; readonly value: string }[] | null | undefined {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const fields: { name: string; value: string }[] = [];
  for (const entry of value) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry)
    ) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.value !== 'string') {
      return undefined;
    }
    fields.push({ name: record.name, value: record.value });
  }
  return fields;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
