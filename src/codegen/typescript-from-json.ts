/**
 * Framework-free TypeScript type generation from one observed JSON value.
 *
 * Inferred types are illustrative of a single sample — not a complete API schema.
 * Type / interface names are derived from JSON keys only (never from string values).
 */

import { sanitizeHoverLabel } from '../shared/request-hover';

/** Options for {@link generateTypeScriptFromJson}. */
export interface GenerateTypeScriptOptions {
  /** Root interface or type alias name. Default `Root`. */
  readonly rootName?: string;
  /**
   * When true (default), emit `interface` for object shapes and `type` for
   * unions / arrays / primitives at the root.
   */
  readonly preferInterface?: boolean;
  /** Max object/array nesting depth before falling back to `unknown`. Default 32. */
  readonly maxDepth?: number;
  /**
   * Optional request attribution written into the generated file header.
   * Names and relative `.api` paths only — never URLs, headers, or secrets.
   */
  readonly attribution?: {
    readonly requestName?: string;
    readonly requestPath?: string;
  };
}

/** Successful generation result. */
export interface GenerateTypeScriptResult {
  /** Full TypeScript source (disclaimer + declarations). */
  readonly code: string;
  /** Resolved root type / interface name. */
  readonly rootName: string;
  /** Declaration names in emission order (dependencies before dependents). */
  readonly declarationNames: readonly string[];
}

export interface GenerateTypeScriptParseError {
  readonly ok: false;
  readonly message: string;
}

export interface GenerateTypeScriptParseSuccess {
  readonly ok: true;
  readonly result: GenerateTypeScriptResult;
}

const DEFAULT_ROOT_NAME = 'Root';
const DEFAULT_MAX_DEPTH = 32;
const DISCLAIMER =
  'Inferred from one observed JSON response — not a complete API schema.';

const TS_RESERVED = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'as',
  'implements',
  'interface',
  'let',
  'package',
  'private',
  'protected',
  'public',
  'static',
  'yield',
  'any',
  'boolean',
  'constructor',
  'declare',
  'get',
  'module',
  'require',
  'number',
  'set',
  'string',
  'symbol',
  'type',
  'from',
  'of',
  'namespace',
  'keyof',
  'readonly',
  'unique',
  'unknown',
  'never',
  'object',
  'undefined',
  'async',
  'await',
]);

type PrimitiveKind = 'string' | 'number' | 'boolean' | 'null' | 'unknown';

type InferredType =
  | { readonly kind: 'primitive'; readonly name: PrimitiveKind }
  | { readonly kind: 'array'; readonly element: InferredType }
  | {
      readonly kind: 'object';
      readonly name: string;
      readonly properties: ReadonlyMap<string, ObjectProperty>;
    }
  | { readonly kind: 'union'; readonly members: readonly InferredType[] };

interface ObjectProperty {
  readonly type: InferredType;
  readonly optional: boolean;
}

interface NamedObject {
  readonly name: string;
  readonly properties: ReadonlyMap<string, ObjectProperty>;
}

/**
 * Parses JSON text and generates TypeScript declarations.
 * Returns a structured error when the text is not valid JSON.
 */
export function generateTypeScriptFromJsonText(
  text: string,
  options: GenerateTypeScriptOptions = {},
): GenerateTypeScriptParseSuccess | GenerateTypeScriptParseError {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: 'Response body is empty.' };
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'Invalid JSON.';
    return { ok: false, message: `Could not parse JSON: ${detail}` };
  }
  return { ok: true, result: generateTypeScriptFromJson(value, options) };
}

