/**
 * Serializes a RequestSourceDocument to `.api` source text.
 *
 * Layout (aligned with OpenAPI `generateRequestSource`):
 * - optional `#` comments
 * - `@name`, optional `@description`, `@auth`, `@variable`
 * - METHOD url(?query)
 * - headers (disabled → `# Name: value`)
 * - blank line + body
 * - expect lines
 *
 * Query params are encoded into the URL (same approach as OpenAPI import and
 * runtime `parseParameters(queryPart(url))`). Template values starting with
 * `{{` are left unencoded so `{{baseUrl}}` / `{{id}}` stay intact.
 */

import type {
  RequestSourceBody,
  RequestSourceDocument,
  RequestSourceHeader,
  RequestSourceQueryParam,
} from './models';

/**
 * Serializes one request document to `.api` source.
 * Always ends with a trailing newline.
 */
export function serializeRequestDocument(
  document: RequestSourceDocument,
): string {
  const lines: string[] = [];

  for (const comment of document.comments ?? []) {
    const text = singleLine(comment);
    if (text.length > 0) {
      lines.push(`# ${text}`);
    }
  }

  lines.push(`@name ${singleLine(document.name) || 'New Request'}`);

  const description = document.description?.trim();
  if (description !== undefined && description.length > 0) {
    lines.push(`@description ${singleLine(description)}`);
  }

  const auth = document.authProfileId?.trim();
  if (auth !== undefined && auth.length > 0) {
    lines.push(`@auth ${singleLine(auth)}`);
  }

  if (
    document.timeoutMs !== undefined &&
    Number.isSafeInteger(document.timeoutMs) &&
    document.timeoutMs >= 0
  ) {
    lines.push(`@timeout ${document.timeoutMs}`);
  }

  for (const variable of document.variables ?? []) {
    const name = variable.name.trim();
    if (name.length === 0) {
      continue;
    }
    const directive =
      variable.sensitive === true ? '@sensitive-variable' : '@variable';
    lines.push(`${directive} ${name}=${singleLine(variable.value)}`);
  }

  // Blank line before the request line (matches Phase 1b placeholder / hand-written feel).
  lines.push('');

  const method = String(document.method).toUpperCase();
  const url = buildUrl(document.url, document.queryParams);
  lines.push(`${method} ${url}`);

  const body = document.body ?? { type: 'none' };
  const { contentType, bodyLines } = serializeBody(body);
  const headers = [...(document.headers ?? [])];

  if (
    contentType !== undefined &&
    !hasHeaderName(headers, 'content-type')
  ) {
    headers.push({ name: 'Content-Type', value: contentType, enabled: true });
  }

  for (const header of headers) {
    lines.push(formatHeader(header));
  }

  if (bodyLines.length > 0) {
    lines.push('');
    lines.push(...bodyLines);
  }

  const expectLines = document.expectLines ?? [];
  if (expectLines.length > 0) {
    if (bodyLines.length === 0) {
      lines.push('');
    }
    for (const raw of expectLines) {
      const line = formatExpectLine(raw);
      if (line !== undefined) {
        lines.push(line);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

/** Builds a minimal GET placeholder matching the Phase 1b default. */
export function serializePlaceholderRequest(name: string): string {
  return serializeRequestDocument({
    name: name.trim().length > 0 ? name.trim() : 'New Request',
    method: 'GET',
    url: 'https://httpbin.org/get',
  });
}

function buildUrl(
  rawUrl: string,
  queryParams: readonly RequestSourceQueryParam[] | undefined,
): string {
  const base = rawUrl.trim().length > 0 ? rawUrl.trim() : 'https://httpbin.org/get';
  const enabled = (queryParams ?? []).filter(
    (param) => param.enabled !== false && param.name.trim().length > 0,
  );
  if (enabled.length === 0) {
    return base;
  }

  const withoutHash = base.split('#')[0] ?? base;
  const hashIndex = base.indexOf('#');
  const hash = hashIndex >= 0 ? base.slice(hashIndex) : '';
  const question = withoutHash.indexOf('?');
  const pathOnly =
    question >= 0 ? withoutHash.slice(0, question) : withoutHash;
  const existingQuery =
    question >= 0 ? withoutHash.slice(question + 1) : '';

  const encoded = enabled.map((param) => {
    const name = encodeQueryComponent(param.name.trim());
    const value = encodeQueryValue(param.value);
    return `${name}=${value}`;
  });

  const query =
    existingQuery.length > 0
      ? `${existingQuery}&${encoded.join('&')}`
      : encoded.join('&');

  return `${pathOnly}?${query}${hash}`;
}

/**
 * Encodes a query component. Values that look like `{{var}}` templates are
 * preserved (same rule as OpenAPI request generation).
 */
function encodeQueryValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
    return trimmed;
  }
  return encodeQueryComponent(trimmed);
}

function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/gu, '+');
}

