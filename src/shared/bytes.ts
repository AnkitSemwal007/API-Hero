/**
 * Immutable response body bytes without a `number[]` amplification.
 *
 * Node cannot `Object.freeze` a TypedArray that already has elements, so this
 * thin frozen wrapper seals ownership: the underlying buffer is private,
 * detached at construction, and only exposed via indexed reads / copy-out.
 */
export interface ImmutableBytes {
  readonly byteLength: number;
  readonly length: number;
  at(index: number): number | undefined;
  /** Copy-out; never returns the underlying buffer. */
  slice(start?: number, end?: number): Uint8Array;
  /** Full detached copy of the sealed bytes. */
  copyOut(): Uint8Array;
  [Symbol.iterator](): IterableIterator<number>;
}

/**
 * Detaches and seals response body bytes so consumers cannot mutate the
 * transport buffer or the published view.
 *
 * This is the single public detach copy on the happy path: the transport
 * transfers one owned `Uint8Array`, and this function copies it into a private
 * buffer sealed behind `ImmutableBytes`.
 */
export function freezeDetachedBytes(source: Uint8Array): ImmutableBytes {
  const data = new Uint8Array(source);
  return Object.freeze({
    byteLength: data.byteLength,
    length: data.byteLength,
    at(index: number): number | undefined {
      if (!Number.isInteger(index) || index < 0 || index >= data.byteLength) {
        return undefined;
      }
      return data[index];
    },
    slice(start?: number, end?: number): Uint8Array {
      return data.slice(start, end);
    },
    copyOut(): Uint8Array {
      return new Uint8Array(data);
    },
    [Symbol.iterator](): IterableIterator<number> {
      return data.values();
    },
  });
}