/** Generates TypeScript declarations from an already-parsed JSON value. */
export function generateTypeScriptFromJson(
  value: unknown,
  options: GenerateTypeScriptOptions = {},
): GenerateTypeScriptResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const preferInterface = options.preferInterface !== false;
  const rootName = sanitizeTypeName(options.rootName ?? DEFAULT_ROOT_NAME);

  const namedObjects: NamedObject[] = [];
  const usedNames = new Set<string>();

  const inferred = inferType(value, rootName, 0, maxDepth, {
    namedObjects,
    usedNames,
  });

  // Root non-object values emit `export type ${rootName} = ...`. Nested object
  // shapes inferred from array elements may have claimed the same name (e.g.
  // rootName "Mixed" / "Item") — rename them so the file stays valid TS.
  const rootInferred =
    inferred.kind === 'object'
      ? inferred
      : renameConflictingObjectName(inferred, rootName, namedObjects, usedNames);

  const lines: string[] = [
    `/**`,
    ` * ${DISCLAIMER}`,
    ` * Generated by API Hero.`,
    ...attributionCommentLines(options.attribution),
    ` */`,
    '',
  ];

  const byName = new Map(namedObjects.map((entry) => [entry.name, entry]));
  const referenced = collectReferencedObjectNames(rootInferred);
  // Stable emission: nested dependencies before the root object interface.
  const nestedNames = [...referenced].filter((name) => {
    if (rootInferred.kind === 'object' && name === rootInferred.name) {
      return false;
    }
    return byName.has(name);
  });

  const declarationNames: string[] = [];
  for (const name of nestedNames) {
    const named = byName.get(name);
    if (named === undefined) {
      continue;
    }
    lines.push(emitObjectDeclaration(named.name, named.properties, preferInterface));
    lines.push('');
    declarationNames.push(named.name);
  }

  if (rootInferred.kind === 'object') {
    lines.push(
      emitObjectDeclaration(rootInferred.name, rootInferred.properties, preferInterface),
    );
    lines.push('');
    declarationNames.push(rootInferred.name);
  } else {
    lines.push(`export type ${rootName} = ${renderType(rootInferred)};`);
    lines.push('');
    declarationNames.push(rootName);
  }

  return {
    code: `${lines.join('\n').trimEnd()}\n`,
    rootName: rootInferred.kind === 'object' ? rootInferred.name : rootName,
    declarationNames,
  };
}

/** True when `code` looks like valid-enough TypeScript for smoke checks. */
export function looksLikeValidGeneratedTypeScript(code: string): boolean {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (
    !/^(?:\/\*\*[\s\S]*?\*\/\s*)?(?:export\s+)?(?:interface|type)\s+[A-Za-z_$]/u.test(
      trimmed,
    )
  ) {
    return false;
  }
  let brace = 0;
  let bracket = 0;
  let paren = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    const next = trimmed[i + 1];
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '{') brace += 1;
    else if (ch === '}') brace -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    if (brace < 0 || bracket < 0 || paren < 0) {
      return false;
    }
  }
  return (
    brace === 0
    && bracket === 0
    && paren === 0
    && !inSingle
    && !inDouble
  );
}

/** Converts a JSON key into a PascalCase type name (keys only — never values). */
export function typeNameFromKey(key: string, fallback = 'Item'): string {
  return sanitizeTypeName(toPascalCase(key) || fallback);
}

function attributionCommentLines(
  attribution: GenerateTypeScriptOptions['attribution'],
): readonly string[] {
  if (attribution === undefined) {
    return [];
  }
  const lines: string[] = [];
  const name = attribution.requestName?.trim();
  if (name !== undefined && name.length > 0) {
    lines.push(` * @api-hero name: ${sanitizeAttributionValue(name)}`);
  }
  const path = attribution.requestPath?.trim();
  if (path !== undefined && path.length > 0) {
    lines.push(` * @api-hero request: ${sanitizeAttributionValue(path)}`);
  }
  return lines;
}

