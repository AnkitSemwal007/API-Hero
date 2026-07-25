import type {
  ExtractionRule,
  ExtractionSource,
  ExtractionWhen,
  VariableWriteTargetScope,
} from './models';

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;

const VALID_SCOPES = new Set<VariableWriteTargetScope>([
  'run',
  'document',
  'collection',
  'environment',
  'workspace',
]);

export type ParseExtractDirectiveInput = {
  readonly knownName: 'extract' | 'sensitive-extract';
  readonly value: string;
  readonly sourceText?: string;
  readonly id?: string;
};

export type ParseExtractDirectiveResult =
  | { readonly ok: true; readonly rule: ExtractionRule }
  | { readonly ok: false; readonly reason: string };

/**
 * Parses an `@extract` / `@sensitive-extract` directive value into an
 * {@link ExtractionRule} using ADR defaults (scope run, required, when always).
 */
export function parseExtractDirective(
  input: ParseExtractDirectiveInput,
): ParseExtractDirectiveResult {
  const trimmed = input.value.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'malformed: missing extract directive value' };
  }

  const fromMatch =
    /^([A-Za-z_][A-Za-z0-9_.-]*)\s+from\s+(\S[\s\S]*)$/u.exec(trimmed);
  if (fromMatch === null) {
    return {
      ok: false,
      reason: 'malformed: expected "name from source [options]"',
    };
  }

  const variableName = fromMatch[1]!;
  if (!VARIABLE_NAME.test(variableName)) {
    return {
      ok: false,
      reason: `malformed: invalid variable name "${variableName}"`,
    };
  }

  const split = splitSourceAndOptions(fromMatch[2]!.trim());
  if (split === undefined) {
    return { ok: false, reason: 'malformed: missing extraction source' };
  }

  const sourceResult = parseSource(split.source);
  if (!sourceResult.ok) {
    return sourceResult;
  }

  const optionsResult = parseOptions(split.options, input.knownName);
  if (!optionsResult.ok) {
    return optionsResult;
  }

  const rule: ExtractionRule = Object.freeze({
    id: input.id ?? `extract_${variableName}`,
    variableName,
    source: sourceResult.source,
    targetScope: optionsResult.targetScope,
    sensitive: optionsResult.sensitive,
    required: optionsResult.required,
    enabled: true,
    when: optionsResult.when,
    ...(input.sourceText !== undefined
      ? { sourceText: input.sourceText }
      : {}),
  });

  return { ok: true, rule };
}

function splitSourceAndOptions(
  rest: string,
): { readonly source: string; readonly options: readonly string[] } | undefined {
  const tokens = rest.split(/\s+/u).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return undefined;
  }

  let firstOption = -1;
  for (let index = 0; index < tokens.length; index += 1) {
    if (isOptionToken(tokens[index]!)) {
      firstOption = index;
      break;
    }
  }

  if (firstOption === 0) {
    return undefined;
  }

  const sourceTokens =
    firstOption < 0 ? tokens : tokens.slice(0, firstOption);
  const optionTokens =
    firstOption < 0 ? [] : tokens.slice(firstOption);

  return {
    source: sourceTokens.join(' '),
    options: optionTokens,
  };
}

function isOptionToken(token: string): boolean {
  return (
    token === 'optional' ||
    token === 'sensitive' ||
    token === 'required' ||
    token.startsWith('scope=') ||
    token.startsWith('when=')
  );
}

function parseSource(
  sourceText: string,
):
  | { readonly ok: true; readonly source: ExtractionSource }
  | { readonly ok: false; readonly reason: string } {
  if (sourceText === 'status') {
    return { ok: true, source: { kind: 'status' } };
  }

  if (sourceText.startsWith('header')) {
    const name = sourceText.slice('header'.length).trim();
    if (name.length === 0) {
      return { ok: false, reason: 'invalid-source: empty header name' };
    }
    return { ok: true, source: { kind: 'header', name } };
  }

  if (sourceText.toLowerCase().startsWith('body.')) {
    const path = sourceText.slice('body.'.length);
    if (path.trim().length === 0) {
      return { ok: false, reason: 'invalid-source: empty path' };
    }
    // Keep authored `body.…` so shared JSONPath can strip the prefix.
    return { ok: true, source: { kind: 'json-path', path: sourceText } };
  }

  return {
    ok: false,
    reason:
      'malformed: source must be body.<path>, header <name>, or status',
  };
}

function parseOptions(
  options: readonly string[],
  knownName: 'extract' | 'sensitive-extract',
):
  | {
      readonly ok: true;
      readonly targetScope: VariableWriteTargetScope;
      readonly sensitive: boolean;
      readonly required: boolean;
      readonly when: ExtractionWhen;
    }
  | { readonly ok: false; readonly reason: string } {
  let targetScope: VariableWriteTargetScope = 'run';
  let sensitive = knownName === 'sensitive-extract';
  let required = true;
  let when: ExtractionWhen = { kind: 'always' };

  for (const token of options) {
    if (token === 'optional') {
      required = false;
      continue;
    }
    if (token === 'required') {
      required = true;
      continue;
    }
    if (token === 'sensitive') {
      sensitive = true;
      continue;
    }
    if (token.startsWith('scope=')) {
      const scope = token.slice('scope='.length);
      if (scope === 'global') {
        return { ok: false, reason: 'forbidden-scope: global' };
      }
      if (!VALID_SCOPES.has(scope as VariableWriteTargetScope)) {
        return { ok: false, reason: `invalid-scope: ${scope}` };
      }
      targetScope = scope as VariableWriteTargetScope;
      continue;
    }
    if (token.startsWith('when=')) {
      const whenResult = parseWhen(token.slice('when='.length));
      if (!whenResult.ok) {
        return whenResult;
      }
      when = whenResult.when;
      continue;
    }
    return { ok: false, reason: `malformed: unknown option "${token}"` };
  }

  return { ok: true, targetScope, sensitive, required, when };
}

function parseWhen(
  value: string,
):
  | { readonly ok: true; readonly when: ExtractionWhen }
  | { readonly ok: false; readonly reason: string } {
  if (value === 'assertions:pass') {
    return { ok: true, when: { kind: 'assertions-pass' } };
  }
  if (value.startsWith('status:')) {
    const spec = value.slice('status:'.length);
    if (spec.length === 0) {
      return { ok: false, reason: 'malformed: empty when=status: spec' };
    }
    return { ok: true, when: { kind: 'status', spec } };
  }
  if (value.startsWith('content-type:')) {
    const mime = value.slice('content-type:'.length);
    if (mime.length === 0) {
      return { ok: false, reason: 'malformed: empty when=content-type: mime' };
    }
    return { ok: true, when: { kind: 'content-type', mime } };
  }
  return { ok: false, reason: `malformed: invalid when=${value}` };
}
