/**
 * Minimal untrusted Insomnia export JSON shapes.
 * Treat every field as unknown at the boundary — never execute scripts.
 */

/** Caps for pathological exports (beyond ImportLimits.maxFileBytes). */
export const INSOMNIA_IMPORT_LIMITS = {
  maxItemDepth: 32,
  maxRequestCount: 2_000,
  maxFolderCount: 500,
  maxVariableCount: 1_000,
  maxResourceCount: 5_000,
} as const;

/** Supported export wrapper formats (`__export_format`). */
export const INSOMNIA_SUPPORTED_EXPORT_FORMATS = [3, 4] as const;

export type InsomniaResourceType =
  | 'workspace'
  | 'request_group'
  | 'request'
  | 'environment'
  | 'cookie_jar'
  | 'api_spec'
  | 'proto_file'
  | 'grpc_request'
  | 'websocket_request'
  | 'socketio_request'
  | 'mcp_request'
  | 'unit_test'
  | 'unit_test_suite'
  | 'mock'
  | 'unknown';

export interface InsomniaResourceLike {
  readonly _id?: unknown;
  readonly _type?: unknown;
  readonly parentId?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly method?: unknown;
  readonly url?: unknown;
  readonly headers?: unknown;
  readonly parameters?: unknown;
  readonly body?: unknown;
  readonly authentication?: unknown;
  readonly preRequestScript?: unknown;
  readonly afterResponseScript?: unknown;
  readonly data?: unknown;
  readonly dataPropertyOrder?: unknown;
  readonly metaSortKey?: unknown;
  readonly [key: string]: unknown;
}

/** Root export document (resource-based v3 / v4). */
export interface InsomniaExportLike {
  readonly _type?: unknown;
  readonly __export_format?: unknown;
  readonly __export_date?: unknown;
  readonly __export_source?: unknown;
  readonly resources?: unknown;
}

export interface ParsedInsomniaExport {
  readonly info: {
    readonly name: string;
    readonly description: string;
    readonly exportFormat: number;
  };
  /** Format version string for ImportArtifacts.openapiVersion (source format). */
  readonly formatVersion: string;
  readonly resources: readonly InsomniaResourceLike[];
  readonly workspaceId: string | undefined;
}