function sanitizeAttributionValue(value: string): string {
  return sanitizeHoverLabel(value.replace(/[\r\n]+/gu, ' '))
    .replace(/\/\*/gu, '')
    .replace(/\*\//gu, '')
    .trim();
}

/** Ensures a legal, non-reserved TypeScript type identifier. */
export function sanitizeTypeName(raw: string): string {
  let name = toPascalCase(raw.trim());
  if (name.length === 0) {
    name = DEFAULT_ROOT_NAME;
  }
  if (/^[0-9]/u.test(name)) {
    name = `T${name}`;
  }
  if (TS_RESERVED.has(name) || TS_RESERVED.has(name.toLowerCase())) {
    name = `${name}Type`;
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name)) {
    name = DEFAULT_ROOT_NAME;
  }
  return name;
}

interface InferContext {
  readonly namedObjects: NamedObject[];
  readonly usedNames: Set<string>;
}

function inferType(
  value: unknown,
  nameHint: string,
  depth: number,
  maxDepth: number,
  ctx: InferContext,
): InferredType {
  if (depth > maxDepth) {
    return { kind: 'primitive', name: 'unknown' };
  }
  if (value === null) {
    return { kind: 'primitive', name: 'null' };
  }
  const valueType = typeof value;
  if (valueType === 'string') {
    return { kind: 'primitive', name: 'string' };
  }
  if (valueType === 'number') {
    return { kind: 'primitive', name: 'number' };
  }
  if (valueType === 'boolean') {
    return { kind: 'primitive', name: 'boolean' };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return {
        kind: 'array',
        element: { kind: 'primitive', name: 'unknown' },
      };
    }
    const elementHint = singularizeTypeName(nameHint);
    let element = inferType(value[0], elementHint, depth + 1, maxDepth, ctx);
    for (let i = 1; i < value.length; i += 1) {
      element = mergeTypes(
        element,
        inferType(value[i], elementHint, depth + 1, maxDepth, ctx),
        elementHint,
        ctx,
      );
    }
    return { kind: 'array', element };
  }
  if (valueType === 'object') {
    const record = value as Record<string, unknown>;
    const properties = new Map<string, ObjectProperty>();
    for (const [key, child] of Object.entries(record)) {
      const childName = typeNameFromKey(key, 'Item');
      properties.set(key, {
        type: inferType(child, childName, depth + 1, maxDepth, ctx),
        optional: false,
      });
    }
    const name = allocateUniqueObjectName(nameHint, properties, ctx);
    return { kind: 'object', name, properties };
  }
  return { kind: 'primitive', name: 'unknown' };
}

function allocateUniqueObjectName(
  nameHint: string,
  properties: ReadonlyMap<string, ObjectProperty>,
  ctx: InferContext,
): string {
  const base = sanitizeTypeName(nameHint);
  for (const existing of ctx.namedObjects) {
    if (samePropertyShape(existing.properties, properties)) {
      return existing.name;
    }
  }
  const name = allocateName(base, ctx.usedNames);
  ctx.namedObjects.push({ name, properties });
  return name;
}

function allocateName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let index = 2;
  while (used.has(`${base}${index}`)) {
    index += 1;
  }
  const name = `${base}${index}`;
  used.add(name);
  return name;
}

/**
 * When the root emits a type alias named `rootName`, rename any nested object
 * declaration that already claimed that identifier.
 */
function renameConflictingObjectName(
  inferred: InferredType,
  rootName: string,
  namedObjects: NamedObject[],
  usedNames: Set<string>,
): InferredType {
  const index = namedObjects.findIndex((entry) => entry.name === rootName);
  if (index < 0) {
    return inferred;
  }
  const replacement = allocateName(`${rootName}Item`, usedNames);
  usedNames.delete(rootName);
  const previous = namedObjects[index]!;
  namedObjects[index] = { name: replacement, properties: previous.properties };
  return renameObjectReferences(inferred, rootName, replacement);
}

function renameObjectReferences(
  type: InferredType,
  from: string,
  to: string,
): InferredType {
  switch (type.kind) {
    case 'primitive':
      return type;
    case 'array':
      return {
        kind: 'array',
        element: renameObjectReferences(type.element, from, to),
      };
    case 'union':
      return {
        kind: 'union',
        members: type.members.map((member) =>
          renameObjectReferences(member, from, to),
        ),
      };
    case 'object': {
      const properties = new Map<string, ObjectProperty>();
      for (const [key, prop] of type.properties) {
        properties.set(key, {
          optional: prop.optional,
          type: renameObjectReferences(prop.type, from, to),
        });
      }
      return {
        kind: 'object',
        name: type.name === from ? to : type.name,
        properties,
      };
    }
  }
}

