/**
 * Hand-rolled argv parser for `apihero` (no commander).
 */

import { parseWorkspaceCliArg } from '../mcp/workspace-cli';

export type CliRunTargetType = 'request' | 'collection' | 'scenario';

export type ParsedCliArgs =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'run-help' }
  | {
      readonly kind: 'run';
      readonly targetType: CliRunTargetType;
      readonly target: string;
      readonly workspace?: string;
      readonly environment?: string;
      readonly json: boolean;
      readonly quiet: boolean;
      readonly verbose: boolean;
    }
  | { readonly kind: 'error'; readonly message: string };

const RUN_TARGETS = new Set<string>(['request', 'collection', 'scenario']);

export const ROOT_HELP = `API Hero CLI — run requests and collections in CI.

Usage:
  apihero --help
  apihero --version
  apihero run --help
  apihero run request <request> [options]
  apihero run collection <collection> [options]

Options:
  --workspace <path>       Workspace root (or APIHERO_WORKSPACE / cwd)
  --environment <name>     Environment id or name from .apihero
  --json                   Machine-readable redacted JSON envelope
  --quiet                  Print failures / final result only
  --verbose                Verbose runtime logs on stderr

Exit codes:
  0  success
  1  execution failure (HTTP / assertions / failed steps)
  2  invalid arguments
  3  project / configuration error
  4  auth / secret resolution error
`;

export const RUN_HELP = `apihero run — execute a request or collection.

Usage:
  apihero run request <request> [options]
  apihero run collection <collection> [options]

<request> may be a label, id, or path fragment (e.g. hello.api).
<collection> is a collection display name or id.

Options:
  --workspace <path>       Workspace root (or APIHERO_WORKSPACE / cwd)
  --environment <name>     Environment id or name from .apihero
  --json                   Machine-readable redacted JSON envelope
  --quiet                  Print failures / final result only
  --verbose                Verbose runtime logs on stderr

Exit codes: 0 success · 1 execution failure · 2 usage · 3 config · 4 auth
`;

/**
 * Parse `apihero` argv (without node/executable). Returns structured command
 * or a usage error (caller maps to exit 2).
 */
export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { kind: 'help' };
  }
  if (argv[0] === '--version' || argv[0] === '-V') {
    return { kind: 'version' };
  }

  if (argv[0] !== 'run') {
    // `apihero foo --help` → root help rather than unknown-command error.
    if (argv.includes('--help') || argv.includes('-h')) {
      return { kind: 'help' };
    }
    if (argv.includes('--version') || argv.includes('-V')) {
      return { kind: 'version' };
    }
    return {
      kind: 'error',
      message: `Unknown command "${argv[0]}". Use: apihero run <request|collection> …`,
    };
  }

  const rest = argv.slice(1);
  if (rest.length === 0 || rest[0] === '--help' || rest[0] === '-h') {
    return { kind: 'run-help' };
  }

  const targetTypeRaw = rest[0]!;
  if (!RUN_TARGETS.has(targetTypeRaw)) {
    return {
      kind: 'error',
      message: `Unknown run target "${targetTypeRaw}". Use request or collection.`,
    };
  }
  const targetType = targetTypeRaw as CliRunTargetType;

  let workspace: string | undefined;
  let environment: string | undefined;
  let json = false;
  let quiet = false;
  let verbose = false;
  const positionals: string[] = [];

  for (let i = 1; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--help' || arg === '-h') {
      return { kind: 'run-help' };
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--quiet') {
      quiet = true;
      continue;
    }
    if (arg === '--verbose') {
      verbose = true;
      continue;
    }
    if (arg === '--workspace' || arg.startsWith('--workspace=')) {
      const slice =
        arg === '--workspace' ? [arg, rest[i + 1] ?? ''] : [arg];
      const parsed = parseWorkspaceCliArg(slice);
      if (arg === '--workspace') {
        i += 1;
      }
      if (parsed.status === 'error') {
        return {
          kind: 'error',
          message: parsed.message.replaceAll('api-hero-mcp', 'apihero'),
        };
      }
      if (parsed.status === 'set') {
        workspace = parsed.workspace;
      }
      continue;
    }
    if (arg === '--environment' || arg.startsWith('--environment=')) {
      if (arg === '--environment') {
        const next = rest[i + 1];
        if (next === undefined || next.startsWith('-')) {
          return {
            kind: 'error',
            message:
              'Missing value for --environment. Usage: apihero run … --environment "<name>"',
          };
        }
        environment = next;
        i += 1;
      } else {
        const value = arg.slice('--environment='.length);
        if (value.length === 0) {
          return {
            kind: 'error',
            message:
              'Missing value for --environment. Usage: apihero run … --environment="<name>"',
          };
        }
        environment = value;
      }
      continue;
    }
    if (arg.startsWith('-')) {
      return { kind: 'error', message: `Unknown option "${arg}".` };
    }
    positionals.push(arg);
  }

  if (positionals.length === 0) {
    return {
      kind: 'error',
      message: `Missing ${targetType} name. Usage: apihero run ${targetType} <${targetType}>`,
    };
  }
  if (positionals.length > 1) {
    return {
      kind: 'error',
      message: `Unexpected extra argument "${positionals[1]}".`,
    };
  }

  return {
    kind: 'run',
    targetType,
    target: positionals[0]!,
    ...(workspace === undefined ? {} : { workspace }),
    ...(environment === undefined ? {} : { environment }),
    json,
    quiet,
    verbose,
  };
}