function formatHeader(header: RequestSourceHeader): string {
  const name = header.name.trim();
  const value = singleLine(header.value);
  const line = `${name}: ${value}`;
  return header.enabled === false ? `# ${line}` : line;
}

function hasHeaderName(
  headers: readonly RequestSourceHeader[],
  name: string,
): boolean {
  const target = name.toLowerCase();
  return headers.some(
    (header) =>
      header.enabled !== false &&
      header.name.trim().toLowerCase() === target,
  );
}

function serializeBody(body: RequestSourceBody): {
  readonly contentType?: string;
  readonly bodyLines: readonly string[];
} {
  switch (body.type) {
    case 'none':
      return { bodyLines: [] };
    case 'json': {
      const text = body.text.trim().length > 0 ? body.text.trim() : '{}';
      return {
        contentType: 'application/json',
        bodyLines: formatMultiline(text),
      };
    }
    case 'text':
      return {
        contentType: 'text/plain',
        bodyLines: formatMultiline(body.text),
      };
    case 'form': {
      const fields = body.fields.filter((field) => field.name.trim().length > 0);
      const encoded =
        fields.length === 0
          ? 'field=value'
          : fields
              .map(
                (field) =>
                  `${encodeQueryComponent(field.name.trim())}=${encodeQueryValue(field.value)}`,
              )
              .join('&');
      return {
        contentType: 'application/x-www-form-urlencoded',
        bodyLines: [encoded],
      };
    }
    case 'raw':
      return {
        ...(body.contentType !== undefined && body.contentType.trim().length > 0
          ? { contentType: body.contentType.trim() }
          : {}),
        bodyLines: formatMultiline(body.text),
      };
    case 'multipart': {
      const boundary = body.boundary?.trim() || 'boundary';
      const fields =
        body.fields !== undefined && body.fields.length > 0
          ? body.fields
          : [{ name: 'field', value: 'value' }];
      const lines: string[] = [
        `# multipart/form-data body stub — replace parts as needed`,
      ];
      for (const field of fields) {
        lines.push(`--${boundary}`);
        lines.push(
          `Content-Disposition: form-data; name="${singleLine(field.name)}"`,
        );
        lines.push('');
        lines.push(field.value);
      }
      lines.push(`--${boundary}--`);
      return {
        contentType: `multipart/form-data; boundary=${boundary}`,
        bodyLines: lines,
      };
    }
    case 'binary':
      return {
        contentType: 'application/octet-stream',
        bodyLines: [
          `# binary body stub — add file contents manually${
            body.note !== undefined && body.note.trim().length > 0
              ? `: ${singleLine(body.note)}`
              : ''
          }`,
        ],
      };
    default: {
      const _exhaustive: never = body;
      return _exhaustive;
    }
  }
}

function formatExpectLine(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/^#\s*expect\b/iu.test(trimmed)) {
    return trimmed;
  }
  if (/^expect\b/iu.test(trimmed)) {
    return trimmed;
  }
  return `expect ${trimmed}`;
}

function formatMultiline(text: string): readonly string[] {
  if (text.length === 0) {
    return [];
  }
  return text.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n').split('\n');
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/gu, ' ').trim();
}
