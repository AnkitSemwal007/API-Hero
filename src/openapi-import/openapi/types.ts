/**
 * Focused OpenAPI 3.0 / 3.1 document model.
 * Only fields needed for import generation are typed; unknown keys are ignored.
 */

export interface OpenApiDocument {
  readonly openapi: string;
  readonly info: OpenApiInfo;
  readonly servers?: readonly OpenApiServer[];
  readonly paths?: Readonly<Record<string, OpenApiPathItem | undefined>>;
  readonly components?: OpenApiComponents;
  readonly security?: readonly OpenApiSecurityRequirement[];
  readonly tags?: readonly OpenApiTag[];
  readonly externalDocs?: OpenApiExternalDocs;
}

export interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly termsOfService?: string;
  readonly contact?: Readonly<Record<string, unknown>>;
  readonly license?: Readonly<Record<string, unknown>>;
}

export interface OpenApiServer {
  readonly url: string;
  readonly description?: string;
  readonly variables?: Readonly<
    Record<string, OpenApiServerVariable | undefined>
  >;
}

export interface OpenApiServerVariable {
  readonly default: string;
  readonly enum?: readonly string[];
  readonly description?: string;
}

export interface OpenApiExternalDocs {
  readonly url: string;
  readonly description?: string;
}

export interface OpenApiTag {
  readonly name: string;
  readonly description?: string;
  readonly externalDocs?: OpenApiExternalDocs;
}

export type OpenApiHttpMethod =
  | 'get'
  | 'put'
  | 'post'
  | 'delete'
  | 'options'
  | 'head'
  | 'patch'
  | 'trace';

export const OPENAPI_HTTP_METHODS: readonly OpenApiHttpMethod[] = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

export interface OpenApiPathItem {
  readonly summary?: string;
  readonly description?: string;
  readonly parameters?: readonly OpenApiParameterOrRef[];
  readonly servers?: readonly OpenApiServer[];
  readonly get?: OpenApiOperation;
  readonly put?: OpenApiOperation;
  readonly post?: OpenApiOperation;
  readonly delete?: OpenApiOperation;
  readonly options?: OpenApiOperation;
  readonly head?: OpenApiOperation;
  readonly patch?: OpenApiOperation;
  readonly trace?: OpenApiOperation;
  readonly $ref?: string;
}

export interface OpenApiOperation {
  readonly operationId?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly externalDocs?: OpenApiExternalDocs;
  readonly parameters?: readonly OpenApiParameterOrRef[];
  readonly requestBody?: OpenApiRequestBodyOrRef;
  readonly responses?: Readonly<Record<string, OpenApiResponseOrRef | undefined>>;
  readonly security?: readonly OpenApiSecurityRequirement[];
  readonly servers?: readonly OpenApiServer[];
  readonly deprecated?: boolean;
}

export type OpenApiParameterOrRef = OpenApiParameter | OpenApiReference;
export type OpenApiRequestBodyOrRef = OpenApiRequestBody | OpenApiReference;
export type OpenApiResponseOrRef = OpenApiResponse | OpenApiReference;
export type OpenApiSchemaOrRef = OpenApiSchema | OpenApiReference;
export type OpenApiExampleOrRef = OpenApiExample | OpenApiReference;

export interface OpenApiReference {
  readonly $ref: string;
}

export interface OpenApiParameter {
  readonly name: string;
  readonly in: 'query' | 'header' | 'path' | 'cookie';
  readonly description?: string;
  readonly required?: boolean;
  readonly deprecated?: boolean;
  readonly schema?: OpenApiSchemaOrRef;
  readonly example?: unknown;
  readonly examples?: Readonly<Record<string, OpenApiExampleOrRef | undefined>>;
  readonly content?: Readonly<Record<string, OpenApiMediaType | undefined>>;
}

export interface OpenApiRequestBody {
  readonly description?: string;
  readonly required?: boolean;
  readonly content?: Readonly<Record<string, OpenApiMediaType | undefined>>;
}

export interface OpenApiResponse {
  readonly description?: string;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly content?: Readonly<Record<string, OpenApiMediaType | undefined>>;
  readonly links?: Readonly<Record<string, unknown>>;
}

