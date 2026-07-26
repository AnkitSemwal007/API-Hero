import type { ExecutionResult } from '../execution';
import { MASKED_VARIABLE_VALUE } from '../variables';
import { createDefaultExtractorRegistry } from './extractors/registry';
import type {
  ExtractionAssertionReport,
  ExtractionContext,
  ExtractionEngine,
  ExtractionOutcome,
  ExtractionReport,
  ExtractionRule,
  ExtractionSource,
  ExtractionWhen,
  ExtractorRegistry,
} from './models';
import type { VariableWriter } from './variable-writer';
import { coerceExtractionValue } from './value-coercion';

/**
 * Applies enabled extraction rules to an {@link ExecutionResult}, writes values
 * through {@link VariableWriter}, and builds a secret-safe report (P1 §5).
 */
export class DefaultExtractionEngine implements ExtractionEngine {
  public constructor(
    private readonly registry: ExtractorRegistry = createDefaultExtractorRegistry(),
  ) {}

  public async apply(
    rules: readonly ExtractionRule[],
    context: ExtractionContext,
    writer: VariableWriter,
  ): Promise<ExtractionReport> {
    const outcomes: ExtractionOutcome[] = [];

    for (const rule of rules) {
      outcomes.push(await this.applyOne(rule, context, writer));
    }

    return buildReport(outcomes);
  }

  private async applyOne(
    rule: ExtractionRule,
    context: ExtractionContext,
    writer: VariableWriter,
  ): Promise<ExtractionOutcome> {
    if (!rule.enabled) {
      return { rule, kind: 'skipped', reason: 'disabled' };
    }

    if (isCancelled(context.result)) {
      return {
        rule,
        kind: rule.required ? 'failed' : 'skipped',
        reason: 'cancelled',
      };
    }

    if (!hasResponseFor(rule.source, context.result)) {
      return {
        rule,
        kind: rule.required ? 'failed' : 'skipped',
        reason: 'No response available for extraction source.',
      };
    }

    if (!whenSatisfied(rule.when, context)) {
      return { rule, kind: 'skipped', reason: 'when' };
    }

    const extractor = this.registry.get(rule.source.kind);
    if (extractor === undefined) {
      return {
        rule,
        kind: 'failed',
        reason: `No extractor registered for kind "${rule.source.kind}".`,
      };
    }

    const extracted = extractor.extract(rule.source, context);
    if (!extracted.found) {
      return {
        rule,
        kind: rule.required ? 'failed' : 'skipped',
        reason: extracted.reason,
      };
    }

    const value = coerceExtractionValue(extracted.value);
    const maskedValue = rule.sensitive ? MASKED_VARIABLE_VALUE : value;

    try {
      const write = await writer.write({
        name: rule.variableName,
        value,
        scope: rule.targetScope,
        sensitive: rule.sensitive,
        ...(rule.targetScope === 'document'
          ? { requestKey: context.requestKey }
          : {}),
      });
      if (write.ok) {
        return {
          rule,
          kind: 'extracted',
          maskedValue,
          writeOk: true,
        };
      }
      return {
        rule,
        kind: 'failed',
        reason: write.message,
        writeOk: false,
        maskedValue,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Variable write failed.';
      return {
        rule,
        kind: 'failed',
        reason: message,
        writeOk: false,
        maskedValue,
      };
    }
  }
}

function isCancelled(result: ExecutionResult): boolean {
  return !result.success && result.error.code === 'CANCELLED';
}

function hasResponseFor(
  source: ExtractionSource,
  result: ExecutionResult,
): boolean {
  if (!result.success) {
    return false;
  }
  switch (source.kind) {
    case 'status':
    case 'header':
    case 'json-path':
      return true;
    default:
      return false;
  }
}

function whenSatisfied(
  when: ExtractionWhen,
  context: ExtractionContext,
): boolean {
  switch (when.kind) {
    case 'always':
      return context.result.success;
    case 'status':
      return context.result.success
        ? statusMatches(context.result.response.statusCode, when.spec)
        : false;
    case 'assertions-pass':
      return assertionsPass(context.assertionReport);
    case 'content-type':
      return context.result.success
        ? contentTypeContains(context.result.response, when.mime)
        : false;
    default:
      return false;
  }
}

function statusMatches(statusCode: number, spec: string): boolean {
  const trimmed = spec.trim().toLowerCase();
  if (/^\dxx$/u.test(trimmed)) {
    const hundreds = Number(trimmed[0]);
    const min = hundreds * 100;
    return statusCode >= min && statusCode <= min + 99;
  }
  const exact = Number(trimmed);
  return Number.isInteger(exact) && statusCode === exact;
}

function assertionsPass(report: ExtractionAssertionReport | undefined): boolean {
  if (report === undefined) {
    return true;
  }
  return report.summary.failed === 0 && report.summary.malformed === 0;
}

function contentTypeContains(
  response: { readonly contentType?: string; readonly headers: readonly { readonly name: string; readonly value: string }[] },
  mime: string,
): boolean {
  const needle = mime.trim().toLowerCase();
  if (needle.length === 0) {
    return false;
  }
  const fromField = response.contentType?.toLowerCase() ?? '';
  if (fromField.includes(needle)) {
    return true;
  }
  for (const header of response.headers) {
    if (header.name.toLowerCase() === 'content-type') {
      if (header.value.toLowerCase().includes(needle)) {
        return true;
      }
    }
  }
  return false;
}

function buildReport(outcomes: readonly ExtractionOutcome[]): ExtractionReport {
  let extractedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let malformedCount = 0;
  for (const outcome of outcomes) {
    switch (outcome.kind) {
      case 'extracted':
        extractedCount += 1;
        break;
      case 'failed':
        failedCount += 1;
        break;
      case 'skipped':
        skippedCount += 1;
        break;
      case 'malformed':
        malformedCount += 1;
        break;
    }
  }
  return {
    outcomes,
    extractedCount,
    failedCount,
    skippedCount,
    malformedCount,
  };
}
