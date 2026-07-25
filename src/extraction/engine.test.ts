import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { TestReport } from '../assertions';
import type { ExecutionResult } from '../execution';
import { freezeDetachedBytes } from '../shared';
import { MASKED_VARIABLE_VALUE } from '../variables';
import { DefaultExtractionEngine } from './engine';
import type {
  ExtractionContext,
  ExtractionRule,
  VariableWriteRequest,
  VariableWriteResult,
} from './models';
import type { VariableWriter } from './variable-writer';
import { NoOpVariableWriter } from './variable-writer';

const TIMING = Object.freeze({
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:00.001Z',
  durationMs: 1,
});

function successResult(options?: {
  readonly statusCode?: number;
  readonly json?: unknown;
  readonly headers?: readonly { readonly name: string; readonly value: string }[];
  readonly contentType?: string;
}): ExecutionResult {
  const statusCode = options?.statusCode ?? 200;
  return {
    success: true,
    requestId: 'r1',
    response: {
      requestId: 'r1',
      statusCode,
      statusText: 'OK',
      headers: [...(options?.headers ?? [])],
      body: {
        bytes: freezeDetachedBytes(new Uint8Array(0)),
        ...(options?.json === undefined
          ? {}
          : { json: options.json as never }),
      },
      bodySizeBytes: 0,
      ...(options?.contentType === undefined
        ? {}
        : { contentType: options.contentType }),
      url: 'https://example.test/',
      redirected: false,
      redirectCount: 0,
      timing: TIMING,
    },
    timing: TIMING,
  };
}

function rule(partial: Partial<ExtractionRule> & Pick<ExtractionRule, 'variableName' | 'source'>): ExtractionRule {
  return {
    id: partial.id ?? `extract_${partial.variableName}`,
    variableName: partial.variableName,
    source: partial.source,
    targetScope: partial.targetScope ?? 'run',
    sensitive: partial.sensitive ?? false,
    required: partial.required ?? true,
    enabled: partial.enabled ?? true,
    when: partial.when ?? { kind: 'always' },
  };
}

function context(
  result: ExecutionResult,
  assertionReport?: TestReport,
): ExtractionContext {
  return {
    result,
    requestKey: 'request:test#0',
    ...(assertionReport === undefined ? {} : { assertionReport }),
  };
}

class RecordingWriter implements VariableWriter {
  public readonly writes: VariableWriteRequest[] = [];
  public nextResult: VariableWriteResult = { ok: true };
  public throwOnWrite = false;

  public async write(request: VariableWriteRequest): Promise<VariableWriteResult> {
    this.writes.push(request);
    if (this.throwOnWrite) {
      throw new Error('writer boom');
    }
    return this.nextResult;
  }
}

