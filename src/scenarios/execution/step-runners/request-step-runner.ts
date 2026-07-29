import type { CollectionRequestExecutorPort } from '../../../collection-runner';
import type { RunAtSourceLocationOptions, RunAtSourceLocationResult, RunRequestSource } from '../../../orchestration';
import type { ScenarioExecutionContext } from '../execution-context';
import type { ScenarioVariableResolver } from '../../variables/scenario-variable-resolver';

import {
  JsonPathExtractor,
  HeaderExtractor,
  StatusExtractor,
  isExtractableJsonPath,
  coerceExtractionValue,
  type ExtractionContext,
} from '../../../extraction';
import type { RequestStep, StepOutput as StepOutputModel, RetryPolicy } from '../../models';
import { StepCapability, StepRunStatus as StepRunStates, StepType as ScenarioStepType } from '../../models';
import type { ScenarioStepRunnerExecutionResult, ScenarioStepRunner } from '../step-registry';

/**
 * Small dependency surface for one request-step execution.
 */
export interface RequestStepRunnerPorts {
  readonly executor: CollectionRequestExecutorPort;
  readonly sourceReader: { readText(filePath: string): Promise<string> };
  readonly scenarioVariableResolver: ScenarioVariableResolver;
  readonly now: () => number;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function parseOutputSource(source: string):
  | { readonly kind: 'status' }
  | { readonly kind: 'header'; readonly name: string }
  | { readonly kind: 'json-path'; readonly path: string } {
  const trimmed = source.trim();
  if (trimmed.toLowerCase() === 'status') {
    return { kind: 'status' };
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('header')) {
    const name = trimmed.slice('header'.length).trim();
    return { kind: 'header', name };
  }
  if (!isExtractableJsonPath(trimmed)) {
    throw new Error(`Unsupported step output source "${source}".`);
  }
  return { kind: 'json-path', path: trimmed };
}

function buildExtractionContext(
  execution: RunAtSourceLocationResult['execution'],
  requestKey: string,
): ExtractionContext {
  if (execution === undefined) {
    throw new Error('Request execution did not return an execution result for extraction.');
  }
  return {
    result: execution,
    requestKey,
    activeEnvironmentId: undefined,
  };
}

function outputValueFromExecution(
  output: StepOutputModel,
  execution: RunAtSourceLocationResult['execution'],
  requestKey: string,
): string {
  if (output.source.includes('{{')) {
    // Expression-like output: resolve via scenario-variable-resolver in the runner.
    throw new Error('Expression outputs must be resolved by the scenario-variable-resolver.');
  }
  const source = parseOutputSource(output.source);
  const context = buildExtractionContext(execution, requestKey);
  if (source.kind === 'status') {
    const extracted = new StatusExtractor().extract({ kind: 'status' }, context);
    if (!extracted.found) throw new Error(extracted.reason);
    return coerceExtractionValue(extracted.value);
  }
  if (source.kind === 'header') {
    const headerExtractor = new HeaderExtractor();
    const extracted = headerExtractor.extract(
      { kind: 'header', name: source.name },
      context,
    );
    if (!extracted.found) throw new Error(extracted.reason);
    return coerceExtractionValue(extracted.value);
  }
  const extractor = new JsonPathExtractor();
  const extracted = extractor.extract(
    { kind: 'json-path', path: source.path },
    context,
  );
  if (!extracted.found) throw new Error(extracted.reason);
  return coerceExtractionValue(extracted.value);
}

async function maybeDelay(
  policy: RetryPolicy | undefined,
  ports: { sleep: (ms: number, signal: AbortSignal) => Promise<void>; signal: AbortSignal },
): Promise<void> {
  if (policy === undefined) return;
  if (policy.delayMs <= 0) return;
  await ports.sleep(policy.delayMs, ports.signal);
}

/**
 * Executes one request step by calling {@link CollectionRequestExecutorPort}.
 */
export class RequestStepRunner implements ScenarioStepRunner {
  public readonly stepType = ScenarioStepType.Request;
  public readonly capabilities = [
    StepCapability.Retry,
    StepCapability.Outputs,
    StepCapability.Cancellation,
  ] as const;

  public constructor(private readonly ports: RequestStepRunnerPorts) {}

