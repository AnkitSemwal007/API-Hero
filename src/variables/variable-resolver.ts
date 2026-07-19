import type {
  RuntimeBody,
  RuntimeJsonValue,
  RuntimeRequest,
  ResolvedRequest,
  VariableDefinition,
  VariableValue,
} from '../models';
import { deepFreeze, parseParameters, queryPart } from '../shared';

export const MASKED_VARIABLE_VALUE = '••••••••';
export const VARIABLE_DIAGNOSTIC_CODES = Object.freeze({
  duplicate: 'variables.duplicate-definition',
  missing: 'variables.missing',
  cycle: 'variables.cycle',
  unsupportedBuiltIn: 'variables.unsupported-built-in',
  malformedDefinition: 'variables.malformed-definition',
});

export type VariableResolutionErrorCode =
  | 'DUPLICATE_DEFINITION'
  | 'MISSING_VARIABLE'
  | 'CYCLE'
  | 'UNSUPPORTED_BUILT_IN'
  | 'MALFORMED_DEFINITION';

export interface VariableResolutionError {
  readonly code: VariableResolutionErrorCode;
  readonly variableName: string;
  readonly chain: readonly string[];
  readonly message: string;
}

/** Context captured once for one analysis or execution. */
export interface VariableResolutionContext {
  readonly definitions: readonly VariableDefinition[];
}

export interface VariableAnalysis {
  readonly values: ReadonlyMap<string, VariableValue>;
  readonly errors: readonly VariableResolutionError[];
}

export type RequestResolutionResult =
  | {
    readonly success: true;
    readonly request: ResolvedRequest;
    readonly values: ReadonlyMap<string, VariableValue>;
  }
  | {
    readonly success: false;
    readonly errors: readonly VariableResolutionError[];
    readonly values: ReadonlyMap<string, VariableValue>;
  };

/** Variable resolution boundary independent of parser and UI frameworks. */
export interface VariableResolver {
  analyze(context: VariableResolutionContext): VariableAnalysis;
  resolveRequest(
    request: RuntimeRequest,
    context: VariableResolutionContext,
  ): RequestResolutionResult;
}

const PRECEDENCE = Object.freeze({
  global: 0,
  workspace: 1,
  environment: 2,
  document: 3,
});
const REFERENCE = /\{\{(\$?[A-Za-z_][A-Za-z0-9_.-]*)\}\}/gu;
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;
const BUILT_INS = new Set(['$timestamp', '$uuid']);

export class DefaultVariableResolver implements VariableResolver {
  public analyze(context: VariableResolutionContext): VariableAnalysis {
    const errors: VariableResolutionError[] = [];
    const byScope = new Map<string, VariableDefinition>();
    const effective = new Map<string, VariableDefinition>();

    for (const definition of context.definitions) {
      if (!NAME.test(definition.name)) {
        errors.push(error(
          'MALFORMED_DEFINITION',
          definition.name,
          [definition.name],
          `Variable "${definition.name}" has an invalid definition.`,
        ));
        continue;
      }
      const scopeKey = `${definition.scope}:${definition.name}`;
      if (byScope.has(scopeKey)) {
        errors.push(error(
          'DUPLICATE_DEFINITION',
          definition.name,
          [definition.name],
          `Variable "${definition.name}" is defined more than once in ${definition.scope} scope.`,
        ));
        continue;
      }
      byScope.set(scopeKey, definition);
      const previous = effective.get(definition.name);
      if (previous === undefined ||
          PRECEDENCE[definition.scope] > PRECEDENCE[previous.scope]) {
        effective.set(definition.name, definition);
      }
    }

    const values = new Map<string, VariableValue>();
    const resolving: string[] = [];
    const failed = new Set<string>();
    const resolveDefinition = (name: string): VariableValue | undefined => {
      const cached = values.get(name);
      if (cached !== undefined) {
        return cached;
      }
      if (failed.has(name)) {
        return undefined;
      }
      const cycleStart = resolving.indexOf(name);
      if (cycleStart >= 0) {
        const chain = [...resolving.slice(cycleStart), name];
        errors.push(error(
          'CYCLE',
          name,
          chain,
          `Variable cycle detected: ${chain.join(' -> ')}.`,
        ));
        chain.forEach((entry) => failed.add(entry));
        return undefined;
      }
      const definition = effective.get(name);
      if (definition === undefined) {
        errors.push(unavailableVariableError(name, [...resolving, name]));
        failed.add(name);
        return undefined;
      }

      resolving.push(name);
      let sensitive = definition.sensitive;
      let valid = true;
      const value = definition.value.replace(REFERENCE, (_match, dependency: string) => {
        const resolved = resolveDefinition(dependency);
        if (resolved === undefined) {
          valid = false;
          return '';
        }
        sensitive ||= resolved.sensitive;
        return resolved.value;
      });
      resolving.pop();
      if (!valid || failed.has(name)) {
        failed.add(name);
        return undefined;
      }
      const resolved = deepFreeze({
        name,
        value,
        scope: definition.scope,
        sensitive,
      });
      values.set(name, resolved);
      return resolved;
    };

    for (const name of effective.keys()) {
      resolveDefinition(name);
    }
    return deepFreeze({ values: readonlyMap(values), errors });
  }