describe('DefaultExtractionEngine', () => {
  const engine = new DefaultExtractionEngine();

  test('extracts json-path value and writes via VariableWriter', async () => {
    const writer = new RecordingWriter();
    const report = await engine.apply(
      [
        rule({
          variableName: 'token',
          source: { kind: 'json-path', path: 'body.access_token' },
        }),
      ],
      context(successResult({ json: { access_token: 'secret' } })),
      writer,
    );

    assert.equal(report.extractedCount, 1);
    assert.equal(report.failedCount, 0);
    assert.deepEqual(writer.writes, [
      {
        name: 'token',
        value: 'secret',
        scope: 'run',
        sensitive: false,
      },
    ]);
    assert.equal(report.outcomes[0]?.kind, 'extracted');
    assert.equal(report.outcomes[0]?.maskedValue, 'secret');
  });

  test('required miss → failed; optional miss → skipped', async () => {
    const writer = new RecordingWriter();
    const report = await engine.apply(
      [
        rule({
          variableName: 'required',
          source: { kind: 'json-path', path: 'body.missing' },
          required: true,
        }),
        rule({
          variableName: 'optional',
          source: { kind: 'json-path', path: 'body.missing' },
          required: false,
        }),
      ],
      context(successResult({ json: {} })),
      writer,
    );

    assert.equal(report.failedCount, 1);
    assert.equal(report.skippedCount, 1);
    assert.equal(writer.writes.length, 0);
    assert.equal(report.outcomes[0]?.kind, 'failed');
    assert.equal(report.outcomes[1]?.kind, 'skipped');
  });

  test('when filters skip non-matching rules', async () => {
    const writer = new RecordingWriter();
    const report = await engine.apply(
      [
        rule({
          variableName: 'only2xx',
          source: { kind: 'status' },
          when: { kind: 'status', spec: '2xx' },
        }),
        rule({
          variableName: 'only404',
          source: { kind: 'status' },
          when: { kind: 'status', spec: '404' },
        }),
      ],
      context(successResult({ statusCode: 201 })),
      writer,
    );

    assert.equal(report.extractedCount, 1);
    assert.equal(report.skippedCount, 1);
    assert.equal(report.outcomes[0]?.kind, 'extracted');
    assert.equal(report.outcomes[1]?.kind, 'skipped');
    assert.equal(report.outcomes[1]?.reason, 'when');
  });

  test('assertions:pass treats missing report as pass', async () => {
    const writer = new RecordingWriter();
    const report = await engine.apply(
      [
        rule({
          variableName: 'code',
          source: { kind: 'status' },
          when: { kind: 'assertions-pass' },
        }),
      ],
      context(successResult()),
      writer,
    );
    assert.equal(report.extractedCount, 1);
  });

  test('write failure → failed without throwing', async () => {
    const writer = new RecordingWriter();
    writer.nextResult = {
      ok: false,
      code: 'NOT_IMPLEMENTED',
      message: 'nope',
    };
    const report = await engine.apply(
      [
        rule({
          variableName: 'code',
          source: { kind: 'status' },
        }),
      ],
      context(successResult()),
      writer,
    );
    assert.equal(report.failedCount, 1);
    assert.equal(report.outcomes[0]?.reason, 'nope');
    assert.equal(report.outcomes[0]?.writeOk, false);
  });

  test('writer throw is caught as failed', async () => {
    const writer = new RecordingWriter();
    writer.throwOnWrite = true;
    const report = await engine.apply(
      [
        rule({
          variableName: 'code',
          source: { kind: 'status' },
        }),
      ],
      context(successResult()),
      writer,
    );
    assert.equal(report.failedCount, 1);
    assert.equal(report.outcomes[0]?.reason, 'writer boom');
  });

  test('cancelled / no response handling', async () => {
    const writer = new RecordingWriter();
    const cancelled = await engine.apply(
      [rule({ variableName: 'a', source: { kind: 'status' } })],
      context({
        success: false,
        requestId: 'r1',
        error: { code: 'CANCELLED', message: 'Cancelled.', retryable: false },
        timing: TIMING,
      }),
      writer,
    );
    assert.equal(cancelled.failedCount, 1);
    assert.equal(cancelled.outcomes[0]?.reason, 'cancelled');

    const network = await engine.apply(
      [
        rule({
          variableName: 'b',
          source: { kind: 'header', name: 'X-Id' },
          required: false,
        }),
      ],
      context({
        success: false,
        requestId: 'r1',
        error: { code: 'NETWORK', message: 'down', retryable: true },
        timing: TIMING,
      }),
      writer,
    );
    assert.equal(network.skippedCount, 1);
    assert.equal(writer.writes.length, 0);
  });

  test('sensitive values are masked in the report', async () => {
    const writer = new RecordingWriter();
    const report = await engine.apply(
      [
        rule({
          variableName: 'token',
          source: { kind: 'json-path', path: 'body.token' },
          sensitive: true,
        }),
      ],
      context(successResult({ json: { token: 'raw-secret' } })),
      writer,
    );
    assert.equal(report.outcomes[0]?.maskedValue, MASKED_VARIABLE_VALUE);
    assert.equal(writer.writes[0]?.value, 'raw-secret');
  });

  test('disabled rules are skipped', async () => {
    const writer = new RecordingWriter();
    const report = await engine.apply(
      [
        rule({
          variableName: 'off',
          source: { kind: 'status' },
          enabled: false,
        }),
      ],
      context(successResult()),
      writer,
    );
    assert.equal(report.skippedCount, 1);
    assert.equal(report.outcomes[0]?.reason, 'disabled');
  });

  test('NoOpVariableWriter yields failed write outcome', async () => {
    const report = await engine.apply(
      [rule({ variableName: 'code', source: { kind: 'status' } })],
      context(successResult()),
      new NoOpVariableWriter(),
    );
    assert.equal(report.failedCount, 1);
    assert.match(report.outcomes[0]?.reason ?? '', /not implemented/i);
  });

  test('content-type when uses response content type', async () => {
    const writer = new RecordingWriter();
    const report = await engine.apply(
      [
        rule({
          variableName: 'jsonOnly',
          source: { kind: 'status' },
          when: { kind: 'content-type', mime: 'application/json' },
        }),
      ],
      context(
        successResult({
          contentType: 'application/json; charset=utf-8',
        }),
      ),
      writer,
    );
    assert.equal(report.extractedCount, 1);
  });
});
