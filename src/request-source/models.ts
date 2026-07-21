/**
 * Framework-free request document model for `.api` serialization.
 * Shared by New Request dialog and future Custom Text Editor.
 */

import type { HttpMethod } from '../types';

/** HTTP methods accepted by the request-source serializer. */
export type RequestSourceMethod = HttpMethod;

/** Header line with optional disable (emitted as a `#` comment when disabled). */
export interface RequestSourceHeader {
  readonly name: string;
  readonly value: string;
  /** When false, the header is written as a commented line. Defaults to true. */
  readonly enabled?: boolean;
}

/**
 * Query parameter encoded into the request URL (`?a=1&b=2`).
 * Matches runtime `parseParameters(queryPart(url))` — no separate query block.
 */
export interface RequestSourceQueryParam {
  readonly name: string;
  readonly value: string;
  /** When false, the param is omitted from the URL. Defaults to true. */
  readonly enabled?: boolean;
}

/**
 * Document-scoped `@variable` / `@sensitive-variable` definition.
 * When `sensitive` is true, serialize as `@sensitive-variable`.
 */
export interface RequestSourceVariable {
  readonly name: string;
  readonly value: string;
  /** When true, emitted as `@sensitive-variable` and masked in the form UI. */
  readonly sensitive?: boolean;
}

/**
 * Body payload kinds. Multipart and binary emit reasonable stubs until the
 * Custom Text Editor owns richer editing.
 */
export type RequestSourceBody =
  | { readonly type: 'none' }
  | { readonly type: 'json'; readonly text: string }
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'form';
      readonly fields: readonly { readonly name: string; readonly value: string }[];
    }
  | {
      readonly type: 'raw';
      readonly text: string;
      readonly contentType?: string;
    }
  | {
      readonly type: 'multipart';
      readonly fields?: readonly {
        readonly name: string;
        readonly value: string;
      }[];
      readonly boundary?: string;
    }
  | {
      readonly type: 'binary';
      /** Path or placeholder note; emitted as a comment stub. */
      readonly note?: string;
    };

/**
 * Canonical in-memory shape for one `.api` request document (single request).
 * Optional fields are omitted from the serialized source when empty/undefined.
 */
export interface RequestSourceDocument {
  readonly name: string;
  readonly method: RequestSourceMethod;
  /** Base URL without query string; query params are applied separately. */
  readonly url: string;
  readonly description?: string;
  /** Authentication profile id for `@auth`. */
  readonly authProfileId?: string;
  readonly headers?: readonly RequestSourceHeader[];
  readonly queryParams?: readonly RequestSourceQueryParam[];
  readonly body?: RequestSourceBody;
  /**
   * Assertion lines. Prefer full `expect …` text; bare expressions are
   * prefixed with `expect `.
   */
  readonly expectLines?: readonly string[];
  readonly variables?: readonly RequestSourceVariable[];
  /**
   * Optional `@timeout` in milliseconds. Omitted from source when undefined.
   * There is no follow-redirects directive in the `.api` format.
   */
  readonly timeoutMs?: number;
  /** Optional leading `#` comment lines (without the `#` prefix). */
  readonly comments?: readonly string[];
}
