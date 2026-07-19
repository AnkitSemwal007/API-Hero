/** Base class for errors that can safely cross application boundaries. */
export abstract class ApplicationError extends Error {
  /** Stable machine-readable error code. */
  public abstract readonly code: string;
}
