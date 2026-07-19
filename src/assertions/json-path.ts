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

export type JsonPathResolution =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false; readonly reason: string };

export function resolveJsonPath(
  root: unknown,
  path: string | undefined,
): JsonPathResolution {
  if (path === undefined || path.trim().length === 0) {
    return { found: true, value: root };
  }

  let current: unknown = root;
  let remaining = path.trim();
  // Allow a leading "body." that callers may leave on the path.
  if (remaining.toLowerCase().startsWith('body.')) {
    remaining = remaining.slice(5);
  }

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