  public resolveRequest(
    request: RuntimeRequest,
    context: VariableResolutionContext,
  ): RequestResolutionResult {
    const analysis = this.analyze(context);
    const errors = [...analysis.errors];
    const usedErrors = new Map<string, VariableResolutionError>();
    const sensitiveNames = new Set<string>();
    const replace = (source: string, masked = false): string =>
      source.replace(REFERENCE, (_original, name: string) => {
        const value = analysis.values.get(name);
        if (value === undefined) {
          throw new Error(
            `Variable resolver invariant failed after validating "${name}".`,
          );
        }
        if (value.sensitive) {
          sensitiveNames.add(name);
        }
        return masked && value.sensitive ? MASKED_VARIABLE_VALUE : value.value;
      });

    const referencedNames = collectRequestReferences(request);
    for (const name of referencedNames) {
      if (!analysis.values.has(name)) {
        const unresolved =
          findResolutionError(errors, name) ?? unavailableVariableError(name);
        usedErrors.set(`${unresolved.code}:${unresolved.chain.join(':')}`, unresolved);
      }
    }
    const duplicateErrors = errors.filter((item) =>
      item.code === 'DUPLICATE_DEFINITION' && referencedNames.has(item.variableName));
    duplicateErrors.forEach((item) =>
      usedErrors.set(`${item.code}:${item.variableName}:${item.message}`, item));
    if (usedErrors.size > 0) {
      return deepFreeze({
        success: false,
        errors: [...usedErrors.values()],
        values: analysis.values,
      });
    }

    const url = replace(request.url);
    const body = resolveBody(request.body, replace);
    const resolved: ResolvedRequest = {
      ...request,
      ...(request.name === undefined ? {} : { name: replace(request.name) }),
      url,
      headers: request.headers.map((header) => ({
        name: replace(header.name),
        value: replace(header.value),
      })),
      queryParameters: parseParameters(queryPart(url)),
      pathParameters: [],
      cookies: request.cookies.map((cookie) => ({
        ...cookie,
        name: replace(cookie.name),
        ...(cookie.value === undefined ? {} : { value: replace(cookie.value) }),
        ...(cookie.domain === undefined ? {} : { domain: replace(cookie.domain) }),
        ...(cookie.path === undefined ? {} : { path: replace(cookie.path) }),
        extensions: resolveUnknown(cookie.extensions, replace),
      })),
      ...(body === undefined ? { body: undefined } : { body }),
      authentication: {
        ...request.authentication,
        ...(!('reference' in request.authentication) ||
          request.authentication.reference === undefined
          ? {}
          : { reference: replace(request.authentication.reference) }),
        extensions: resolveUnknown(request.authentication.extensions, replace),
      },
      variables: [],
      environment: {
        ...request.environment,
        ...(request.environment.reference === undefined
          ? {}
          : { reference: replace(request.environment.reference) }),
        extensions: resolveUnknown(request.environment.extensions, replace),
      },
      metadata: {
        ...request.metadata,
        ...(request.metadata.sourceId === undefined
          ? {}
          : { sourceId: replace(request.metadata.sourceId) }),
        ...(request.metadata.description === undefined
          ? {}
          : { description: replace(request.metadata.description) }),
        tags: request.metadata.tags.map((tag) => replace(tag)),
        extensions: resolveUnknown(request.metadata.extensions, replace),
      },
      configuration: {
        ...request.configuration,
        ...(request.configuration.connectionReference === undefined
          ? {}
          : { connectionReference: replace(request.configuration.connectionReference) }),
        directives: request.configuration.directives
          .filter((directive) =>
            directive.name !== 'variable' &&
            directive.name !== 'sensitive-variable')
          .map((directive) => ({
            name: replace(directive.name),
            value: replace(directive.value),
          })),
        extensions: resolveUnknown(request.configuration.extensions, replace),
      },
      ssl: {
        ...request.ssl,
        ...(request.ssl.clientCertificateReference === undefined
          ? {}
          : { clientCertificateReference: replace(request.ssl.clientCertificateReference) }),
        extensions: resolveUnknown(request.ssl.extensions, replace),
      },
      ...(request.proxy === undefined
        ? {}
        : {
          proxy: {
            ...request.proxy,
            ...(request.proxy.reference === undefined
              ? {}
              : { reference: replace(request.proxy.reference) }),
            extensions: resolveUnknown(request.proxy.extensions, replace),
          },
        }),
      ...(request.retry === undefined
        ? {}
        : {
          retry: {
            ...request.retry,
            extensions: resolveUnknown(request.retry.extensions, replace),
          },
        }),
      ...(request.streaming === undefined
        ? {}
        : {
          streaming: {
            ...request.streaming,
            extensions: resolveUnknown(request.streaming.extensions, replace),
          },
        }),
      executionExtensions: resolveUnknown(request.executionExtensions, replace),
      resolution: {
        kind: 'resolved',
        presentationUrl: replace(request.url, true),
        sensitiveVariableNames: [...sensitiveNames].sort(),
        sensitiveHeaderNames: [],
        sensitiveQueryParameterNames: [],
      },
    };
    return deepFreeze({
      success: true,
      request: resolved,
      values: analysis.values,
    });
  }
}