export interface OpenApiMediaType {
  readonly schema?: OpenApiSchemaOrRef;
  readonly example?: unknown;
  readonly examples?: Readonly<Record<string, OpenApiExampleOrRef | undefined>>;
  readonly encoding?: Readonly<Record<string, unknown>>;
}

export interface OpenApiExample {
  readonly summary?: string;
  readonly description?: string;
  readonly value?: unknown;
  readonly externalValue?: string;
}

export interface OpenApiSchema {
  readonly type?: string | readonly string[];
  readonly format?: string;
  readonly title?: string;
  readonly description?: string;
  readonly default?: unknown;
  readonly example?: unknown;
  readonly examples?: readonly unknown[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly nullable?: boolean;
  readonly readOnly?: boolean;
  readonly writeOnly?: boolean;
  readonly deprecated?: boolean;
  readonly properties?: Readonly<Record<string, OpenApiSchemaOrRef | undefined>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | OpenApiSchemaOrRef;
  readonly items?: OpenApiSchemaOrRef;
  readonly allOf?: readonly OpenApiSchemaOrRef[];
  readonly oneOf?: readonly OpenApiSchemaOrRef[];
  readonly anyOf?: readonly OpenApiSchemaOrRef[];
  readonly not?: OpenApiSchemaOrRef;
  readonly $ref?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly xml?: Readonly<Record<string, unknown>>;
  readonly discriminator?: Readonly<Record<string, unknown>>;
  readonly externalDocs?: OpenApiExternalDocs;
}

export interface OpenApiComponents {
  readonly schemas?: Readonly<Record<string, OpenApiSchemaOrRef | undefined>>;
  readonly responses?: Readonly<Record<string, OpenApiResponseOrRef | undefined>>;
  readonly parameters?: Readonly<
    Record<string, OpenApiParameterOrRef | undefined>
  >;
  readonly examples?: Readonly<Record<string, OpenApiExampleOrRef | undefined>>;
  readonly requestBodies?: Readonly<
    Record<string, OpenApiRequestBodyOrRef | undefined>
  >;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly securitySchemes?: Readonly<
    Record<string, OpenApiSecuritySchemeOrRef | undefined>
  >;
  readonly links?: Readonly<Record<string, unknown>>;
  readonly callbacks?: Readonly<Record<string, unknown>>;
  readonly pathItems?: Readonly<Record<string, OpenApiPathItem | undefined>>;
}

export type OpenApiSecuritySchemeOrRef =
  | OpenApiSecurityScheme
  | OpenApiReference;

export type OpenApiSecurityScheme =
  | OpenApiHttpSecurityScheme
  | OpenApiApiKeySecurityScheme
  | OpenApiOAuth2SecurityScheme
  | OpenApiOpenIdConnectSecurityScheme
  | OpenApiMutualTlsSecurityScheme;

export interface OpenApiHttpSecurityScheme {
  readonly type: 'http';
  readonly scheme: string;
  readonly bearerFormat?: string;
  readonly description?: string;
}

export interface OpenApiApiKeySecurityScheme {
  readonly type: 'apiKey';
  readonly name: string;
  readonly in: 'header' | 'query' | 'cookie';
  readonly description?: string;
}

export interface OpenApiOAuth2SecurityScheme {
  readonly type: 'oauth2';
  readonly flows: Readonly<Record<string, unknown>>;
  readonly description?: string;
}

export interface OpenApiOpenIdConnectSecurityScheme {
  readonly type: 'openIdConnect';
  readonly openIdConnectUrl: string;
  readonly description?: string;
}

export interface OpenApiMutualTlsSecurityScheme {
  readonly type: 'mutualTLS';
  readonly description?: string;
}

/** Map of scheme name → empty array (optional scopes) or scope list. */
export type OpenApiSecurityRequirement = Readonly<
  Record<string, readonly string[] | undefined>
>;

export function isReference(value: unknown): value is OpenApiReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { $ref?: unknown }).$ref === 'string' &&
    ((value as { $ref: string }).$ref.length > 0)
  );
}