function samePropertyShape(
  left: ReadonlyMap<string, ObjectProperty>,
  right: ReadonlyMap<string, ObjectProperty>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, leftProp] of left) {
    const rightProp = right.get(key);
    if (rightProp === undefined) {
      return false;
    }
    if (leftProp.optional !== rightProp.optional) {
      return false;
    }
    if (!sameType(leftProp.type, rightProp.type)) {
      return false;
    }
  }
  return true;
}

function sameType(left: InferredType, right: InferredType): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case 'primitive':
      return left.name === (right as typeof left).name;
    case 'array':
      return sameType(left.element, (right as typeof left).element);
    case 'object':
      return samePropertyShape(
        left.properties,
        (right as typeof left).properties,
      );
    case 'union': {
      const rightUnion = right as typeof left;
      if (left.members.length !== rightUnion.members.length) {
        return false;
      }
      return left.members.every((member, index) =>
        sameType(member, rightUnion.members[index]!),
      );
    }
  }
}

function mergeTypes(
  left: InferredType,
  right: InferredType,
  nameHint: string,
  ctx: InferContext,
): InferredType {
  if (sameType(left, right)) {
    return left;
  }
  if (left.kind === 'object' && right.kind === 'object') {
    return mergeObjects(left, right, nameHint, ctx);
  }
  if (left.kind === 'array' && right.kind === 'array') {
    return {
      kind: 'array',
      element: mergeTypes(left.element, right.element, nameHint, ctx),
    };
  }
  const members = flattenUnion([
    ...flattenUnionMembers(left),
    ...flattenUnionMembers(right),
  ], nameHint, ctx);
  if (members.length === 1) {
    return members[0]!;
  }
  return { kind: 'union', members };
}

function mergeObjects(
  left: Extract<InferredType, { kind: 'object' }>,
  right: Extract<InferredType, { kind: 'object' }>,
  nameHint: string,
  ctx: InferContext,
): InferredType {
  const keys = new Set([...left.properties.keys(), ...right.properties.keys()]);
  const properties = new Map<string, ObjectProperty>();
  for (const key of keys) {
    const leftProp = left.properties.get(key);
    const rightProp = right.properties.get(key);
    if (leftProp !== undefined && rightProp !== undefined) {
      properties.set(key, {
        type: mergeTypes(
          leftProp.type,
          rightProp.type,
          typeNameFromKey(key),
          ctx,
        ),
        optional: leftProp.optional || rightProp.optional,
      });
    } else if (leftProp !== undefined) {
      properties.set(key, { type: leftProp.type, optional: true });
    } else if (rightProp !== undefined) {
      properties.set(key, { type: rightProp.type, optional: true });
    }
  }
  // Prefer an existing identical shape, else reuse the left name so merges
  // do not burn Item / Item2 / Item3 for a single logical type.
  for (const existing of ctx.namedObjects) {
    if (samePropertyShape(existing.properties, properties)) {
      return { kind: 'object', name: existing.name, properties: existing.properties };
    }
  }
  const preferredName = left.name || sanitizeTypeName(nameHint);
  const index = ctx.namedObjects.findIndex((entry) => entry.name === preferredName);
  if (index >= 0) {
    const updated: NamedObject = { name: preferredName, properties };
    ctx.namedObjects[index] = updated;
    return { kind: 'object', name: preferredName, properties };
  }
  const name = allocateUniqueObjectName(nameHint || preferredName, properties, ctx);
  return { kind: 'object', name, properties };
}

function flattenUnionMembers(type: InferredType): InferredType[] {
  if (type.kind === 'union') {
    return [...type.members];
  }
  return [type];
}

