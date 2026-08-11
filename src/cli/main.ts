#!/usr/bin/env node
/**
 * API Hero headless CLI entry (`apihero`).
 * No vscode, no MCP SDK — exits cleanly after one run.
 */

import {
  EXIT_USAGE,
} from './exit-codes';
import { formatHelp } from './format';
import { parseCliArgs, ROOT_HELP, RUN_HELP } from './parse-args';
import { executeCliRun } from './run';
import { readPackageVersion } from '../shared/package-version';

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (parsed.kind === 'help') {
    process.stdout.write(formatHelp(ROOT_HELP));
    return 0;
  }
  if (parsed.kind === 'version') {
    process.stdout.write(`${readPackageVersion()}\n`);
    return 0;
  }
  if (parsed.kind === 'run-help') {
    process.stdout.write(formatHelp(RUN_HELP));
    return 0;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`${parsed.message}\n`);
    return EXIT_USAGE;
  }

  const result = await executeCliRun(parsed);
  if (result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
  return result.exitCode;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`apihero failed: ${message}\n`);
      process.exitCode = 1;
    });
}
