/**
 * Deeply freezes plain objects and arrays.
 *
 * ArrayBuffer views and ArrayBuffers are returned unchanged: Node throws when
 * `Object.freeze` is applied to a TypedArray that already has elements. Byte
 * sealing for response bodies goes through `freezeDetachedBytes` only.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

/** Structural clone that does not share nested object or array identity. */
export function cloneDetached<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(cloneDetached) as T;
  }
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        continue;
      }
      Object.defineProperty(copy, key, {
        value: cloneDetached(child),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy as T;
  }
  return value;
}