function flattenUnion(
  members: readonly InferredType[],
  nameHint: string,
  ctx: InferContext,
): InferredType[] {
  const result: InferredType[] = [];
  for (const member of members) {
    let merged = false;
    for (let i = 0; i < result.length; i += 1) {
      const existing = result[i]!;
      if (existing.kind === 'object' && member.kind === 'object') {
        result[i] = mergeObjects(existing, member, nameHint, ctx);
        merged = true;
        break;
      }
      if (sameType(existing, member)) {
        merged = true;
        break;
      }
    }
    if (!merged) {
      result.push(member);
    }
  }
  result.sort((a, b) => {
    const aNull = a.kind === 'primitive' && a.name === 'null' ? 1 : 0;
    const bNull = b.kind === 'primitive' && b.name === 'null' ? 1 : 0;
    return aNull - bNull;
  });
  return result;
}

function collectReferencedObjectNames(type: InferredType): Set<string> {
  const names = new Set<string>();
  const visit = (node: InferredType): void => {
    switch (node.kind) {
      case 'primitive':
        return;
      case 'array':
        visit(node.element);
        return;
      case 'union':
        for (const member of node.members) {
          visit(member);
        }
        return;
      case 'object':
        names.add(node.name);
        for (const prop of node.properties.values()) {
          visit(prop.type);
        }
        return;
    }
  };
  visit(type);
  return names;
}

function emitObjectDeclaration(
  name: string,
  properties: ReadonlyMap<string, ObjectProperty>,
  preferInterface: boolean,
): string {
  if (preferInterface) {
    return emitInterface(name, properties);
  }
  return emitTypeAliasObject(name, properties);
}

function emitInterface(
  name: string,
  properties: ReadonlyMap<string, ObjectProperty>,
): string {
  if (properties.size === 0) {
    return `export interface ${name} {}`;
  }
  const lines = [`export interface ${name} {`];
  for (const [key, prop] of properties) {
    const optional = prop.optional ? '?' : '';
    lines.push(
      `  ${formatPropertyName(key)}${optional}: ${renderType(prop.type)};`,
    );
  }
  lines.push('}');
  return lines.join('\n');
}

function emitTypeAliasObject(
  name: string,
  properties: ReadonlyMap<string, ObjectProperty>,
): string {
  if (properties.size === 0) {
    return `export type ${name} = Record<string, never>;`;
  }
  const lines = [`export type ${name} = {`];
  for (const [key, prop] of properties) {
    const optional = prop.optional ? '?' : '';
    lines.push(
      `  ${formatPropertyName(key)}${optional}: ${renderType(prop.type)};`,
    );
  }
  lines.push('};');
  return lines.join('\n');
}

function renderType(type: InferredType): string {
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'array': {
      const element = renderType(type.element);
      const needsParens = type.element.kind === 'union';
      return needsParens ? `(${element})[]` : `${element}[]`;
    }
    case 'object':
      return type.name;
    case 'union':
      return type.members.map((member) => renderType(member)).join(' | ');
  }
}

function formatPropertyName(key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)) {
    return key;
  }
  return JSON.stringify(key);
}

function toPascalCase(raw: string): string {
  const parts = raw
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/u)
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return '';
  }
  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function singularizeTypeName(name: string): string {
  const base = sanitizeTypeName(name);
  if (base.endsWith('ies') && base.length > 3) {
    return `${base.slice(0, -3)}y`;
  }
  if (
    base.endsWith('ses')
    || base.endsWith('xes')
    || base.endsWith('zes')
    || base.endsWith('ches')
    || base.endsWith('shes')
  ) {
    return base.slice(0, -2);
  }
  if (base.endsWith('s') && !base.endsWith('ss') && base.length > 1) {
    return base.slice(0, -1);
  }
  if (base === 'Root' || base === 'Items') {
    return 'Item';
  }
  return base === DEFAULT_ROOT_NAME ? 'Item' : base;
}
