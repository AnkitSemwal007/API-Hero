/**
 * Message contracts between the request editor webview and the host.
 * Framework-free so parsers and HTML helpers stay unit-testable.
 */

import { HTTP_METHODS, type HttpMethod } from '../../types';
import type {
  RequestSourceBody,
  RequestSourceDocument,
  RequestSourceHeader,
  RequestSourceQueryParam,
  RequestSourceVariable,
} from '../../request-source';

/** Placeholder posted to the webview instead of cleartext sensitive values. */
export const SENSITIVE_VARIABLE_MASK = '••••••••';

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
  | { readonly type: 'selectAuthentication' };

export type RequestEditorOutboundMessage =
  | { readonly type: 'init'; readonly state: RequestEditorState }
  | { readonly type: 'state'; readonly state: RequestEditorState }
  | { readonly type: 'error'; readonly message: string };

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
    record.type === 'selectAuthentication'
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
 */
export function restoreSensitiveVariablesFromBaseline(
  incoming: RequestSourceDocument,
  baseline: RequestSourceDocument,
): RequestSourceDocument {
  const baselineSensitive = new Map(
    (baseline.variables ?? [])
      .filter((entry) => entry.sensitive === true)
      .map((entry) => [entry.name, entry.value] as const),
  );
  if (baselineSensitive.size === 0 || incoming.variables === undefined) {
    return incoming;
  }

  return {
    ...incoming,
    variables: incoming.variables.map((entry) => {
      if (entry.sensitive !== true) {
        return entry;
      }
      const original = baselineSensitive.get(entry.name);
      if (
        original !== undefined &&
        (entry.value === SENSITIVE_VARIABLE_MASK || entry.value === original)
      ) {
        return { name: entry.name, value: original, sensitive: true };
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
