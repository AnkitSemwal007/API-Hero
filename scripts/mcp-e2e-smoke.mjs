/**
 * Optional MCP / headless smoke helper.
 *
 * Creates a temp workspace with the DummyJSON example collection (copy or
 * junction), then exercises ApiHeroMcpService list → get → (optional live run).
 *
 * Live HTTP against DummyJSON is OFF by default. Set APIHERO_MCP_LIVE=1 to
 * run the full collection against the public DummyJSON API.
 *
 * Usage (from repo root, after compile):
 *   node ./scripts/mcp-e2e-smoke.mjs
 *   APIHERO_MCP_LIVE=1 node ./scripts/mcp-e2e-smoke.mjs
 *
 * Note: this script calls createHeadlessApiHeroRuntime directly (not the
 * stdio CLI). For the spawned server, prefer:
 *   node ./dist/mcp/server.js --workspace "<path>"
 */

import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const exampleName = 'DummyJSON Complete API Collection';
const exampleSrc = path.join(
  repoRoot,
  'examples',
  'collections',
  exampleName,
);

async function main() {
  if (!existsSync(path.join(repoRoot, 'dist', 'mcp', 'service.js'))) {
    console.error('Compile first: npm run compile');
    process.exit(1);
  }
  if (!existsSync(exampleSrc)) {
    console.error(`Missing example collection at ${exampleSrc}`);
    process.exit(1);
  }

  const { createHeadlessApiHeroRuntime } = await import(
    '../dist/mcp/composition.js'
  );
  const { ApiHeroMcpService } = await import('../dist/mcp/service.js');

  const workspace = mkdtempSync(path.join(tmpdir(), 'apihero-mcp-'));
  const collectionsDir = path.join(workspace, 'Collections');
  const target = path.join(collectionsDir, exampleName);
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(collectionsDir, { recursive: true });
    try {
      symlinkSync(exampleSrc, target, 'junction');
    } catch {
      cpSync(exampleSrc, target, { recursive: true });
    }

    const runtime = createHeadlessApiHeroRuntime({ workspaceRoot: workspace });
    const service = ApiHeroMcpService.fromRuntime(runtime);

    const listed = await service.listCollections();
    console.log('listCollections:', JSON.stringify(listed, null, 2));
    if (!listed.ok) {
      process.exitCode = 1;
      return;
    }

    const detail = await service.getCollection(exampleName);
    console.log(
      'getCollection requestCount:',
      detail.ok ? detail.data.requestCount : detail.error,
    );

    const requests = await service.listRequests(exampleName);
    console.log(
      'listRequests count:',
      requests.ok ? requests.data.requests.length : requests.error,
    );

    if (process.env.APIHERO_MCP_LIVE === '1') {
      console.log('Running live collection (DummyJSON)...');
      const run = await service.runCollection(exampleName, 'continue-on-error');
      if (!run.ok) {
        console.error('runCollection failed:', run.error);
        process.exitCode = 1;
        return;
      }
      const summary = {
        collection: run.data.collection,
        runId: run.data.runId,
        status: run.data.status,
        total: run.data.total,
        passed: run.data.passed,
        failed: run.data.failed,
        skipped: run.data.skipped,
        durationMs: run.data.durationMs,
        assertions: run.data.assertions,
        failureCategoryCounts: run.data.failureCategoryCounts,
      };
      console.log('runCollection summary:', JSON.stringify(summary, null, 2));

      const failed = run.data.requests.filter((r) => r.status === 'failed');
      console.log(
        `Inspecting ${failed.length} failed request(s) via getRequestResult…`,
      );
      for (const entry of failed.slice(0, 5)) {
        const detail = await service.getRequestResult(
          run.data.runId,
          entry.requestId,
        );
        if (!detail.ok) {
          console.log('-', entry.label, detail.error);
          continue;
        }
        const payload = JSON.stringify(detail.data);
        if (
          /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(payload) ||
          /"password"\s*:\s*"[^•"][^"]*"/.test(payload)
        ) {
          console.error('SECRET LEAK DETECTED in getRequestResult output');
          process.exitCode = 1;
        }
        console.log(
          '-',
          detail.data.label,
          'http=',
          detail.data.httpStatus,
          'diagnostics=',
          JSON.stringify(detail.data.failureDiagnostics),
          'assertions=',
          JSON.stringify(detail.data.assertions),
        );
      }
    } else {
      console.log(
        'Skipping live HTTP. Set APIHERO_MCP_LIVE=1 to run DummyJSON collection.',
      );
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
