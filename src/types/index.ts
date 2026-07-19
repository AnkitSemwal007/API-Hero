/** Stable identifier for an environment. */

export type EnvironmentId = string;



/** Stable identifier for a request. */

export type RequestId = string;



/** HTTP methods supported across parser and runtime boundaries. */

export const HTTP_METHODS = Object.freeze([

  'GET',

  'POST',

  'PUT',

  'PATCH',

  'DELETE',

  'HEAD',

  'OPTIONS',

] as const);

export type HttpMethod = (typeof HTTP_METHODS)[number];



/** An ISO-8601 date-time string. */

export type IsoDateTime = string;


