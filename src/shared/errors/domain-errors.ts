import { ApplicationError } from './application-error';

/** Error raised when an API document cannot be parsed. */
export class ParserError extends ApplicationError {
  public readonly code = 'PARSER_ERROR';
}

/** Error raised when authentication cannot be resolved. */
export class AuthenticationError extends ApplicationError {
  public readonly code = 'AUTHENTICATION_ERROR';
}

/** Error raised when request execution fails. */
export class RequestExecutionError extends ApplicationError {
  public readonly code = 'REQUEST_EXECUTION_ERROR';
}

/** Error raised when extension configuration is invalid. */
export class ConfigurationError extends ApplicationError {
  public readonly code = 'CONFIGURATION_ERROR';
}