export function maskVariableValue(value: VariableValue): string {
  return value.sensitive ? MASKED_VARIABLE_VALUE : value.value;
}

function resolveBody(
  body: RuntimeBody | undefined,
  replace: (source: string) => string,
): RuntimeBody | undefined {
  if (body === undefined) {
    return undefined;
  }
  const content = replace(body.content);
  if (body.type === 'json') {
    let value: RuntimeJsonValue = resolveUnknown(body.value, replace);
    try {
      value = JSON.parse(content) as RuntimeJsonValue;
    } catch {
      // The executor sends authoritative content; syntax validation remains
      // parser-owned and no expression evaluation is attempted here.
    }
    return { ...body, content, value };
  }
  if (body.type === 'form') {
    return { ...body, content, fields: parseParameters(content) };
  }
  if (body.type === 'multipart') {
    return {
      ...body,
      content,
      parts: body.parts.map((part) => ({
        ...part,
        ...(part.name === undefined ? {} : { name: replace(part.name) }),
        headers: part.headers.map((header) => ({
          name: replace(header.name),
          value: replace(header.value),
        })),
        ...(part.content === undefined ? {} : { content: replace(part.content) }),
        ...(part.sourceReference === undefined
          ? {}
          : { sourceReference: replace(part.sourceReference) }),
        extensions: resolveUnknown(part.extensions, replace),
      })),
    };
  }
  return { ...body, content };
}

function collectRequestReferences(request: RuntimeRequest): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(REFERENCE)) {
        names.add(match[1]!);
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach(visit);
    }
  };
  visit({
    ...request,
    variables: [],
    configuration: {
      ...request.configuration,
      directives: request.configuration.directives.filter((directive) =>
        directive.name !== 'variable' &&
        directive.name !== 'sensitive-variable'),
    },
  });
  return names;
}

function resolveUnknown<T>(value: T, replace: (source: string) => string): T {
  if (typeof value === 'string') {
    return replace(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveUnknown(entry, replace)) as T;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      resolveUnknown(entry, replace),
    ])) as T;
  }
  return value;
}

function error(
  code: VariableResolutionErrorCode,
  variableName: string,
  chain: readonly string[],
  message: string,
): VariableResolutionError {
  return deepFreeze({ code, variableName, chain: [...chain], message });
}

function unavailableVariableError(
  name: string,
  chain: readonly string[] = [name],
): VariableResolutionError {
  if (BUILT_INS.has(name)) {
    return error(
      'UNSUPPORTED_BUILT_IN',
      name,
      chain,
      chain.length === 1
        ? `Built-in variable "${name}" is recognized but not supported.`
        : `Unsupported built-in variable reference: ${chain.join(' -> ')}.`,
    );
  }
  return error(
    'MISSING_VARIABLE',
    name,
    chain,
    chain.length === 1
      ? `Variable "${name}" is not defined.`
      : `Missing variable reference: ${chain.join(' -> ')}.`,
  );
}

function findResolutionError(
  errors: readonly VariableResolutionError[],
  name: string,
): VariableResolutionError | undefined {
  return errors.find((candidate) =>
    candidate.variableName === name || candidate.chain.includes(name));
}

function readonlyMap<K, V>(source: Map<K, V>): ReadonlyMap<K, V> {
  const copy = new Map(source);
  const view: ReadonlyMap<K, V> = {
    size: copy.size,
    get: (key) => copy.get(key),
    has: (key) => copy.has(key),
    forEach: (callback, thisArg) =>
      copy.forEach((value, key) => callback.call(thisArg, value, key, view)),
    entries: () => copy.entries(),
    keys: () => copy.keys(),
    values: () => copy.values(),
    [Symbol.iterator]: () => copy[Symbol.iterator](),
  };
  return Object.freeze(view);
}
