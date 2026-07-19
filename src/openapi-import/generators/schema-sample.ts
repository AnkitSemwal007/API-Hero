/**
 * Derives JSON sample values from OpenAPI schemas for request bodies.
 * Prefer explicit examples when present; otherwise stub from type/format.
 */

import type { ImportDiagnostic, ImportLimits } from '../models';
import { DEFAULT_IMPORT_LIMITS } from '../models';
import type { OpenApiRefResolver } from '../openapi/resolve';
import type { OpenApiSchema, OpenApiSchemaOrRef } from '../openapi/types';
import { isReference } from '../openapi/types';

export interface SchemaSampleOptions {
  readonly limits?: Partial<ImportLimits>;
  readonly resolver: OpenApiRefResolver;
}

export interface SchemaSampleResult {
  readonly value: unknown;
  readonly diagnostics: readonly ImportDiagnostic[];
}

/** Builds a JSON-serializable sample from a schema or `$ref`. */
export function buildSchemaSample(
  schemaOrRef: OpenApiSchemaOrRef | undefined,
  options: SchemaSampleOptions,
  stack: readonly string[] = [],
): SchemaSampleResult {
  const diagnostics: ImportDiagnostic[] = [];
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...options.limits };

  if (schemaOrRef === undefined) {
    return { value: {}, diagnostics };
  }

  if (isReference(schemaOrRef)) {
    if (stack.includes(schemaOrRef.$ref)) {
      diagnostics.push({
        code: 'circular-schema',
        severity: 'warning',
        path: schemaOrRef.$ref,
        message: `Circular schema at ${schemaOrRef.$ref}; emitting null.`,
      });
      return { value: null, diagnostics };
    }
    if (stack.length >= limits.maxSchemaDepth) {
      diagnostics.push({
        code: 'schema-depth-exceeded',
        severity: 'warning',
        path: schemaOrRef.$ref,
        message: `Schema sample depth exceeded at ${schemaOrRef.$ref}.`,
      });
      return { value: null, diagnostics };
    }
    const resolved = options.resolver.resolveRef<OpenApiSchema>(
      schemaOrRef.$ref,
      stack,
    );
    diagnostics.push(...resolved.diagnostics);
    if (resolved.circular || resolved.value === undefined) {
      return { value: null, diagnostics };
    }
    return buildSchemaSample(resolved.value, options, [
      ...stack,
      schemaOrRef.$ref,
    ]);
  }

  const schema = schemaOrRef;

  if (schema.example !== undefined) {
    return { value: schema.example, diagnostics };
  }
  if (schema.examples !== undefined && schema.examples.length > 0) {
    return { value: schema.examples[0], diagnostics };
  }
  if (schema.default !== undefined) {
    return { value: schema.default, diagnostics };
  }
  if (schema.const !== undefined) {
    return { value: schema.const, diagnostics };
  }
  if (schema.enum !== undefined && schema.enum.length > 0) {
    return { value: schema.enum[0], diagnostics };
  }

  if (schema.allOf !== undefined && schema.allOf.length > 0) {
    const merged: Record<string, unknown> = {};
    for (const part of schema.allOf) {
      const sample = buildSchemaSample(part, options, stack);
      diagnostics.push(...sample.diagnostics);
      if (
        sample.value !== null &&
        typeof sample.value === 'object' &&
        !Array.isArray(sample.value)
      ) {
        Object.assign(merged, sample.value);
      }
    }
    return { value: merged, diagnostics };
  }

  if (schema.oneOf !== undefined && schema.oneOf.length > 0) {
    return buildSchemaSample(schema.oneOf[0], options, stack);
  }
  if (schema.anyOf !== undefined && schema.anyOf.length > 0) {
    return buildSchemaSample(schema.anyOf[0], options, stack);
  }

  const typeName = primaryType(schema.type);

  switch (typeName) {
    case 'object':
      return sampleObject(schema, options, stack, diagnostics);
    case 'array': {
      const items = schema.items;
      if (items === undefined) {
        return { value: [], diagnostics };
      }
      const item = buildSchemaSample(items, options, stack);
      diagnostics.push(...item.diagnostics);
      return { value: [item.value], diagnostics };
    }
    case 'string':
      return { value: sampleString(schema), diagnostics };
    case 'number':
    case 'integer':
      return {
        value: schema.minimum ?? schema.maximum ?? 0,
        diagnostics,
      };
    case 'boolean':
      return { value: false, diagnostics };
    case 'null':
      return { value: null, diagnostics };
    default:
      if (schema.properties !== undefined) {
        return sampleObject(schema, options, stack, diagnostics);
      }
      if (schema.items !== undefined) {
        const item = buildSchemaSample(schema.items, options, stack);
        diagnostics.push(...item.diagnostics);
        return { value: [item.value], diagnostics };
      }
      return { value: null, diagnostics };
  }
}

function sampleObject(
  schema: OpenApiSchema,
  options: SchemaSampleOptions,
  stack: readonly string[],
  diagnostics: ImportDiagnostic[],
): SchemaSampleResult {
  const result: Record<string, unknown> = {};
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const keys = Object.keys(properties);
  const selected =
    required.size > 0
      ? keys.filter((key) => required.has(key))
      : keys.slice(0, 8);

  for (const key of selected.length > 0 ? selected : keys.slice(0, 5)) {
    const property = properties[key];
    if (property === undefined) {
      continue;
    }
    const sample = buildSchemaSample(property, options, stack);
    diagnostics.push(...sample.diagnostics);
    result[key] = sample.value;
  }

  return { value: result, diagnostics };
}

function primaryType(
  type: string | readonly string[] | undefined,
): string | undefined {
  if (typeof type === 'string') {
    return type;
  }
  if (Array.isArray(type)) {
    return type.find((item) => item !== 'null') ?? type[0];
  }
  return undefined;
}

function sampleString(schema: OpenApiSchema): string {
  switch (schema.format) {
    case 'date':
      return '2024-01-15';
    case 'date-time':
      return '2024-01-15T12:00:00Z';
    case 'email':
      return 'user@example.com';
    case 'uuid':
      return '00000000-0000-4000-8000-000000000000';
    case 'uri':
    case 'url':
      return 'https://example.com';
    case 'password':
      return '';
    case 'byte':
      return '';
    case 'binary':
      return '';
    default:
      return schema.title ?? 'string';
  }
}