  public async run(
    step: RequestStep,
    context: ScenarioExecutionContext,
  ): Promise<ScenarioStepRunnerExecutionResult> {
    if (context.signal.aborted) {
      const now = this.ports.now();
      return {
        stepResult: {
          stepId: step.id,
          stepName: step.name,
          status: StepRunStates.Cancelled,
          startTime: now,
          endTime: now,
          durationMs: 0,
          attempt: 0,
        },
      };
    }

    const retryPolicy = step.retryPolicy;
    const maxRetries = retryPolicy?.maxRetries ?? 0;
    const maxAttempts = maxRetries + 1;

    // Pre-resolve request input mappings and substitute request templates.
    const requestTemplateText = await this.ports.sourceReader.readText(step.requestFilePath);
    let requestText = requestTemplateText;
    for (const mapping of step.inputMappings) {
      const value = this.ports.scenarioVariableResolver.resolveScenarioVariable(
        mapping.variable,
        { variables: context.variables, outputs: context.outputs },
      );
      const pattern = new RegExp(`\\{\\{${escapeRegExp(mapping.requestVariable)}}\\}`, 'g');
      requestText = requestText.replace(pattern, value);
    }

    let lastExecutionResult: RunAtSourceLocationResult | undefined;
    let lastError: { message: string; cause?: unknown } | undefined;
    for (let attemptIndex = 1; attemptIndex <= maxAttempts; attemptIndex += 1) {
      if (context.signal.aborted) {
        const now = this.ports.now();
        return {
          stepResult: {
            stepId: step.id,
            stepName: step.name,
            status: StepRunStates.Cancelled,
            startTime: now,
            endTime: now,
            durationMs: 0,
            attempt: attemptIndex,
          },
        };
      }

      const startTime = this.ports.now();
      let runResult: RunAtSourceLocationResult;
      try {
        const source: RunRequestSource = {
          text: requestText,
          sourceId: step.requestFilePath,
          offset: step.requestOffset,
        };
        const options: RunAtSourceLocationOptions = {
          showViewer: false,
          useProgressUi: false,
          showNotifications: false,
          signal: context.signal,
        };
        runResult = await this.ports.executor.runAtSourceLocation(source, options);
      } catch (cause) {
        lastError = {
          message: 'Request execution threw an unexpected error.',
          cause,
        };
        if (attemptIndex < maxAttempts) {
          await maybeDelay(retryPolicy, {
            sleep: this.ports.sleep,
            signal: context.signal,
          });
          continue;
        }
        const failEnd = this.ports.now();
        return {
          stepResult: {
            stepId: step.id,
            stepName: step.name,
            status: StepRunStates.Failed,
            startTime,
            endTime: failEnd,
            durationMs: failEnd - startTime,
            attempt: attemptIndex,
            error: lastError,
          },
        };
      }
      const endTime = this.ports.now();
      const durationMs = endTime - startTime;
      lastExecutionResult = runResult;

      if (runResult.outcome === 'success') {
        const outputsMap = new Map<string, string>();
        const extractedPairs: { name: string; value: string }[] = [];

        for (const output of step.outputs ?? []) {
          let value: string;
          if (output.source.includes('{{')) {
            value = this.ports.scenarioVariableResolver.resolveStringTemplate(
              output.source,
              { variables: context.variables, outputs: context.outputs },
            );
          } else {
            value = outputValueFromExecution(
              output,
              runResult.execution,
              step.requestId,
            );
          }
          outputsMap.set(output.name, value);
          extractedPairs.push({ name: output.name, value });
          if (output.targetVariable !== undefined) {
            context.variables.set(output.targetVariable, value);
          }
        }
        context.outputs.set(step.id, outputsMap);

        // Capture last response for subsequent condition expressions
        // (statusCode / headers["..."]). Header values stay available for
        // evaluation; report UI remains responsible for secret masking.
        if (runResult.execution?.success === true) {
          const headers = new Map<string, string>();
          for (const header of runResult.execution.response.headers) {
            headers.set(header.name.toLowerCase(), header.value);
          }
          context.lastResponse = {
            statusCode: runResult.execution.response.statusCode,
            headers,
          };
        } else if (runResult.statusCode !== undefined) {
          context.lastResponse = {
            statusCode: runResult.statusCode,
            headers: new Map(),
          };
        }

        // Sync @extract / run-scope writes into scenario variables.
        if (context.runStore !== undefined) {
          for (const [name, entry] of context.runStore.snapshot()) {
            context.variables.set(name, entry.value);
          }
        }

        return {
          stepResult: {
            stepId: step.id,
            stepName: step.name,
            status: StepRunStates.Completed,
            startTime,
            endTime,
            durationMs,
            attempt: attemptIndex,
            outputs: extractedPairs,
            requestResult: runResult,
          },
        };
      }

      if (runResult.outcome === 'cancelled') {
        return {
          stepResult: {
            stepId: step.id,
            stepName: step.name,
            status: StepRunStates.Cancelled,
            startTime,
            endTime,
            durationMs,
            attempt: attemptIndex,
            requestResult: runResult,
          },
        };
      }

      if (runResult.outcome === 'precondition-failed') {
        return {
          stepResult: {
            stepId: step.id,
            stepName: step.name,
            status: StepRunStates.Skipped,
            startTime,
            endTime,
            durationMs,
            attempt: attemptIndex,
            requestResult: runResult,
            error: {
              message: 'Request precondition failed.',
            },
          },
        };
      }

      if (runResult.outcome === 'replaced') {
        return {
          stepResult: {
            stepId: step.id,
            stepName: step.name,
            status: StepRunStates.Cancelled,
            startTime,
            endTime,
            durationMs,
            attempt: attemptIndex,
            requestResult: runResult,
          },
        };
      }

      if (attemptIndex < maxAttempts) {
        // Retry after delay; cancellation is checked before sleeping in case
        // executor does not respect external AbortSignals.
        await maybeDelay(retryPolicy, {
          sleep: this.ports.sleep,
          signal: context.signal,
        });
        continue;
      }
      lastError = {
        message: `Request failed after ${attemptIndex} attempt(s).`,
      };
    }

    const endTime = this.ports.now();
    const startTime = endTime; // best-effort; timing is not meaningful on loop exit
    return {
      stepResult: {
        stepId: step.id,
        stepName: step.name,
        status: StepRunStates.Failed,
        startTime,
        endTime,
        durationMs: 0,
        attempt: maxAttempts,
        error: lastError,
        requestResult: lastExecutionResult,
      },
    };
  }
}

