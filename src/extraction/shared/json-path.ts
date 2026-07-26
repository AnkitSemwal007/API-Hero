/**
 * Resolves a dotted / indexed JSON path relative to a response body root.
 *
 * Supported forms:
 * - `user.id`
 * - `data.items[0].name`
 * - `orders.length` (array or string length)
 * - empty path → the root value itself
 *
 * Missing paths return `{ found: false }` without throwing.
 */

/** Property-name segment grammar used by {@link resolveJsonPath}. */
const JSON_PATH_PROPERTY = /^[A-Za-z_][\w-]*$/u;

export type JsonPathResolution =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false; readonly reason: string };

/**
 * Strips a leading `body` prefix from a response-relative JSON path:
 * - `body` → `''`
 * - `body.foo` → `foo`
 * - `body[0]` → `[0]` (bracket kept — array-root bodies)
 * - anything else → the trimmed path, unchanged
 */
export function stripBodyPrefix(path: string): string {
  const trimmed = path.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'body') {
    return '';
  }
  if (lower.startsWith('body.')) {
    return trimmed.slice(5);
  }
  if (lower.startsWith('body[')) {
    return trimmed.slice(4);
  }
  return trimmed;
}

/**
 * Returns true when every property segment in `path` matches the json-path
 * identifier grammar (`^[A-Za-z_][\w-]*$`). Numeric indices are allowed.
 * Leading `body.` / `body[` / bare `body` are accepted. Paths with spaces,
 * quoted keys, or other non-identifier property names return false.
 */
export function isExtractableJsonPath(path: string): boolean {
  let remaining = stripBodyPrefix(path);
  if (remaining.length === 0) {
    return true;
  }

  while (remaining.length > 0) {
    if (remaining.startsWith('.')) {
      remaining = remaining.slice(1);
      continue;
    }

    if (remaining === 'length' || remaining.startsWith('length.')) {
      if (remaining === 'length') {
        return true;
      }
      return false;
    }

    const indexMatch = /^\[(\d+)\](.*)$/u.exec(remaining);
    if (indexMatch !== null) {
      remaining = indexMatch[2] ?? '';
      continue;
    }

    const propMatch = /^([A-Za-z_][\w-]*)(.*)$/u.exec(remaining);
    if (propMatch === null) {
      return false;
    }
    const property = propMatch[1]!;
    if (!JSON_PATH_PROPERTY.test(property)) {
      return false;
    }
    remaining = propMatch[2] ?? '';
  }
  return true;
}

export function resolveJsonPath(
  root: unknown,
  path: string | undefined,
): JsonPathResolution {
  if (path === undefined || path.trim().length === 0) {
    return { found: true, value: root };
  }

  let current: unknown = root;
  // Allow a leading "body" / "body." / "body[" that callers may leave on the path.
  let remaining = stripBodyPrefix(path);

  while (remaining.length > 0) {
    if (remaining.startsWith('.')) {
      remaining = remaining.slice(1);
      continue;
    }

    if (remaining === 'length' || remaining.startsWith('length.')) {
      if (typeof current === 'string' || Array.isArray(current)) {
        if (remaining === 'length') {
          return { found: true, value: current.length };
        }
        return {
          found: false,
          reason: `Cannot traverse beyond .length at "${path}".`,
        };
      }
      return {
        found: false,
        reason: `Value at path does not have a length.`,
      };
    }

    const indexMatch = /^\[(\d+)\](.*)$/u.exec(remaining);
    if (indexMatch !== null) {
      const index = Number(indexMatch[1]);
      remaining = indexMatch[2] ?? '';
      if (!Array.isArray(current)) {
        return {
          found: false,
          reason: `Expected an array before index [${index}].`,
        };
      }
      if (index < 0 || index >= current.length) {
        return {
          found: false,
          reason: `Array index [${index}] is out of bounds.`,
        };
      }
      current = current[index];
      continue;
    }

    const propMatch = /^([A-Za-z_][\w-]*)(.*)$/u.exec(remaining);
    if (propMatch === null) {
      return {
        found: false,
        reason: `Invalid JSON path segment near "${remaining}".`,
      };
    }
    const property = propMatch[1]!;
    remaining = propMatch[2] ?? '';

    if (property === 'length' && (typeof current === 'string' || Array.isArray(current))) {
      current = current.length;
      continue;
    }

    if (
      current === null ||
      typeof current !== 'object' ||
      Array.isArray(current)
    ) {
      return {
        found: false,
        reason: `Cannot read property "${property}" from a non-object value.`,
      };
    }

    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, property)) {
      return {
        found: false,
        reason: `Property "${property}" does not exist.`,
      };
    }
    current = record[property];
  }

  return { found: true, value: current };
}
