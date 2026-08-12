/**
 * Minimal untrusted Postman Collection v2 / v2.1 JSON shapes.
 * No Postman SDK — treat every field as unknown at the boundary.
 */

/** Caps for pathological collections (beyond {@link ImportLimits.maxFileBytes}). */
export const POSTMAN_IMPORT_LIMITS = {
  maxItemDepth: 32,
  maxRequestCount: 2_000,
  maxFolderCount: 500,
  maxVariableCount: 1_000,
} as const;

/** Loose key/value variable entry from collection / folder / request. */
export interface PostmanVariableLike {
  readonly key?: unknown;
  readonly value?: unknown;
  readonly type?: unknown;
  readonly disabled?: unknown;
  readonly description?: unknown;
}

/** Loose auth block (`auth.type` + `auth.<type>` array). */
export interface PostmanAuthLike {
  readonly type?: unknown;
  readonly [key: string]: unknown;
}

/** Loose URL object or raw string. */
export type PostmanUrlLike =
  | string
  | {
      readonly raw?: unknown;
      readonly protocol?: unknown;
      readonly host?: unknown;
      readonly path?: unknown;
      readonly query?: unknown;
      readonly variable?: unknown;
      readonly port?: unknown;
    };

export interface PostmanHeaderLike {
  readonly key?: unknown;
  readonly value?: unknown;
  readonly disabled?: unknown;
  readonly description?: unknown;
}

export interface PostmanQueryParamLike {
  readonly key?: unknown;
  readonly value?: unknown;
  readonly disabled?: unknown;
  readonly description?: unknown;
}

export interface PostmanBodyLike {
  readonly mode?: unknown;
  readonly raw?: unknown;
  readonly urlencoded?: unknown;
  readonly formdata?: unknown;
  readonly graphql?: unknown;
  readonly file?: unknown;
  readonly options?: unknown;
}

export interface PostmanRequestLike {
  readonly method?: unknown;
  readonly header?: unknown;
  readonly url?: unknown;
  readonly body?: unknown;
  readonly auth?: unknown;
  readonly description?: unknown;
}

export interface PostmanEventLike {
  readonly listen?: unknown;
  readonly script?: unknown;
  readonly disabled?: unknown;
}

/**
 * Collection item: either a folder (`item` array) or a request (`request`).
 * Folders may nest arbitrarily.
 */
export interface PostmanItemLike {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly item?: unknown;
  readonly request?: unknown;
  readonly event?: unknown;
  readonly auth?: unknown;
  readonly variable?: unknown;
}

export interface PostmanInfoLike {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly version?: unknown;
  readonly schema?: unknown;
  readonly _postman_id?: unknown;
}

/** Root collection document (v2 / v2.1). */
export interface PostmanCollectionLike {
  readonly info?: unknown;
  readonly item?: unknown;
  readonly variable?: unknown;
  readonly auth?: unknown;
  readonly event?: unknown;
}

/** Parsed, validated collection ready for mapping (still untrusted leaf values). */
export interface ParsedPostmanCollection {
  readonly info: {
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly schema: string;
  };
  /** Format version string for ImportArtifacts.openapiVersion (source format). */
  readonly formatVersion: string;
  readonly root: PostmanCollectionLike;
}
