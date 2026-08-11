/**
 * Human and JSON CLI output.
 * Prefer payloads already redacted by mcpOk; JSON envelopes also pass
 * through redactForMcp for defense-in-depth.
 */

import { redactForMcp } from '../mcp/redact';
import type { McpRequestRunDto, McpRunSummaryDto, McpScenarioRunDto } from '../mcp/dto';
import type { CliRunTargetType } from './parse-args';

export interface CliEnvelope {
  readonly ok: boolean;
  readonly target: { readonly type: CliRunTargetType; readonly name: string };
  readonly status: string;
  readonly statistics?: unknown;
  readonly steps?: unknown;
  readonly data?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export function formatHelp(text: string): string {
  return text.trimEnd() + '\n';
}

export function formatCliEnvelopeJson(envelope: CliEnvelope): string {
  return `${JSON.stringify(redactForMcp(envelope), undefined, 2)}\n`;
}

export function formatErrorHuman(message: string): string {
  return `Error: ${message}\n`;
}

export function formatRequestHuman(
  data: McpRequestRunDto,
  options: { readonly quiet: boolean },
): string {
  const ok = data.status === 'passed' || data.status === 'success';
  if (options.quiet && ok) {
    return `Result: PASSED\n`;
  }
  const lines: string[] = ['API Hero', `Request: ${data.label}`, ''];
  const mark = ok ? '✓' : '✗';
  const duration =
    data.durationMs === undefined ? '' : ` ${padDuration(data.durationMs)}`;
  lines.push(`${mark} ${data.label}${duration}`);
  if (!ok) {
    if (data.httpStatus !== undefined) {
      lines.push(`  Status: ${data.httpStatus}`);
    }
    if (data.message !== undefined && data.message.length > 0) {
      lines.push(`  ${data.message}`);
    }
    if (data.assertions?.expected !== undefined) {
      lines.push(
        `  Assertion failed: expected ${data.assertions.expected}` +
          (data.assertions.actual !== undefined
            ? ` == ${data.assertions.actual}`
            : ''),
      );
    }
  }
  lines.push('');
  lines.push(`Result: ${ok ? 'PASSED' : 'FAILED'}`);
  if (data.durationMs !== undefined) {
    lines.push(`Duration: ${data.durationMs}ms`);
  }
  return `${lines.join('\n')}\n`;
}

export function formatCollectionHuman(
  data: McpRunSummaryDto,
  options: { readonly quiet: boolean },
): string {
  const ok = data.failed === 0 && data.status !== 'failed';
  if (options.quiet && ok) {
    return `Result: PASSED\n`;
  }
  const lines: string[] = [
    'API Hero',
    `Collection: ${data.collection}`,
    '',
  ];
  for (const request of data.requests) {
    const passed =
      request.status === 'passed' || request.status === 'success';
    const skipped = request.status === 'skipped';
    const mark = skipped ? '○' : passed ? '✓' : '✗';
    const duration =
      request.durationMs === undefined
        ? ''
        : ` ${padDuration(request.durationMs)}`;
    lines.push(`${mark} ${request.label}${duration}`);
    if (!passed && !skipped) {
      if (request.httpStatus !== undefined) {
        lines.push(`  Status: ${request.httpStatus}`);
      }
      if (request.message !== undefined && request.message.length > 0) {
        lines.push(`  ${request.message}`);
      }
      if (request.assertions?.expected !== undefined) {
        lines.push(
          `  Assertion failed: expected ${request.assertions.expected}` +
            (request.assertions.actual !== undefined
              ? ` == ${request.assertions.actual}`
              : ''),
        );
      }
    }
  }
  lines.push('');
  lines.push(`Result: ${ok ? 'PASSED' : 'FAILED'}`);
  lines.push(`Passed: ${data.passed}`);
  lines.push(`Failed: ${data.failed}`);
  lines.push(`Skipped: ${data.skipped}`);
  lines.push(`Duration: ${data.durationMs}ms`);
  return `${lines.join('\n')}\n`;
}

export function formatScenarioHuman(
  data: McpScenarioRunDto,
  options: { readonly quiet: boolean },
): string {
  const ok = data.status !== 'failed' && data.statistics.failed === 0;
  if (options.quiet && ok) {
    return `Result: PASSED\n`;
  }
  const lines: string[] = [
    'API Hero',
    `Scenario: ${data.scenarioName}`,
    '',
  ];
  for (const step of data.steps) {
    const passed = step.status === 'completed' || step.status === 'passed';
    const skipped = step.status === 'skipped';
    const mark = skipped ? '○' : passed ? '✓' : '✗';
    lines.push(`${mark} ${step.stepName} ${padDuration(step.durationMs)}`);
    if (!passed && !skipped) {
      if (step.error?.message !== undefined) {
        lines.push(`  ${step.error.message}`);
      }
    }
  }
  lines.push('');
  lines.push(`Result: ${ok ? 'PASSED' : 'FAILED'}`);
  lines.push(`Completed: ${data.statistics.completed}`);
  lines.push(`Failed: ${data.statistics.failed}`);
  lines.push(`Skipped: ${data.statistics.skipped}`);
  lines.push(`Duration: ${data.durationMs}ms`);
  return `${lines.join('\n')}\n`;
}

function padDuration(ms: number): string {
  return `${String(ms).padStart(4, ' ')}ms`;
}

export function buildRequestEnvelope(
  target: string,
  data: McpRequestRunDto,
): CliEnvelope {
  const ok = data.status === 'passed' || data.status === 'success';
  return redactForMcp({
    ok,
    target: { type: 'request', name: target },
    status: data.status,
    data,
  });
}

export function buildCollectionEnvelope(
  target: string,
  data: McpRunSummaryDto,
): CliEnvelope {
  const ok = data.failed === 0 && data.status !== 'failed';
  return redactForMcp({
    ok,
    target: { type: 'collection', name: target },
    status: data.status,
    statistics: {
      total: data.total,
      passed: data.passed,
      failed: data.failed,
      skipped: data.skipped,
      cancelled: data.cancelled,
      durationMs: data.durationMs,
      assertions: data.assertions,
    },
    data,
  });
}

export function buildScenarioEnvelope(
  target: string,
  data: McpScenarioRunDto,
): CliEnvelope {
  const ok = data.status !== 'failed' && data.statistics.failed === 0;
  return redactForMcp({
    ok,
    target: { type: 'scenario', name: target },
    status: data.status,
    statistics: data.statistics,
    steps: data.steps,
    data,
  });
}

export function buildErrorEnvelope(
  targetType: CliRunTargetType,
  target: string,
  error: { readonly code: string; readonly message: string },
): CliEnvelope {
  return redactForMcp({
    ok: false,
    target: { type: targetType, name: target },
    status: 'error',
    error,
  });
}
