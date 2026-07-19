import { HTTP_METHODS } from '../types';

/** Case-sensitive set of supported HTTP method tokens. */
export const HTTP_METHOD_SET: ReadonlySet<string> = new Set(HTTP_METHODS);
