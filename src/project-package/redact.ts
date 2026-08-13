/**
 * Secret protection for packaged project files.
 * Reuses project-store tracked redaction and shared sensitive-header names.
 */

import { COLLECTION_VARIABLES_FILENAME } from '../collections/constants';
import {
  parseCollectionVariablesDocument,
  serializeCollectionVariablesDocument,
} from '../variables';
import {
  AUTH_PROFILES_FILENAME,
  parseAuthProfilesDocument,
  parseEnvironmentDocument,
  parseWorkspaceDocument,
  serializeJson,
  toAuthProfilesDocument,
  toTrackedVariable,
  toWorkspaceDocument,
} from '../project-store';
import {
  isSensitiveHttpHeaderName,
  redactUrlUserinfo,
  scrubSecretTokensInText,
} from '../shared';

const SENSITIVE_QUERY_KEYS = new Set([
  'api_key',
  'apikey',
  'token',
  'access_token',
  'refresh_token',
  'password',
  'secret',
  'authorization',
]);

export function placeholderForSensitiveHeader(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized === 'authorization' || normalized === 'proxy-authorization') {
    return '{{token}}';
  }
  if (normalized === 'cookie' || normalized === 'set-cookie') {
    return '{{cookie}}';
  }
  return '{{api_key}}';
}

export function redactApiFileText(text: string): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/u);
  return lines.map((line) => redactApiLine(line)).join(newline);
}

function redactApiLine(line: string): string {
  const sensitiveVariable =
    /^(\s*@sensitive-variable\s+)([^=\r\n]+)=(.*)$/iu.exec(line);
  if (sensitiveVariable !== null) {
    return `${sensitiveVariable[1]}${(sensitiveVariable[2] ?? '').trimEnd()}=`;
  }
  const commentedHeader =
    /^(\s*(?:#|\/\/)\s*)([A-Za-z0-9!#$%&'*+.^_`|~-]+)\s*:\s*(.*)$/u.exec(
      line,
    );
  if (
    commentedHeader !== null &&
    isSensitiveHttpHeaderName(commentedHeader[2] ?? '')
  ) {
    return `${commentedHeader[1]}${commentedHeader[2]}: ${placeholderForSensitiveHeader(commentedHeader[2]!)}`;
  }
  const trimmed = line.trimStart();
  if (trimmed.startsWith('@') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return line;
  }
  const header = /^([A-Za-z0-9!#$%&'*+.^_`|~-]+)\s*:\s*(.*)$/u.exec(line);
  if (header !== null && isSensitiveHttpHeaderName(header[1] ?? '')) {
    const prefix = line.slice(0, line.indexOf(header[1]!));
    return `${prefix}${header[1]}: ${placeholderForSensitiveHeader(header[1]!)}`;
  }
  return redactUrlsInLine(line);
}

function redactUrlsInLine(line: string): string {
  return line.replace(/https?:\/\/[^\s]+/giu, (url) => redactPackedUrl(url));
}

function redactPackedUrl(url: string): string {
  const withoutUserinfo = redactUrlUserinfo(url);
  try {
    const parsed = new URL(withoutUserinfo);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, '{{api_key}}');
        changed = true;
      }
    }
    return changed
      ? parsed.toString().replace(/%7B%7Bapi_key%7D%7D/giu, '{{api_key}}')
      : withoutUserinfo;
  } catch {
    return withoutUserinfo;
  }
}

export function redactWorkspaceJson(text: string): string {
  const parsed = parseWorkspaceDocument(text);
  if (parsed === undefined) {
    return scrubSecretTokensInText(text);
  }
  return serializeJson(
    toWorkspaceDocument(parsed.variables, parsed.activeEnvironmentId),
  );
}

export function redactEnvironmentJson(text: string): string {
  const parsed = parseEnvironmentDocument(text);
  if (parsed === undefined) {
    return scrubSecretTokensInText(text);
  }
  return serializeJson({
    id: parsed.id,
    name: parsed.name,
    variables: parsed.variables.map(toTrackedVariable),
  });
}

export function redactAuthProfilesJson(text: string): string {
  const parsed = parseAuthProfilesDocument(text);
  if (parsed === undefined) {
    return scrubSecretTokensInText(text);
  }
  const redacted = toAuthProfilesDocument(parsed.profiles);
  return serializeJson(stripLiteralAuthValues(redacted));
}

function stripLiteralAuthValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripLiteralAuthValues);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (record.kind === 'literal') {
    return { kind: 'secret' };
  }
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    next[key] = stripLiteralAuthValues(entry);
  }
  return next;
}

export function redactCollectionVariablesJson(text: string): string {
  const parsed = parseCollectionVariablesDocument(text);
  if (parsed === undefined) {
    return scrubSecretTokensInText(text);
  }
  return serializeCollectionVariablesDocument({
    schemaVersion: parsed.schemaVersion,
    variables: parsed.variables.map(toTrackedVariable),
  });
}

export function redactPackedFile(relativePath: string, text: string): string {
  const posix = relativePath.replace(/\\/gu, '/');
  if (posix.endsWith('.api')) {
    return redactApiFileText(text);
  }
  if (posix.endsWith(`/${AUTH_PROFILES_FILENAME}`) || posix === AUTH_PROFILES_FILENAME) {
    return redactAuthProfilesJson(text);
  }
  if (posix.endsWith('/workspace.json') || posix === 'workspace.json') {
    return redactWorkspaceJson(text);
  }
  if (
    posix.includes('.apihero/environments/') &&
    posix.endsWith('.json')
  ) {
    return redactEnvironmentJson(text);
  }
  if (posix.endsWith(`/${COLLECTION_VARIABLES_FILENAME}`)) {
    return redactCollectionVariablesJson(text);
  }
  if (posix.endsWith('.json')) {
    return scrubSecretTokensInText(text);
  }
  return text;
}
