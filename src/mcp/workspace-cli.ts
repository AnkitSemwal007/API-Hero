/**
 * Pure CLI helpers for MCP workspace configuration.
 * No I/O — argv parsing only.
 */

export type ParseWorkspaceCliArgResult =
  | { readonly status: 'unset' }
  | { readonly status: 'set'; readonly workspace: string }
  | { readonly status: 'error'; readonly message: string };

const WORKSPACE_USAGE =
  'Missing value for --workspace. Usage: api-hero-mcp --workspace "<workspace-path>"';

/**
 * Parse `--workspace <path>` or `--workspace=<path>` from an argv array.
 * Returns `unset` when the flag is absent; `error` when the flag is present
 * without a usable value (next arg missing or starts with `-`, or empty `=` form).
 */
export function parseWorkspaceCliArg(
  argv: readonly string[],
): ParseWorkspaceCliArgResult {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--workspace') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        return { status: 'error', message: WORKSPACE_USAGE };
      }
      return { status: 'set', workspace: next };
    }
    if (arg.startsWith('--workspace=')) {
      const value = arg.slice('--workspace='.length);
      if (value.length === 0) {
        return { status: 'error', message: WORKSPACE_USAGE };
      }
      return { status: 'set', workspace: value };
    }
  }
  return { status: 'unset' };
}
